/**
 * Name-based (version 5) UUIDs, computed synchronously.
 *
 * The node tree is built synchronously on every load, so the id minter cannot wait on
 * `crypto.subtle.digest`, which is asynchronous. SHA-1 here is used for what RFC 9562 uses it for
 * — spreading a name deterministically over 122 bits — not for security, which is why a small
 * local implementation is acceptable where it would not be for anything secret.
 */

const HEX = "0123456789abcdef";

/** The bytes of a UUID in its canonical `8-4-4-4-12` hex form. */
function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** SHA-1 of `message` (FIPS 180-4), as 20 bytes. */
export function sha1(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let t = 0; t < 16; t++) words[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 80; t++) {
      words[t] = rotateLeft((words[t - 3] ?? 0) ^ (words[t - 8] ?? 0) ^ (words[t - 14] ?? 0) ^ (words[t - 16] ?? 0), 1);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : t < 40 ? [b ^ c ^ d, 0x6ed9eba1]
          : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
            : [b ^ c ^ d, 0xca62c1d6];
      const next = (rotateLeft(a, 5) + f + e + k + (words[t] ?? 0)) >>> 0;
      e = d; d = c; c = rotateLeft(b, 30) >>> 0; b = a; a = next;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  [h0, h1, h2, h3, h4].forEach((word, index) => out.setUint32(index * 4, word));
  return digest;
}

/** The version 5 UUID of `name` under `namespace` (RFC 9562 §5.5). */
export function uuidV5(name: string, namespace: string): string {
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(uuidBytes(namespace));
  input.set(nameBytes, 16);
  const hash = sha1(input).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  let hex = "";
  for (const byte of hash) hex += (HEX[byte >> 4] ?? "") + (HEX[byte & 0x0f] ?? "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
