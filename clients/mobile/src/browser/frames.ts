export const maxFrameBytes = 4 * 1024 * 1024;

export function frameReader(onFrame: (bytes: Uint8Array) => void) {
  let bytes = new Uint8Array(4);
  let offset = 0;
  let header = true;
  return (chunk: Uint8Array) => {
    let consumed = 0;
    while (consumed < chunk.length) {
      const length = Math.min(bytes.length - offset, chunk.length - consumed);
      bytes.set(chunk.subarray(consumed, consumed + length), offset);
      offset += length;
      consumed += length;
      if (offset < bytes.length) continue;
      if (header) {
        const size = new DataView(bytes.buffer).getUint32(0);
        if (!size || size > maxFrameBytes) throw new Error('Invalid browser frame.');
        bytes = new Uint8Array(size);
      } else {
        onFrame(bytes);
        bytes = new Uint8Array(4);
      }
      offset = 0;
      header = !header;
    }
  };
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(start, start + 8192) as unknown as number[],
    );
  return btoa(binary);
}
