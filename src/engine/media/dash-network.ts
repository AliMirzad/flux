import {
  parseDash,
  dashIndex,
  type DashChoice,
  type DashSelection,
  type DashReview,
  type DashRepresentation,
  type MediaPlan,
} from './dash';
import { fetchManifestText, mediaRequest, readMediaBody, type MediaNetwork } from './network';
import { parseContentRange } from '../segmentation/ranges';
import { pairHlsPlans } from './compose';

export async function loadDash(
  url: string,
  options: MediaNetwork,
  selection?: DashSelection,
  allowLive = false,
) {
  const response = await fetchManifestText(url, options);
  const manifest = parseDash(
    response.text,
    response.url,
    options.allowLocalForTests,
    allowLive ? Date.now() : undefined,
  );
  const video = selection?.videoId
    ? manifest.representations.find(
        (item) => item.id === selection.videoId && item.kind === 'video',
      )
    : manifest.representations
        .filter((item) => item.kind === 'video')
        .sort((a, b) => b.bandwidth - a.bandwidth)[0];
  if (!video) throw new Error('The selected DASH video representation is no longer available.');
  const audio =
    selection?.audioId === ''
      ? undefined
      : selection?.audioId
        ? manifest.representations.find(
            (item) => item.id === selection.audioId && item.kind === 'audio',
          )
        : manifest.representations.find((item) => item.kind === 'audio');
  if (selection?.audioId && !audio)
    throw new Error('The selected DASH audio representation is no longer available.');
  const plan = async (source: DashRepresentation): Promise<MediaPlan> => {
    if (source.periods) {
      const periods = [];
      for (const period of source.periods) {
        const presentation = await plan(period);
        if (Math.abs(presentation.duration - period.periodDuration!) > 1)
          throw new Error('DASH segments do not cover their period.');
        periods.push({ source: period, plan: presentation });
      }
      return {
        kind: 'media',
        transport: 'mp4',
        init: periods[0]!.plan.init,
        sequence: 0,
        duration: periods.at(-1)!.source.periodStart! + periods.at(-1)!.source.periodDuration!,
        parts: periods.flatMap((item, index) =>
          item.plan.parts.map((part, ordinal) => ({
            ...part,
            epoch: index,
            sourceOffset: item.source.offset,
            ...(ordinal === 0
              ? {
                  presentationOffset: item.source.periodStart,
                  ...(index ? { initialization: item.plan.init } : {}),
                }
              : {}),
          })),
        ),
      };
    }
    if (source.plan) return source.plan;
    const index = source.index!;
    const response = await mediaRequest(
      index.url,
      { headers: { Range: `bytes=${index.range.start}-${index.range.end}` } },
      options,
    );
    try {
      const encoding = response.headers.get('content-encoding');
      if (response.status !== 206 || (encoding && encoding.toLowerCase() !== 'identity'))
        throw new Error('The DASH index server did not honor the requested byte range.');
      const range = parseContentRange(response.headers.get('content-range'));
      if (range.start !== index.range.start || range.end !== index.range.end)
        throw new Error('The DASH index server returned a different byte range.');
      const bytes = new Uint8Array(range.end - range.start + 1);
      let at = 0;
      await readMediaBody(response, options.signal, async (chunk) => {
        if (at + chunk.length > bytes.length)
          throw new Error('DASH index response exceeded its range.');
        bytes.set(chunk, at);
        at += chunk.length;
      });
      if (at !== bytes.length) throw new Error('DASH index response was truncated.');
      return dashIndex(bytes, index.range.start, source);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  };
  const videoPlan = await plan(video),
    audioPlan = audio ? await plan(audio) : undefined;
  if (manifest.live && audioPlan) {
    const trim = (source: MediaPlan, target: MediaPlan) => {
      while (
        source.parts.length > 1 &&
        (target.presentationStart ?? 0) - (source.presentationStart ?? 0) > 0.5
      ) {
        source.presentationStart = (source.presentationStart ?? 0) + source.parts[0]!.duration!;
        source.duration -= source.parts.shift()!.duration!;
        source.sequence++;
      }
    };
    trim(videoPlan, audioPlan);
    trim(audioPlan, videoPlan);
    if (Math.abs((videoPlan.presentationStart ?? 0) - (audioPlan.presentationStart ?? 0)) > 0.5)
      throw new Error('The live DASH audio and video windows are not aligned.');
  }
  if (
    !manifest.live &&
    (Math.abs(videoPlan.duration - manifest.duration) > 1 ||
      (audioPlan && Math.abs(audioPlan.duration - manifest.duration) > 1))
  )
    throw new Error('The selected DASH segments do not cover the declared period.');
  if (audioPlan) pairHlsPlans(videoPlan, audioPlan);
  const selected: DashSelection = {
    videoId: video.id,
    ...(audio ? { audioId: audio.id } : { audioId: '' }),
  };
  const choices: DashChoice[] = manifest.representations.map(
    ({ id, kind, bandwidth, width, height, language, codecs }) => ({
      id,
      kind,
      bandwidth,
      width,
      height,
      language,
      codecs,
    }),
  );
  const identity = response.text + '\n' + JSON.stringify({ selected, videoPlan, audioPlan });
  return {
    live: manifest.live,
    minimumUpdatePeriod: manifest.minimumUpdatePeriod,
    playlist: { ...response, text: identity, manifest: videoPlan },
    audio: audioPlan
      ? { ...response, text: JSON.stringify(audioPlan), manifest: audioPlan }
      : undefined,
    offsets: { video: video.offset, audio: audio?.offset ?? 0 },
    choices,
    selection: selected,
  };
}
export async function reviewDash(
  url: string,
  options: MediaNetwork,
  selection?: DashSelection,
): Promise<DashReview> {
  const presentation = await loadDash(url, options, selection, true);
  const plans = [
    presentation.playlist.manifest,
    ...(presentation.audio ? [presentation.audio.manifest] : []),
  ];
  const origins = [
    ...new Set(
      [
        presentation.playlist.url,
        ...plans.flatMap((plan) => [
          plan.init!.url,
          ...plan.parts.flatMap((part) => [
            part.url,
            ...(part.initialization ? [part.initialization.url] : []),
          ]),
        ]),
      ].map((url) => new URL(url).origin),
    ),
  ];
  if (origins.length > 64) throw new Error('The DASH presentation uses too many resource origins.');
  return {
    kind: 'dash',
    ...(presentation.live ? { live: true } : {}),
    url: presentation.playlist.url,
    choices: presentation.choices,
    selection: presentation.selection,
    origins,
    duration: Math.max(...plans.map((plan) => plan.duration)),
    parts: plans.reduce((sum, plan) => sum + plan.parts.length, 0),
  };
}
