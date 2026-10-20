import { createSHA256 } from 'hash-wasm';
import type { EngineOptions } from '../ports';
import { hashRegion, verifyStoredFile } from '../runner';
import { completeBytes, parseContentRange } from '../segmentation/ranges';
import { transition } from '../../domain/state';
import { BandwidthLimiter, SpeedMeter, checkAbort } from '../speed/control';
import { HttpError, numberHeader } from '../network/http';
import { fetchHls, mediaRequest, readMediaBody, mediaRetry } from './network';
import type { HlsPart } from './hls';
import type { MediaCheckpoint } from './types';
import { inspectMp4Init, inspectMoof, type Box, type Mp4Track } from './mp4';

export async function runHlsDownload(options: EngineOptions) {
  const { job, store, signal, checkpoint, progress, settings } = options;
  if (!job.media || !options.mediaCheckpoints)
    throw new Error('HLS checkpoint storage is unavailable.');
  job.sha256 = null;
  const media = job.media,
    records = options.mediaCheckpoints;
  const started = performance.now(),
    baseActive = job.activeMs;
  let received = 0,
    lastProgress = 0,
    durable = completeBytes(job.segments);
  const meter = new SpeedMeter(),
    limiter = new BandwidthLimiter(job.speedLimit);
  const emit = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < 250) return;
    lastProgress = now;
    job.speed = meter.rate();
    job.averageSpeed = received / Math.max(0.001, (now - started) / 1000);
    job.activeMs = baseActive + now - started;
    job.connectionSpeeds = job.connections ? [job.speed] : [];
    progress(structuredClone(job));
  };
  await options.checkAllowance?.(signal);
  const playlist = await fetchHls(job.url, options);
  if (playlist.manifest.kind !== 'media')
    throw new Error('Choose and review a media rendition from the HLS quality list first.');
  const plan = playlist.manifest;
  const hash = await createSHA256();
  hash.init();
  hash.update(playlist.url + '\n' + playlist.text);
  const planHash = hash.digest('hex');
  if (media.planHash && media.planHash !== planHash && job.segments.length)
    throw new Error(
      'The HLS playlist changed. Start a new stream download to avoid mixing different media. Existing partial data is retained.',
    );
  media.planHash = planHash;
  media.playlistUrl = playlist.url;
  media.duration = plan.duration;
  media.parts = plan.parts.length;
  media.completed = job.segments.length;
  job.resource = {
    finalUrl: playlist.url,
    size: null,
    ranges: false,
    etag: playlist.etag,
    modified: playlist.modified,
    mime: 'video/mp4',
    filename: job.filename,
  };
  job.total = null;
  await store.open(job.id);
  try {
    const parts = [plan.init, ...plan.parts];
    let previous = await records.load();
    if (job.segments.length > parts.length || previous.length !== job.segments.length)
      throw new Error('Media checkpoint metadata is incomplete. Start a new stream download.');
    for (let index = 0, offset = 0; index < job.segments.length; index++) {
      const segment = job.segments[index]!,
        record = previous[index];
      if (
        segment.start !== offset ||
        segment.end < segment.start ||
        !record ||
        record.index !== index ||
        record.url !== parts[index]!.url ||
        !/^[a-f\d]{64}$/.test(record.sourceHash)
      )
        throw new Error('Invalid media checkpoint identity or coverage.');
      offset = segment.end + 1;
    }
    if (job.segments.length) await verifyStoredFile(store, job.segments, signal);
    await store.truncate(durable);
    if (!job.segments.length) {
      await records.clear();
      previous = [];
      media.originSeconds = undefined;
      media.trackEnds = {};
    }
    transition(job, 'DOWNLOADING', 'Downloading HLS media in playlist order');
    job.note = 'MP4 HLS rendition. Parts are assembled in order and validated before saving.';
    await checkpoint(job);

    const receive = async (
      part: HlsPart,
      offset: number | null,
      maximum?: number,
    ): Promise<MediaCheckpoint> => {
      const response = await mediaRequest(
        part.url,
        part.range ? { headers: { Range: `bytes=${part.range.start}-${part.range.end}` } } : {},
        options,
      );
      try {
        const encoding = response.headers.get('content-encoding');
        if (encoding && encoding !== 'identity')
          throw new Error('Encoded media responses cannot be safely assembled.');
        let expected = numberHeader(response.headers.get('content-length')),
          fullSize = expected;
        if (part.range) {
          if (response.status !== 206)
            throw new Error('The media server ignored a required byte range.');
          const range = parseContentRange(response.headers.get('content-range'));
          if (range.start !== part.range.start || range.end !== part.range.end)
            throw new Error('The media server changed a required byte range.');
          expected = range.end - range.start + 1;
          fullSize = range.total;
        } else if (response.status !== 200) throw new Error('Unexpected media response status.');
        if (maximum !== undefined && expected !== null && expected > maximum)
          throw new Error('Media initialization metadata exceeds 1 MiB.');
        if (settings.trafficLimit > 0 && (expected === null || expected > settings.trafficLimit))
          throw new Error(
            'This media part needs a known size within one complete download allowance. Increase or disable the allowance for this stream.',
          );
        const prepaid = expected !== null && !!options.reservePayload;
        if (prepaid) await options.reservePayload!(expected!, signal);
        if (offset !== null) await store.truncate(offset);
        const sourceHash = await createSHA256();
        sourceHash.init();
        let count = 0;
        job.connections = 1;
        await readMediaBody(response, signal, async (bytes) => {
          if (
            (expected !== null && count + bytes.length > expected) ||
            (maximum !== undefined && count + bytes.length > maximum) ||
            !Number.isSafeInteger(count + bytes.length)
          )
            throw new Error('The media part exceeded its declared or safe size.');
          await limiter.consume(bytes.length, signal);
          await options.globalThrottle?.(bytes.length, signal);
          if (!prepaid) await options.accountPayload?.(bytes.length, signal);
          checkAbort(signal);
          if (offset !== null) await store.write(offset + count, bytes);
          sourceHash.update(bytes);
          count += bytes.length;
          received += bytes.length;
          meter.add(bytes.length);
          job.downloaded = durable + (offset !== null ? count : 0);
          emit();
        });
        if (expected !== null && count !== expected)
          throw new TypeError('Media response was truncated.');
        if (!count) throw new Error('The media part is empty.');
        return {
          index: 0,
          url: part.url,
          finalUrl: response.url || part.url,
          etag: response.headers.get('etag'),
          fullSize: fullSize ?? count,
          bytes: count,
          sourceHash: sourceHash.digest('hex'),
        };
      } finally {
        job.connections = 0;
        await response.body?.cancel().catch(() => undefined);
      }
    };
    // Strong validators permit a HEAD-only identity check. Otherwise compare every source byte.
    for (let index = 0; index < previous.length; index++) {
      const record = previous[index]!,
        part = parts[index]!;
      let unchanged = false;
      if (record.etag && !record.etag.startsWith('W/')) {
        try {
          const response = await mediaRetry(
            () => mediaRequest(part.url, { method: 'HEAD' }, options),
            options,
          );
          unchanged =
            (response.url || part.url) === record.finalUrl &&
            response.headers.get('etag') === record.etag &&
            numberHeader(response.headers.get('content-length')) === record.fullSize;
          await response.body?.cancel();
        } catch (error) {
          if (!(error instanceof HttpError) || ![400, 403, 405, 501].includes(error.status))
            throw error;
        }
      }
      if (!unchanged) {
        if (settings.trafficLimit > 0)
          throw new Error(
            'This media server lacks stable validators. Disable the download allowance before resuming this stream so source verification cannot consume every window.',
          );
        const fresh = await mediaRetry(
          () => receive(part, null, index === 0 ? 1048576 : undefined),
          options,
        );
        if (fresh.bytes !== record.bytes || fresh.sourceHash !== record.sourceHash)
          throw new Error(
            'A completed HLS source part changed. Start a new stream download. Partial data is retained.',
          );
      }
    }
    let tracks: Mp4Track[] = [];
    if (job.segments.length) tracks = inspectMp4Init(await store.read(0, job.segments[0]!.end + 1));
    const validatePart = async (start: number, length: number, normalized = false) => {
      const boxes: Box[] = [];
      for (let at = start; at < start + length;) {
        const bytes = await store.read(at, Math.min(16, start + length - at));
        if (bytes.length < 8) throw new Error('Truncated MP4 part header.');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          small = view.getUint32(0);
        const type = String.fromCharCode(...bytes.subarray(4, 8));
        if (small === 1 && bytes.length < 16) throw new Error('Truncated extended MP4 box.');
        const size =
            small === 1
              ? Number(view.getBigUint64(8))
              : small === 0 && type === 'mdat'
                ? start + length - at
                : small,
          header = small === 1 ? 16 : 8;
        if (
          !Number.isSafeInteger(size) ||
          size < header ||
          at + size > start + length ||
          !['styp', 'moof', 'mdat', 'free', 'skip'].includes(type)
        )
          throw new Error('Unsupported or invalid MP4 media box.');
        boxes.push({ type, start: at, body: at + header, end: at + size, size });
        at += size;
        if (boxes.length > 32768) throw new Error('Too many media boxes in one HLS part.');
      }
      const moofs = boxes.filter((box) => box.type === 'moof'),
        mdats = boxes.filter((box) => box.type === 'mdat');
      if (!moofs.length || !mdats.length)
        throw new Error('The HLS segment contains no MP4 fragments.');
      const ends = { ...media.trackEnds };
      for (const moof of moofs) {
        if (moof.size > 1048576) throw new Error('MP4 fragment metadata exceeds 1 MiB.');
        const bytes = await store.read(moof.start, moof.size),
          entries = inspectMoof(bytes, tracks);
        if (!normalized && media.originSeconds === undefined) {
          if (entries.length !== tracks.length)
            throw new Error('The first MP4 fragment must initialize all selected tracks.');
          media.originSeconds = Math.min(
            ...entries.map(
              (entry) => entry.base / tracks.find((track) => track.id === entry.id)!.timescale,
            ),
          );
        }
        const payloads: { start: number; end: number }[] = [];
        for (const entry of entries) {
          const track = tracks.find((track) => track.id === entry.id)!;
          const first = moof.start + entry.dataOffset,
            last = first + entry.bytes;
          if (
            !mdats.some((mdat) => first >= mdat.body && last <= mdat.end) ||
            payloads.some((range) => first < range.end && last > range.start)
          )
            throw new Error('MP4 sample data lies outside its media payload.');
          payloads.push({ start: first, end: last });
          const base =
            entry.base - (normalized ? 0 : Math.floor(media.originSeconds! * track.timescale));
          if (base < 0 || base < (ends[entry.id] ?? 0) - 1)
            throw new Error('MP4 track timestamps overlap or require a discontinuity remux.');
          ends[entry.id] = base + entry.duration;
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (entry.timeVersion === 1) view.setBigUint64(entry.timePosition, BigInt(base));
          else view.setUint32(entry.timePosition, base);
        }
        if (!normalized) await store.write(moof.start, bytes);
      }
      media.trackEnds = ends;
    };
    if (job.segments.length > 1) {
      if (!Number.isFinite(media.originSeconds) || media.originSeconds! < 0)
        throw new Error('Invalid stored media timeline origin.');
      media.trackEnds = {};
      for (const segment of job.segments.slice(1))
        await validatePart(segment.start, segment.end - segment.start + 1, true);
    }
    for (let index = job.segments.length; index < parts.length; index++) {
      checkAbort(signal);
      const part = parts[index]!;
      const oldMedia = structuredClone(media),
        oldSegments = job.segments;
      try {
        const record = await mediaRetry(
          () => receive(part, durable, index === 0 ? 1048576 : undefined),
          options,
          () => {
            job.retries++;
            emit(true);
          },
        );
        if (index === 0) tracks = inspectMp4Init(await store.read(durable, record.bytes));
        else await validatePart(durable, record.bytes);
        const segment = {
          start: durable,
          end: durable + record.bytes - 1,
          hash: await hashRegion(store, durable, record.bytes, signal),
        };
        await store.flush();
        job.segments = [...oldSegments, segment];
        media.completed = job.segments.length;
        job.downloaded = durable + record.bytes;
        await records.save(job, { ...record, index });
        durable += record.bytes;
        emit(true);
      } catch (error) {
        job.segments = oldSegments;
        Object.assign(media, oldMedia);
        media.completed = oldSegments.length;
        job.downloaded = durable;
        throw error;
      }
    }
    const end = Math.max(
      ...tracks.map((track) => (media.trackEnds?.[track.id] ?? 0) / track.timescale),
    );
    if (!Number.isFinite(end) || Math.abs(end - plan.duration) > Math.max(1, plan.duration * 0.05))
      throw new Error('MP4 track duration does not match the selected HLS presentation.');
    await store.truncate(durable);
    job.total = durable;
    job.resource.size = durable;
    job.downloaded = durable;
    job.sha256 = await verifyStoredFile(store, job.segments, signal);
    if (job.expectedHash && job.sha256 !== job.expectedHash) {
      job.sha256 = null;
      throw new Error('The assembled media SHA-256 does not match the expected checksum.');
    }
    transition(job, 'ASSEMBLING', 'HLS media assembled and verified; ready to save');
    job.speed = 0;
    job.connections = 0;
    emit(true);
    await checkpoint(job);
  } finally {
    await store.close();
    job.speed = 0;
    job.connections = 0;
    job.connectionSpeeds = [];
    job.activeMs = baseActive + performance.now() - started;
  }
}
