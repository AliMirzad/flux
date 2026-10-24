/** Bounded transport-envelope validation before an untrusted TS packet reaches the converter. */
export const maxTransportPartBytes = 16 * 1024 * 1024;
export class TransportGuard {
  constructor(private epochBoundary = false) {}
  private payloadSeen = new Set<number>();
  private tail = new Uint8Array();
  private bytes = 0;
  private pmt: number | null = null;
  private streams = new Map<number, number>();
  private continuity = new Map<number, number>();
  private sections = new Map<number, Uint8Array>();
  private output: Uint8Array[] = [];
  private normalizedBytes = 0;
  push(input: Uint8Array) {
    this.bytes += input.length;
    if (this.bytes > maxTransportPartBytes)
      throw new Error('A TS media part exceeds the 16 MiB converter limit.');
    const data = new Uint8Array(this.tail.length + input.length);
    data.set(this.tail);
    data.set(input, this.tail.length);
    this.output = [];
    let at = 0;
    for (; at + 188 <= data.length; at += 188) this.packet(data.subarray(at, at + 188));
    this.tail = data.slice(at);
    const output = new Uint8Array(this.output.length * 188);
    this.output.forEach((packet, index) => output.set(packet, index * 188));
    this.output = [];
    return output;
  }
  finish() {
    if (
      this.sections.size ||
      this.tail.length ||
      !this.bytes ||
      this.pmt === null ||
      !this.streams.size
    )
      throw new Error('The TS segment is truncated or missing its program metadata.');
  }
  private packet(data: Uint8Array) {
    if (data[0] !== 0x47 || data[1]! & 0x80 || data[3]! & 0xc0)
      throw new Error('Corrupt or scrambled TS packets are not supported.');
    const pid = ((data[1]! & 31) << 8) | data[2]!,
      control = (data[3]! >> 4) & 3;
    if (!control) throw new Error('Invalid TS adaptation control.');
    let at = 4;
    if (control & 2) {
      const length = data[at++]!;
      if (at + length > 188) throw new Error('Invalid TS adaptation length.');
      if (length && data[at]! & 0x80 && (!this.epochBoundary || this.payloadSeen.has(pid)))
        throw new Error('A TS clock discontinuity requires another remux workflow.');
      at += length;
    }
    if (!(control & 1) || at >= 188 || pid === 8191) return;
    const counter = data[3]! & 15,
      previous = this.continuity.get(pid);
    if (previous !== undefined && counter !== (previous + 1) % 16)
      throw new Error('TS packet continuity failed. No incomplete part was committed.');
    this.continuity.set(pid, counter);
    this.payloadSeen.add(pid);
    if (pid !== 0 && pid !== this.pmt) {
      this.emitPacket(data);
      return;
    }
    const append = (payload: Uint8Array, starting: boolean) => {
      let current = this.sections.get(pid) ?? new Uint8Array();
      if (!starting && !current.length)
        throw new Error('TS program metadata continuation has no start.');
      for (const byte of payload) {
        if (!current.length && byte === 255) break;
        const next = new Uint8Array(current.length + 1);
        next.set(current);
        next[current.length] = byte;
        current = next;
        if (current.length < 3) continue;
        const length = 3 + (((current[1]! & 15) << 8) | current[2]!);
        if (length > 1024 || length < 12) throw new Error('Invalid TS program metadata size.');
        if (current.length === length) {
          this.section(current, pid);
          current = new Uint8Array();
        }
      }
      if (current.length) this.sections.set(pid, current);
      else this.sections.delete(pid);
    };
    if (data[1]! & 0x40) {
      const pointer = data[at++]!;
      if (at + pointer > 188) throw new Error('Invalid TS metadata pointer.');
      if (this.sections.has(pid)) {
        append(data.subarray(at, at + pointer), false);
        if (this.sections.has(pid)) throw new Error('Truncated TS metadata before next section.');
      }
      at += pointer;
      append(data.subarray(at), true);
    } else append(data.subarray(at), false);
  }
  private section(data: Uint8Array, pid: number) {
    const at = 0,
      end = data.length;
    if (!(data[at + 1]! & 0x80) || !(data[at + 5]! & 1) || data[at + 6] !== 0 || data[at + 7] !== 0)
      throw new Error('Select a current, single-section TS program map.');
    let crc = 0xffffffff;
    for (let position = at; position < end; position++) {
      crc ^= data[position]! << 24;
      for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    if (crc !== 0) throw new Error('TS program metadata failed its CRC check.');
    if (pid === 0) {
      if (data[at] !== 0) throw new Error('Invalid TS program association.');
      let programs = 0;
      for (let position = at + 8; position + 4 <= end - 4; position += 4) {
        const program = (data[position]! << 8) | data[position + 1]!;
        if (!program) continue;
        if (++programs > 1) throw new Error('Select a single-program TS rendition.');
        const next = ((data[position + 2]! & 31) << 8) | data[position + 3]!;
        if (next < 16 || next === 8191) throw new Error('Invalid TS program identifier.');
        if (this.pmt !== null && this.pmt !== next)
          throw new Error('The TS program changed within a segment.');
        this.pmt = next;
      }
      this.emitTable(data, pid);
      return;
    }
    if (data[at] !== 2 || at + 12 > end - 4) throw new Error('Invalid TS program map.');
    let position = at + 12 + (((data[at + 10]! & 15) << 8) | data[at + 11]!);
    if (position > end - 4) throw new Error('Truncated TS program descriptors.');
    const streams = new Map<number, number>();
    while (position < end - 4) {
      if (position + 5 > end - 4) throw new Error('Truncated TS stream descriptor.');
      const type = data[position]!,
        id = ((data[position + 1]! & 31) << 8) | data[position + 2]!;
      const length = ((data[position + 3]! & 15) << 8) | data[position + 4]!;
      if (
        position + 5 + length > end - 4 ||
        streams.has(id) ||
        id < 16 ||
        id === 8191 ||
        id === this.pmt
      )
        throw new Error('Invalid TS stream descriptor.');
      if (![0x1b, 0x0f, 0x15].includes(type)) throw new Error('Select an H.264/AAC TS rendition.');
      streams.set(id, type);
      position += 5 + length;
    }
    if (
      [0x1b, 0x0f].some(
        (type) => [...streams.values()].filter((value) => value === type).length > 1,
      ) ||
      streams.size > 3
    )
      throw new Error('Select one video/audio TS rendition before downloading.');
    if (this.streams.size && JSON.stringify([...this.streams]) !== JSON.stringify([...streams]))
      throw new Error('The TS codec/program map changed within a segment.');
    this.streams = streams;
    // Validate complete metadata, then strip optional descriptors for the converter.
    // Encoded elementary streams pass through unchanged.
    const compact = new Uint8Array(12 + streams.size * 5 + 4);
    compact.set(data.subarray(0, 12));
    compact[10] = 0xf0;
    compact[11] = 0;
    let cursor = 12;
    for (const [id, type] of streams) {
      compact.set([type, 0xe0 | (id >> 8), id & 255, 0xf0, 0], cursor);
      cursor += 5;
    }
    this.emitTable(compact, pid, true);
  }
  private emitTable(section: Uint8Array, pid: number, checksum = false) {
    if (section.length > 183) throw new Error('Too much TS program association metadata.');
    if (checksum) {
      section[1] = 0xb0 | ((section.length - 3) >> 8);
      section[2] = (section.length - 3) & 255;
      let crc = 0xffffffff;
      for (const byte of section.subarray(0, -4)) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++)
          crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
      }
      new DataView(section.buffer, section.byteOffset, section.byteLength).setUint32(
        section.length - 4,
        crc >>> 0,
      );
    }
    const packet = new Uint8Array(188).fill(255);
    packet.set([0x47, 0x40 | (pid >> 8), pid & 255, 0x10, 0]);
    packet.set(section, 5);
    this.emitPacket(packet);
  }
  private emitPacket(packet: Uint8Array) {
    this.normalizedBytes += 188;
    if (this.normalizedBytes > maxTransportPartBytes + 1048576)
      throw new Error('Normalized TS packets exceed the converter bound.');
    this.output.push(packet);
  }
}
