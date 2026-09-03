/**
 * Copies bytes into a fresh {@link ArrayBuffer}.
 *
 * Reaching for `data.buffer` would be cheaper but wrong: its type is `ArrayBufferLike`, and the view may
 * cover only part of a larger buffer, so handing it to the vault can write the wrong bytes.
 *
 * @param data - The bytes to copy.
 * @returns An {@link ArrayBuffer} holding exactly those bytes.
 */
export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}
