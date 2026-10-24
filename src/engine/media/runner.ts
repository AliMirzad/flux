import { createSHA256 } from 'hash-wasm';
import type { EngineOptions } from '../ports';
import { hashRegion, verifyStoredFile } from '../runner';
import { completeBytes, parseContentRange } from '../segmentation/ranges';
import { transition } from '../../domain/state';
import { BandwidthLimiter, SpeedMeter, checkAbort } from '../speed/control';
import { HttpError, numberHeader } from '../network/http';
import { fetchHls, mediaRequest, readMediaBody, mediaRetry } from './network';
import type { HlsPart } from './hls';
import type { MediaCheckpoint, MediaSource } from './types';
import { inspectMp4Init, inspectMoof, type Box, type Mp4Track } from './mp4';
import { createTransportWorker } from './transmux-client';
import { maxTransportPartBytes } from './transport';
import type { TransportPort } from './transmux';
import { decryptHlsPart, HlsCiphertext, loadHlsKey, maxEncryptedPartBytes } from './aes';
import {
  combineMp4Init,
  pairHlsPlans,
  remapMp4Moof,
  type HlsStep,
  type MediaKind,
} from './compose';

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
  if (
    media.audioUrl &&
    new URL(playlist.url).protocol === 'https:' &&
    new URL(media.audioUrl).protocol === 'http:'
  )
    throw new Error('An insecure HLS audio address was blocked.');
  const audio = media.audioUrl ? await fetchHls(media.audioUrl, options) : undefined;
  const paired = audio ? pairHlsPlans(playlist.manifest, audio.manifest) : undefined;
  const plan = paired ?? playlist.manifest;
  const steps: HlsStep[] = plan.init ? [plan.init, ...plan.parts] : plan.parts;
  const transport = plan.transport === 'mpegts';
  const hash = await createSHA256();
  hash.init();
  const encrypted = steps.some((part) => part.encryption || part.companion?.encryption);
  hash.update(
    (paired ? 'flux-pair-v1\n' : '') +
      (encrypted ? 'flux-aes-v1\n' : '') +
      (transport ? 'flux-ts-v1\n' : '') +
      playlist.url +
      '\n' +
      playlist.text,
  );
  if (audio) hash.update('\n' + audio.url + '\n' + audio.text);
  const planHash = hash.digest('hex');
  if (media.planHash && media.planHash !== planHash && job.segments.length)
    throw new Error(
      'The HLS playlist changed. Start a new stream download to avoid mixing different media. Existing partial data is retained.',
    );
  media.planHash = planHash;
  media.transport = plan.transport;
  media.playlistUrl = playlist.url;
  media.duration = plan.duration;
  media.parts = paired ? paired.sourceParts : plan.parts.length;
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
    const parts = steps;
    const completedParts = (count: number) =>
      paired
        ? parts.slice(1, count).reduce((sum, part) => sum + (part.companion ? 2 : 1), 0)
        : count;
    let previous = await records.load();
    if (job.segments.length > parts.length || previous.length !== job.segments.length)
      throw new Error('Media checkpoint metadata is incomplete. Start a new stream download.');
    const keyValidationBytes = previous.reduce(
      (sum, record) =>
        sum +
        (parts[record.index]?.encryption ? 16 : 0) +
        (parts[record.index]?.companion?.encryption ? 16 : 0),
      0,
    );
    for (let index = 0, offset = 0; index < job.segments.length; index++) {
      const segment = job.segments[index]!,
        record = previous[index];
      if (
        segment.start !== offset ||
        segment.end < segment.start ||
        !record ||
        record.index !== index ||
        record.url !== parts[index]!.url ||
        !!record.companion !== !!parts[index]!.companion ||
        (record.companion &&
          (record.companion.url !== parts[index]!.companion!.url ||
            !/^[a-f\d]{64}$/.test(record.companion.sourceHash) ||
            !!parts[index]!.companion!.encryption !== !!record.companion.keyHash)) ||
        ((transport || record.outputBytes !== undefined) &&
          record.outputBytes !== segment.end - segment.start + 1) ||
        !!parts[index]!.encryption !== !!record.keyHash ||
        !/^[a-f\d]{64}$/.test(record.sourceHash)
      )
        throw new Error('Invalid media checkpoint identity or coverage.');
      offset = segment.end + 1;
    }
    if (job.segments.length) await verifyStoredFile(store, job.segments, signal);
    media.completed = completedParts(job.segments.length);
    await store.truncate(durable);
    if (!job.segments.length) {
      await records.clear();
      previous = [];
      media.originSeconds = undefined;
      media.initializationBytes = undefined;
      media.initializationHash = undefined;
      media.trackEnds = {};
      media.sourceTrackIds = undefined;
      media.trackStarts = {};
    }
    transition(job, 'DOWNLOADING', 'Downloading HLS media in playlist order');
    job.note = transport
      ? 'MPEG-TS HLS rendition. Parts are converted to MP4 and verified before saving.'
      : 'MP4 HLS rendition. Parts are assembled in order and validated before saving.';
    await checkpoint(job);

    const writeBuffer = async (offset: number, data: Uint8Array) => {
      for (let at = 0; at < data.length; at += 262144) {
        checkAbort(signal);
        await store.write(offset + at, data.subarray(at, Math.min(at + 262144, data.length)));
      }
    };

    const consumeKey = async (bytes: number) => {
      await limiter.consume(bytes, signal);
      await options.globalThrottle?.(bytes, signal);
      await options.accountPayload?.(bytes, signal);
      received += bytes;
      meter.add(bytes);
      emit();
    };

    const receive = async (
      part: HlsPart,
      offset: number | null,
      maximum?: number,
      index = 0,
      allowanceBefore = 0,
    ): Promise<MediaCheckpoint> => {
      const key =
        part.encryption && offset !== null
          ? await loadHlsKey(part.encryption, options, consumeKey)
          : null;
      const response = await mediaRequest(
        part.url,
        part.range ? { headers: { Range: `bytes=${part.range.start}-${part.range.end}` } } : {},
        options,
      );
      let converter: TransportPort | null = null;
      let plaintext: Uint8Array | null = null;
      const ciphertext = new HlsCiphertext();
      try {
        if (transport) {
          maximum = maxTransportPartBytes;
          if (offset !== null)
            converter = (options.transportFactory ?? createTransportWorker)(signal);
        }
        const plainMaximum = maximum ?? (part.encryption ? maxEncryptedPartBytes : undefined);
        maximum = part.encryption ? (Math.floor(plainMaximum! / 16) + 1) * 16 : maximum;
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
          throw new Error(
            part.encryption
              ? 'An encrypted HLS part exceeds its 16 MiB limit or initialization bound.'
              : transport
                ? 'A TS media part exceeds the 16 MiB converter limit.'
                : 'Media initialization metadata exceeds 1 MiB.',
          );
        if (
          settings.trafficLimit > 0 &&
          (expected === null ||
            expected + keyValidationBytes + (part.encryption ? 16 : 0) + allowanceBefore >
              settings.trafficLimit)
        )
          throw new Error(
            'This media part and its key verification need a known size within one complete download allowance. Increase or disable the allowance for this stream.',
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
          if (part.encryption && offset !== null) ciphertext.append(bytes);
          else if (converter) await converter.push(bytes);
          else if (offset !== null) await store.write(offset + count, bytes);
          sourceHash.update(bytes);
          count += bytes.length;
          received += bytes.length;
          meter.add(bytes.length);
          job.downloaded =
            durable + (offset !== null && !converter && !part.encryption ? count : 0);
          emit();
        });
        if (expected !== null && count !== expected)
          throw new TypeError('Media response was truncated.');
        if (!count) throw new Error('The media part is empty.');
        let outputBytes = count;
        if (key && part.encryption && offset !== null) {
          const decrypted = (plaintext = await decryptHlsPart(
            ciphertext,
            key.key,
            part.encryption.iv,
            signal,
          ));
          if (!decrypted.length || decrypted.length > plainMaximum!)
            throw new Error('Decrypted HLS media exceeds its supported size.');
          outputBytes = decrypted.length;
          for (let at = 0; at < decrypted.length; at += 262144) {
            checkAbort(signal);
            const bytes = decrypted.subarray(at, Math.min(at + 262144, decrypted.length));
            if (converter) await converter.push(bytes);
            else await store.write(offset + at, bytes);
          }
        }
        if (converter && offset !== null) {
          const output = await converter.finish(part.duration!, index);
          const initHash = await createSHA256();
          initHash.init();
          initHash.update(output.initialization);
          const fingerprint = initHash.digest('hex');
          if (index === 0) {
            media.initializationHash = fingerprint;
            media.initializationBytes = output.initialization.length;
          } else if (fingerprint !== media.initializationHash)
            throw new Error('The TS codec initialization changed. Start a new stream download.');
          outputBytes = 0;
          for (const data of index === 0 ? [output.initialization, output.media] : [output.media]) {
            for (let at = 0; at < data.length; at += 262144) {
              checkAbort(signal);
              const chunk = data.subarray(at, Math.min(data.length, at + 262144));
              await store.write(offset + outputBytes, chunk);
              outputBytes += chunk.length;
            }
          }
          job.downloaded = durable + outputBytes;
        }
        return {
          index: 0,
          url: part.url,
          finalUrl: response.url || part.url,
          etag: response.headers.get('etag'),
          fullSize: fullSize ?? count,
          bytes: count,
          sourceHash: sourceHash.digest('hex'),
          outputBytes,
          ...(key ? { keyHash: key.hash } : {}),
        };
      } finally {
        converter?.close();
        plaintext?.fill(0);
        ciphertext.clear();
        job.connections = 0;
        await response.body?.cancel().catch(() => undefined);
      }
    };
    // Strong validators permit a HEAD-only identity check. Otherwise compare every source byte.
    const retainedSources = previous.flatMap((record, index) => [
      { index, part: parts[index]!, record: record as MediaSource },
      ...(record.companion
        ? [{ index, part: parts[index]!.companion!, record: record.companion }]
        : []),
    ]);
    for (const { index, part, record } of retainedSources) {
      if (part.encryption) {
        const key = await mediaRetry(
          () => loadHlsKey(part.encryption!, options, consumeKey),
          options,
        );
        if (key.hash !== record.keyHash)
          throw new Error(
            'A completed HLS decryption key changed. Start a new stream download. Partial data is retained.',
          );
      }
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
          () => receive(part, null, !transport && index === 0 ? 1048576 : undefined, index),
          options,
        );
        if (fresh.bytes !== record.bytes || fresh.sourceHash !== record.sourceHash)
          throw new Error(
            'A completed HLS source part changed. Start a new stream download. Partial data is retained.',
          );
      }
    }
    let tracks: Mp4Track[] = [];
    const initializationLength = () =>
      transport ? media.initializationBytes! : job.segments[0]!.end + 1;
    if (job.segments.length) {
      const length = initializationLength();
      if (
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > 1048576 ||
        length > job.segments[0]!.end + 1
      )
        throw new Error('Invalid stored media initialization boundary.');
      tracks = inspectMp4Init(await store.read(0, length));
    }
    const readPartBoxes = async (start: number, length: number) => {
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
      return boxes;
    };
    const validatePart = async (start: number, length: number, normalized = false) => {
      const boxes = await readPartBoxes(start, length);
      const moofs = boxes.filter((box) => box.type === 'moof'),
        mdats = boxes.filter((box) => box.type === 'mdat');
      if (!moofs.length || !mdats.length)
        throw new Error('The HLS segment contains no MP4 fragments.');
      const ends = { ...media.trackEnds };
      const starts = { ...media.trackStarts };
      if (!normalized && media.originSeconds === undefined) {
        const first = new Map<number, number>();
        for (const moof of moofs) {
          if (moof.size > 1048576) throw new Error('MP4 fragment metadata exceeds 1 MiB.');
          for (const entry of inspectMoof(await store.read(moof.start, moof.size), tracks))
            if (!first.has(entry.id)) first.set(entry.id, entry.base);
          if (first.size === tracks.length) break;
        }
        if (first.size !== tracks.length)
          throw new Error('The first media part must initialize all selected tracks.');
        media.originSeconds = Math.min(
          ...tracks.map((track) => first.get(track.id)! / track.timescale),
        );
      }
      for (const moof of moofs) {
        if (moof.size > 1048576) throw new Error('MP4 fragment metadata exceeds 1 MiB.');
        const bytes = await store.read(moof.start, moof.size),
          entries = inspectMoof(bytes, tracks);
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
          let base =
            entry.base - (normalized ? 0 : Math.floor(media.originSeconds! * track.timescale));
          if (transport && !normalized) {
            const wrap = (2 ** 33 / 90000) * track.timescale;
            const cycles = Math.max(0, Math.round(((ends[entry.id] ?? 0) - base) / wrap));
            if (cycles > 7) throw new Error('The TS timeline exceeds its supported clock range.');
            base += Math.round(cycles * wrap);
          }
          // Conversion from the 90 kHz TS clock can round adjacent AAC starts
          // across at most two audio samples. Keep samples contiguous in that case.
          if (
            transport &&
            track.kind === 'audio' &&
            base < (ends[entry.id] ?? 0) &&
            (ends[entry.id] ?? 0) - base <= 2
          )
            base = ends[entry.id]!;
          if (base < 0 || base < (ends[entry.id] ?? 0) - 1)
            throw new Error('MP4 track timestamps overlap or require a discontinuity remux.');
          if (starts[entry.id] === undefined) starts[entry.id] = base / track.timescale;
          ends[entry.id] = base + entry.duration;
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (entry.timeVersion === 1) view.setBigUint64(entry.timePosition, BigInt(base));
          else view.setUint32(entry.timePosition, base);
        }
        if (!normalized) await writeBuffer(moof.start, bytes);
      }
      media.trackEnds = ends;
      media.trackStarts = starts;
    };
    const validateTiming = (part: HlsStep) => {
      if (!paired || !part.expectedEnds) return;
      for (const track of tracks) {
        const expected = part.expectedEnds[track.kind];
        if (expected === undefined) continue;
        const elapsed =
          media.trackEnds![track.id]! / track.timescale - media.trackStarts![track.id]!;
        if (!Number.isFinite(elapsed) || Math.abs(elapsed - expected) > 0.25)
          throw new Error(
            'The separate ' + track.kind + ' timeline does not match its HLS playlist.',
          );
      }
      const starts = tracks.map((track) => media.trackStarts![track.id]!);
      if (Math.max(...starts) - Math.min(...starts) > 0.5)
        throw new Error('The separate audio and video start times are not aligned.');
    };
    const remapPart = async (
      start: number,
      length: number,
      kind: MediaKind,
      index: number,
      ordinal: number,
    ) => {
      const target = tracks.find((track) => track.kind === kind)!;
      const sourceId = media.sourceTrackIds?.[kind];
      if (!target || !Number.isInteger(sourceId) || !sourceId || sourceId > 0xffffffff)
        throw new Error('Invalid stored source track identity.');
      for (const moof of (await readPartBoxes(start, length)).filter(
        (box) => box.type === 'moof',
      )) {
        if (moof.size > 1048576 || ordinal >= 65536)
          throw new Error('Too much separate-track fragment metadata.');
        const output = remapMp4Moof(
          await store.read(moof.start, moof.size),
          { ...target, id: sourceId },
          target.id,
          index * 65536 + ++ordinal,
        );
        await writeBuffer(moof.start, output);
      }
      return ordinal;
    };
    if (job.segments.length > (transport ? 0 : 1)) {
      if (!Number.isFinite(media.originSeconds) || media.originSeconds! < 0)
        throw new Error('Invalid stored media timeline origin.');
      media.trackEnds = {};
      media.trackStarts = {};
      for (const [index, segment] of job.segments.entries()) {
        if (!transport && index === 0) continue;
        const prefix = transport && index === 0 ? initializationLength() : 0;
        await validatePart(segment.start + prefix, segment.end - segment.start + 1 - prefix, true);
        validateTiming(parts[index]!);
      }
    }
    for (let index = job.segments.length; index < parts.length; index++) {
      checkAbort(signal);
      const part = parts[index]!;
      const oldMedia = structuredClone(media),
        oldSegments = job.segments;
      try {
        const record = await mediaRetry(
          () => receive(part, durable, !transport && index === 0 ? 1048576 : undefined, index),
          options,
          () => {
            job.retries++;
            emit(true);
          },
        );
        let outputBytes = record.outputBytes ?? record.bytes;
        const primaryBytes = outputBytes;
        if (part.companion) {
          const second = await mediaRetry(
            () =>
              receive(
                part.companion!,
                durable + primaryBytes,
                index === 0 ? 1048576 : undefined,
                index,
                record.bytes + (part.encryption ? 16 : 0),
              ),
            options,
            () => {
              job.retries++;
              emit(true);
            },
          );
          const { index: unusedIndex, outputBytes: secondBytes, ...identity } = second;
          record.companion = identity;
          outputBytes += secondBytes ?? second.bytes;
          if (index === 0) {
            const combined = combineMp4Init(
              await store.read(durable, primaryBytes),
              await store.read(durable + primaryBytes, secondBytes ?? second.bytes),
            );
            media.sourceTrackIds = combined.sourceIds;
            outputBytes = combined.initialization.length;
            await store.truncate(durable);
            await writeBuffer(durable, combined.initialization);
          }
        }
        record.outputBytes = outputBytes;
        if (index === 0)
          tracks = inspectMp4Init(
            await store.read(durable, transport ? media.initializationBytes! : outputBytes),
          );
        if (transport || index > 0) {
          const prefix = transport && index === 0 ? media.initializationBytes! : 0;
          if (paired) {
            const ordinal = await remapPart(durable, primaryBytes, part.track!, index, 0);
            if (part.companion)
              await remapPart(
                durable + primaryBytes,
                outputBytes - primaryBytes,
                part.companion.track,
                index,
                ordinal,
              );
          }
          await validatePart(durable + prefix, outputBytes - prefix);
          validateTiming(part);
        }
        const segment = {
          start: durable,
          end: durable + outputBytes - 1,
          hash: await hashRegion(store, durable, outputBytes, signal),
        };
        await store.flush();
        job.segments = [...oldSegments, segment];
        media.completed = completedParts(job.segments.length);
        job.downloaded = durable + outputBytes;
        await records.save(job, { ...record, index });
        durable += outputBytes;
        emit(true);
      } catch (error) {
        job.segments = oldSegments;
        Object.assign(media, oldMedia);
        media.completed = completedParts(oldSegments.length);
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
