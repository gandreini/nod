function parseWav(bytes: Uint8Array) {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let channels = 0;
  let rate = 0;
  let depth = 0;
  let format = 0;
  let start = -1;
  let length = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (tag(offset) === 'fmt ' && size >= 16) {
      format = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      rate = view.getUint32(offset + 12, true);
      depth = view.getUint16(offset + 22, true);
    } else if (tag(offset) === 'data') {
      start = offset + 8;
      length = Math.min(size, bytes.length - start);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (format !== 1 || depth !== 16 || channels < 1 || rate < 1 || start < 0) return null;
  return { view, channels, rate, start, frames: Math.floor(length / (2 * channels)) };
}

export function wavSeconds(bytes: Uint8Array) {
  const wav = parseWav(bytes);
  return wav ? wav.frames / wav.rate : null;
}

export function wavBars(bytes: Uint8Array, count: number): number[] | null {
  const wav = parseWav(bytes);
  if (!wav) return null;
  const { view, channels, start, frames } = wav;
  if (frames < count) return null;
  const per = Math.floor(frames / count);
  const levels: number[] = [];
  for (let bar = 0; bar < count; bar++) {
    let sum = 0;
    for (let frame = bar * per; frame < (bar + 1) * per; frame++) {
      const value = view.getInt16(start + frame * 2 * channels, true) / 32768;
      sum += value * value;
    }
    levels.push(Math.sqrt(sum / per));
  }
  const peak = Math.max(...levels, 1e-4);
  return levels.map((level) => Math.min(1, Math.max(0.08, Math.sqrt(level / peak))));
}
