/** Bounded transport-envelope validation before an untrusted TS packet reaches the converter. */
export const maxTransportPartBytes = 16 * 1024 * 1024;
export class TransportGuard {
  private tail = new Uint8Array();
  private bytes = 0;
  private pmt: number | null = null;
  private streams = new Map<number, number>();
  private continuity = new Map<number, number>();
  push(input: Uint8Array) {
    this.bytes += input.length;
    if (this.bytes > maxTransportPartBytes)
      throw new Error('A TS media part exceeds the 16 MiB converter limit.');
    const data = new Uint8Array(this.tail.length + input.length);
    data.set(this.tail);
    data.set(input, this.tail.length);
    let at = 0;
    for (; at + 188 <= data.length; at += 188) this.packet(data.subarray(at, at + 188));
    this.tail = data.slice(at);
  }
  finish() {
    if (this.tail.length || !this.bytes || this.pmt === null || !this.streams.size)
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
      if (length && data[at]! & 0x80)
        throw new Error('A TS clock discontinuity requires another remux workflow.');
      at += length;
    }
    if (!(control & 1) || at >= 188 || pid === 8191) return;
    const counter = data[3]! & 15,
      previous = this.continuity.get(pid);
    if (previous !== undefined && counter !== (previous + 1) % 16)
      throw new Error('TS packet continuity failed. No incomplete part was committed.');
    this.continuity.set(pid, counter);
    if (pid !== 0 && pid !== this.pmt) return;
    if (!(data[1]! & 0x40))
      throw new Error('Split TS program metadata requires another remux workflow.');
    at += 1 + data[at]!;
    if (at + 3 > 188) throw new Error('Invalid TS metadata pointer.');
    const end = at + 3 + (((data[at + 1]! & 15) << 8) | data[at + 2]!);
    if (end > 188 || end < at + 12) throw new Error('Oversized or truncated TS program metadata.');
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
  }
}
