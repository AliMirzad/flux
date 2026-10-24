import type { DownloadJob } from '../../domain/model';
import { parseHls, type HlsPart, type HlsManifest } from './hls';
import { fetchHls, type MediaNetwork } from './network';
import { sleep } from '../speed/control';
import type { HlsStep } from './compose';
type Plan = Extract<HlsManifest, { kind: 'media' }>;
type Playlist = Awaited<ReturnType<typeof fetchHls>>;

export function serializeMediaPlan(plan: Plan) {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:' + Math.max(1, Math.ceil(plan.targetDuration ?? 1)),
    '#EXT-X-MEDIA-SEQUENCE:' + plan.sequence,
    '#EXT-X-DISCONTINUITY-SEQUENCE:' + (plan.parts[0]?.epoch ?? 0),
  ];
  const resource = (part: HlsPart, init = false) => {
    lines.push(
      part.encryption
        ? `#EXT-X-KEY:METHOD=AES-128,URI="${part.encryption.url}",IV=0x${part.encryption.iv}`
        : '#EXT-X-KEY:METHOD=NONE',
    );
    const range = part.range
      ? `${part.range.end - part.range.start + 1}@${part.range.start}`
      : undefined;
    if (init) lines.push(`#EXT-X-MAP:URI="${part.url}"${range ? `,BYTERANGE="${range}"` : ''}`);
    else {
      lines.push('#EXTINF:' + part.duration + ',');
      if (range) lines.push('#EXT-X-BYTERANGE:' + range);
      lines.push(part.url);
    }
  };
  if (plan.init) resource(plan.init, true);
  let epoch = plan.parts[0]?.epoch ?? 0;
  for (const part of plan.parts) {
    const next = part.epoch ?? 0;
    if (next < epoch || next - epoch > 8192) throw new Error('Invalid recording epoch sequence.');
    while (epoch < next) {
      lines.push('#EXT-X-DISCONTINUITY');
      epoch++;
    }
    if (part.initialization) resource(part.initialization, true);
    resource(part);
  }
  if (!plan.live) lines.push('#EXT-X-ENDLIST');
  const text = lines.join('\n') + '\n';
  if (text.length > 1048576 || plan.parts.length > 8192)
    throw new Error(
      'Recording reached its 8192-part / 1 MiB metadata bound. Finish this recording before continuing.',
    );
  return text;
}

/** Only append verified sequence identities; never silently fill a missed live window. */
export function appendLive(plan: Plan, next: Plan) {
  if (plan.transport !== next.transport)
    throw new Error(
      'Live initialization changed. Finish the retained recording before starting another.',
    );
  const edge = plan.sequence + plan.parts.length;
  if (next.sequence > edge)
    throw new Error(
      'The live window advanced past a missing segment. Retained media can be finished and saved.',
    );
  if (next.sequence + next.parts.length < edge)
    throw new Error('The live sequence moved backwards.');
  const identity = ({
    initialization: unusedInit,
    presentationOffset: unusedOffset,
    ...part
  }: HlsPart) => ({ ...part, epoch: part.epoch ?? 0 });
  const oldInits: (HlsPart | undefined)[] = [];
  let previousInit = plan.init;
  for (const part of plan.parts) {
    previousInit = part.initialization ?? previousInit;
    oldInits.push(previousInit);
  }
  let incomingInit = next.init;
  for (let i = 0; i < next.parts.length; i++) {
    const sequence = next.sequence + i,
      part = next.parts[i]!;
    incomingInit = part.initialization ?? incomingInit;
    if (sequence < plan.sequence) continue;
    if (sequence < edge) {
      if (JSON.stringify(oldInits[sequence - plan.sequence]) !== JSON.stringify(incomingInit))
        throw new Error('Live initialization changed without a consistent discontinuity.');
      if (
        JSON.stringify(identity(plan.parts[sequence - plan.sequence]!)) !==
        JSON.stringify(identity(part))
      )
        throw new Error(
          'An overlapping live segment changed identity. Retained media is preserved.',
        );
    } else {
      const changedEpoch = (part.epoch ?? 0) !== (plan.parts.at(-1)?.epoch ?? 0);
      if (!changedEpoch && JSON.stringify(previousInit) !== JSON.stringify(incomingInit))
        throw new Error('Live initialization changed without a discontinuity.');
      plan.parts.push({
        ...part,
        ...(changedEpoch ? { presentationOffset: plan.duration } : {}),
        ...(JSON.stringify(previousInit) !== JSON.stringify(incomingInit)
          ? { initialization: incomingInit }
          : {}),
      });
      previousInit = incomingInit;
      plan.duration += part.duration!;
    }
  }
  plan.live = next.live;
  plan.targetDuration = next.targetDuration;
}

export async function openRecording(
  job: DownloadJob,
  network: MediaNetwork,
  shouldFinish: () => boolean,
) {
  const recording = job.media!.recording!;
  const playlist: Playlist = recording.snapshot
    ? {
        url: job.media!.playlistUrl ?? job.url,
        text: recording.snapshot,
        manifest: parseHls(
          recording.snapshot,
          job.media!.playlistUrl ?? job.url,
          network.allowLocalForTests,
          true,
        ),
        etag: null,
        modified: null,
      }
    : await fetchHls(job.url, network, true);
  if (playlist.manifest.kind !== 'media')
    throw new Error('Select a media rendition before recording.');
  const plan = playlist.manifest;
  let lastAdvance = performance.now();
  const save = () => {
    recording.snapshot = serializeMediaPlan(plan);
  };
  save();
  return {
    audio: undefined,
    offsets: undefined,
    ready: () => true,
    playlist,
    plan,
    save,
    finish(steps: HlsStep[]) {
      plan.parts.splice(steps.length);
      plan.duration = plan.parts.reduce((sum, part) => sum + part.duration!, 0);
      plan.live = false;
      return { duration: plan.duration, parts: plan.parts.length };
    },
    async advance() {
      if (
        recording.finished ||
        shouldFinish() ||
        plan.duration >= recording.maxSeconds ||
        !plan.live
      )
        return false;
      const until =
        performance.now() + Math.max(1000, Math.min(10000, (plan.targetDuration ?? 2) * 500));
      while (performance.now() < until) {
        if (shouldFinish()) return false;
        await sleep(Math.min(250, until - performance.now()), network.signal);
      }
      if (shouldFinish()) return false;
      const next = await fetchHls(playlist.url, network, true);
      if (next.manifest.kind !== 'media')
        throw new Error('The live media URL became a master playlist.');
      const count = plan.parts.length;
      appendLive(plan, next.manifest);
      save();
      if (plan.parts.length > count) lastAdvance = performance.now();
      if (performance.now() - lastAdvance > Math.max(30000, (plan.targetDuration ?? 2) * 3000))
        throw new Error(
          'The live playlist stopped advancing. Finish the retained recording, or retry.',
        );
      return true;
    },
  };
}
