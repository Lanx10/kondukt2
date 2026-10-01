/**
 * Streaming SHA-256.
 *
 * ponytail: hand-rolled because `expo-crypto`'s `digest` needs the whole file
 * in one ArrayBuffer, and an 84 MB release APK does not fit on a low-end
 * device. Upgrade path: if Expo ever exposes an incremental digest, delete
 * this file and call it — the API here is one `update()` per chunk.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export interface Sha256 {
  update(bytes: Uint8Array): Sha256;
  hex(): string;
}

/** Incremental SHA-256: feed any chunk sizes, then read `hex()` once. */
export function createSha256(): Sha256 {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const block = new Uint8Array(64);
  const w = new Uint32Array(64);
  let filled = 0;
  let total = 0;

  const compress = (): void => {
    for (let i = 0; i < 16; i++) {
      const o = i * 4;
      w[i] = (block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  };

  return {
    update(bytes: Uint8Array): Sha256 {
      total += bytes.length;
      let offset = 0;
      while (offset < bytes.length) {
        const take = Math.min(64 - filled, bytes.length - offset);
        block.set(bytes.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === 64) { compress(); filled = 0; }
      }
      return this;
    },
    hex(): string {
      const bits = total * 8;
      const tail = new Uint8Array(filled < 56 ? 64 : 128);
      tail.set(block.subarray(0, filled));
      tail[filled] = 0x80;
      // Length in bits as a 64-bit big-endian integer.
      const high = Math.floor(bits / 0x100000000);
      const low = bits >>> 0;
      tail[tail.length - 8] = (high >>> 24) & 0xff;
      tail[tail.length - 7] = (high >>> 16) & 0xff;
      tail[tail.length - 6] = (high >>> 8) & 0xff;
      tail[tail.length - 5] = high & 0xff;
      tail[tail.length - 4] = (low >>> 24) & 0xff;
      tail[tail.length - 3] = (low >>> 16) & 0xff;
      tail[tail.length - 2] = (low >>> 8) & 0xff;
      tail[tail.length - 1] = low & 0xff;
      for (let i = 0; i < tail.length; i += 64) {
        block.set(tail.subarray(i, i + 64));
        compress();
      }
      let out = '';
      for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, '0');
      return out;
    },
  };
}

/** One-shot convenience for buffers that are already in memory. */
export function sha256Hex(bytes: Uint8Array): string {
  return createSha256().update(bytes).hex();
}
