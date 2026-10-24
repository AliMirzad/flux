import type { DownloadJob } from '../../domain/model';
import { loadDash } from './dash-network';
import { appendLive, serializeMediaPlan } from './live';
import { parseHls, type HlsPart } from './hls';
import { sleep } from '../speed/control';
import type { MediaNetwork } from './network';
import type { HlsStep } from './compose';

export async function openDashRecording(
  job: DownloadJob,
  network: MediaNetwork,
  shouldFinish: () => boolean,
) {
  const recording = job.media!.recording!;
  const fresh = recording.snapshot
    ? undefined
    : await loadDash(job.url, network, job.media!.dash, true);
  let playlist: Awaited<ReturnType<typeof loadDash>>['playlist'],
    audio: Awaited<ReturnType<typeof loadDash>>['audio'],
    offsets: { video: number; audio: number },
    interval = 2;
  if (fresh) {
    playlist = fresh.playlist;
    audio = fresh.audio;
    offsets = fresh.offsets;
    interval = fresh.minimumUpdatePeriod ?? 2;
    job.media!.dash = fresh.selection;
  } else {
    const saved = JSON.parse(recording.snapshot!) as {
      format: string;
      video: string;
      audio?: string;
      offsets: { video: number; audio: number };
      interval: number;
    };
    if (
      saved.format !== 'flux-dash-recording-v1' ||
      !Number.isFinite(saved.offsets?.video) ||
      !Number.isFinite(saved.offsets?.audio) ||
      saved.offsets.video < 0 ||
      saved.offsets.audio < 0 ||
      !Number.isFinite(saved.interval)
    )
      throw new Error('Invalid stored DASH recording plan.');
    const url = job.media!.playlistUrl ?? job.url;
    const videoPlan = parseHls(saved.video, url, network.allowLocalForTests, true);
    if (videoPlan.kind !== 'media') throw new Error('Invalid stored DASH media plan.');
    playlist = { url, text: saved.video, manifest: videoPlan, etag: null, modified: null };
    if (saved.audio) {
      const plan = parseHls(saved.audio, url, network.allowLocalForTests, true);
      if (plan.kind !== 'media') throw new Error('Invalid stored DASH audio plan.');
      audio = { url, text: saved.audio, manifest: plan, etag: null, modified: null };
    }
    offsets = saved.offsets;
    interval = Math.max(0.25, Math.min(30, saved.interval));
  }
  const plan = playlist.manifest;
  const save = () => {
    const snapshot = JSON.stringify({
      format: 'flux-dash-recording-v1',
      video: serializeMediaPlan(plan),
      ...(audio ? { audio: serializeMediaPlan(audio.manifest) } : {}),
      offsets,
      interval,
    });
    if (snapshot.length > 1048576)
      throw new Error('DASH recording reached the 1 MiB plan bound. Finish retained media.');
    recording.snapshot = snapshot;
  };
  save();
  let lastAdvance = performance.now();
  return {
    playlist,
    audio,
    offsets,
    plan,
    save,
    ready: () => !audio || Math.abs(plan.duration - audio.manifest.duration) <= 0.5,
    finish(steps: HlsStep[]) {
      const count = (kind: 'video' | 'audio') =>
        steps.reduce(
          (sum, step) => sum + Number(step.track === kind) + Number(step.companion?.track === kind),
          0,
        );
      plan.parts.splice(audio ? count('video') : steps.length);
      if (audio) {
        audio.manifest.parts.splice(count('audio'));
        audio.manifest.duration = audio.manifest.parts.reduce(
          (sum, part) => sum + part.duration!,
          0,
        );
        audio.manifest.live = false;
      }
      plan.duration = plan.parts.reduce((sum, part) => sum + part.duration!, 0);
      plan.live = false;
      return {
        duration: Math.max(plan.duration, audio?.manifest.duration ?? 0),
        parts: plan.parts.length + (audio?.manifest.parts.length ?? 0),
      };
    },
    async advance() {
      if (
        recording.finished ||
        shouldFinish() ||
        plan.duration >= recording.maxSeconds ||
        !plan.live
      )
        return false;
      const until = performance.now() + interval * 1000;
      while (performance.now() < until) {
        if (shouldFinish()) return false;
        await sleep(Math.min(250, until - performance.now()), network.signal);
      }
      if (shouldFinish()) return false;
      const next = await loadDash(playlist.url, network, job.media!.dash, true);
      if (
        !!next.audio !== !!audio ||
        next.offsets.video !== offsets.video ||
        next.offsets.audio !== offsets.audio
      )
        throw new Error(
          'The live DASH track set or presentation offset changed. Finish retained media.',
        );
      const count = plan.parts.length + (audio?.manifest.parts.length ?? 0);
      appendLive(plan, next.playlist.manifest);
      if (audio && next.audio) appendLive(audio.manifest, next.audio.manifest);
      if (!next.live) {
        plan.live = false;
        if (audio) audio.manifest.live = false;
      }
      save();
      if (plan.parts.length + (audio?.manifest.parts.length ?? 0) > count)
        lastAdvance = performance.now();
      if (performance.now() - lastAdvance > Math.max(30000, interval * 3000))
        throw new Error(
          'The live DASH manifest stopped advancing. Finish retained media or retry.',
        );
      return true;
    },
  };
}
