// Cross-checks the streaming hasher against node's crypto, including odd chunk
// sizes that never align with the 64-byte block boundary.
// Run: npx tsx src/lib/sha256.test.ts
import { createHash, randomBytes } from 'node:crypto';
import { createSha256, sha256Hex } from './sha256';

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL ${name}\n  actual   ${String(actual)}\n  expected ${String(expected)}`);
    process.exitCode = 1;
  } else {
    console.log(`pass  ${name}`);
  }
}

function streamDigest(bytes: Uint8Array, chunkSize: number): string {
  const hasher = createSha256();
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    hasher.update(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return hasher.hex();
}

const nodeDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

check('empty input', sha256Hex(new Uint8Array(0)), nodeDigest(Buffer.alloc(0)));
check('known vector "abc"', sha256Hex(new TextEncoder().encode('abc')), nodeDigest(Buffer.from('abc')));
check('one-shot matches crypto', sha256Hex(new TextEncoder().encode('kondukt')), nodeDigest(Buffer.from('kondukt')));

for (const size of [1, 55, 56, 63, 64, 65, 127, 128, 1000, 65_536, 1_048_577]) {
  const bytes = new Uint8Array(randomBytes(size));
  const expected = nodeDigest(Buffer.from(bytes));
  check(`streamed ${size} bytes in 64 KiB chunks`, streamDigest(bytes, 65_536), expected);
  check(`streamed ${size} bytes in 1-byte chunks`, streamDigest(bytes, 1), expected);
}

for (const size of [70, 5000]) {
  const bytes = new Uint8Array(randomBytes(size));
  check(`streamed ${size} bytes in 7-byte chunks`, streamDigest(bytes, 7), nodeDigest(Buffer.from(bytes)));
}

if (process.exitCode) console.error('sha256 self-check failed');
else console.log('all passed');
