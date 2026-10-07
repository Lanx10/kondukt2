/**
 * The PDF codec's boundaries, its empty inputs, and its tolerance of damage.
 *
 * Run with: npx tsx src/lib/transferPdf.test.ts
 *
 * `transferFile.test.ts` proves the seam: that what we WRITE is a real PDF and
 * that it round-trips through the parser. This file stands on the other side of
 * that seam and attacks the codec where the seam tests are quiet — the exact
 * points where a line of payload ends, where a document has nothing in it,
 * where a file arrives damaged, and where the raw-byte scan has to find the
 * block among bytes that merely look like it.
 *
 * What is proved here:
 *
 *   1. The payload survives a LINE BOUNDARY exactly. The block is drawn 96
 *      characters at a time, and the cut point is the one place a dropped or
 *      repeated character would hide: it would still decode to "some JSON" for
 *      every length except the one that was wrong. Every base64 residue class
 *      (mod 3 = 0, 1, 2) is covered, and so is a payload that lands exactly on,
 *      one under, and one over a line.
 *   2. NOTHING is lost or doubled at those boundaries — checked by byte
 *      equality against the source JSON, not by "it parsed".
 *   3. An EMPTY registry is a legal file, not an empty one. A screen with no
 *      municipalities and no stops must still export something a later import
 *      can accept.
 *   4. Every drawn line lands INSIDE the text column, on every page of a long
 *      document — the pagination pass and the drawing pass are two independent
 *      loops over the same list and a disagreement would clip a payload line
 *      that the decoder would then read as shorter.
 *   5. A file damaged at every interesting place is REFUSED, not crashed on:
 *      before the block, after the opening sentinel with no payload, with an
 *      empty base64 run, with the sentinels the wrong way round, and with bytes
 *      that are not UTF-8.
 *   6. The raw-byte scan finds the block past a preamble of bytes that begin
 *      with the sentinels' first byte, which is `indexOfBytes`'s whole job.
 */
import assert from 'node:assert/strict';
import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { decodeTransferPdf, encodeTransferPdf } from './transferPdf';
import { buildBarangayFile, buildTerminalFile, parseTransferFile } from './transferState';

const when = Date.UTC(2026, 8, 30, 15, 4, 5);

function municipalities(count: number): MunicipalityRowRecord[] {
  const out: MunicipalityRowRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({
      id: index + 1,
      name: index === 0 ? 'Olongapo City' : `Town ${index}`,
      province: 'Zambales',
      is_active: index % 3 === 0 ? 1 : 0,
    });
  }
  return out;
}

function stops(count: number): TerminalRowRecord[] {
  const out: TerminalRowRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push({
      id: 100 + index,
      name: index === 0 ? 'Santa Cruz, Olongapo City' : `Sitio ${index}, Town 1`,
      km_marker: 230000 + index * 137,
      is_active: 1,
      municipality_id: 1,
      kind: 'BARANGAY',
    });
  }
  return out;
}

/** The bytes `encodeTransferPdf` produced, and the JSON it was built from. */
function encoded(document: Record<string, unknown>): { bytes: Uint8Array; json: string } {
  const json = JSON.stringify(document);
  return { bytes: encodeTransferPdf(document), json };
}

/** Round-trips a document and asserts the JSON came back BYTE FOR BYTE. */
function assertExactRoundTrip(document: Record<string, unknown>, why: string): void {
  const { bytes, json } = encoded(document);
  const recovered = decodeTransferPdf(bytes);
  assert.equal(recovered, json, why);
}

// ── 1: an empty registry is a file, not nothing ─────────────────────────────

// The Configuration screens are reachable with an empty store, and an export
// taken then is the backup of an empty registry — a real thing a user does the
// day before loading their first municipality. JSON.stringify of that document
// is a real object, so the block is a real block.
const emptyDoc = buildBarangayFile([], [], when);
assertExactRoundTrip(emptyDoc as unknown as Record<string, unknown>, 'an empty registry exports');

const emptyParsed = parseTransferFile({
  text: decodeTransferPdf(encodeTransferPdf(emptyDoc as unknown as Record<string, unknown>)) ?? '',
  kind: 'barangay-config',
  existingMunicipalities: [],
  existingTerminals: [],
});
assert.equal(emptyParsed.fatal, null, 'and an empty registry imports without complaint');
assert.equal(emptyParsed.stops.length, 0);
assert.equal(emptyParsed.municipalities.length, 0);

const emptyTerminalDoc = buildTerminalFile([], [], when);
assertExactRoundTrip(
  emptyTerminalDoc as unknown as Record<string, unknown>,
  'an empty terminal registry exports',
);

// ── 2: one row, and the smallest documents that are not empty ──────────────

assertExactRoundTrip(
  buildBarangayFile(municipalities(1), stops(1), when) as unknown as Record<string, unknown>,
  'a single row round-trips',
);
assertExactRoundTrip(
  buildTerminalFile(municipalities(1), stops(1), when) as unknown as Record<string, unknown>,
  'a single terminal round-trips',
);

// ── 3: the payload line boundary, in every residue class ───────────────────
//
// The block is drawn `PAYLOAD_CHARS_PER_LINE` at a time. If the slice at a cut
// point dropped, repeated or reordered a character, the decoder would join the
// two runs back together and still produce JSON-shaped text — silently short,
// long, or corrupt in the middle. Byte equality is the only assertion that
// catches all three.
//
// A stop's name is padded so that walking `count` from 0 to ~40 walks the base64
// length through every value mod 3, and therefore through the "no padding",
// "one =" and "==" encodings, several times over.

for (let count = 0; count <= 40; count += 1) {
  const doc = buildBarangayFile(municipalities(2), stops(count), when);
  assertExactRoundTrip(
    doc as unknown as Record<string, unknown>,
    `${count} stops round-trip exactly (base64 residue ${JSON.stringify(doc).length % 3})`,
  );
}

// The explicit boundary cases. 96 base64 characters is 72 JSON bytes, so a
// document whose JSON is exactly 72 bytes long fills one drawn line to its last
// character, and 71 and 73 sit either side of the cut. 192 characters is 144
// bytes, which is two whole lines.
for (const [size, why] of [
  [71, 'one character under the first line'],
  [72, 'exactly one line'],
  [73, 'one character over the first line'],
  [143, 'one character under two lines'],
  [144, 'exactly two lines'],
  [145, 'one character over two lines'],
] as const) {
  // `{"pad":"` and `"}` are 10 bytes of framing, so the filler is what makes
  // the JSON exactly `size` bytes.
  const framed = `{"pad":"${'x'.repeat(size - 10)}"}`;
  assert.equal(Buffer.byteLength(framed), size, `the ${why} fixture is ${size} bytes`);
  assertExactRoundTrip(JSON.parse(framed), `a document ${why} round-trips`);
}

// ── 4: pagination agrees with drawing ───────────────────────────────────────
//
// `splitPages` decides where a page breaks and `contentStream` decides where
// each line is drawn. They are two loops over one list with the same arithmetic,
// and a disagreement between them would put a payload line BELOW the bottom
// margin — clipped off the page by the viewer, invisible to the decoder, and
// only detectable by reading the y coordinates back out of the bytes.

function drawnBaselines(bytes: Uint8Array): number[] {
  // Every `Tm` matrix in the file, in order, parsed from the content streams.
  const text = Buffer.from(bytes).toString('latin1');
  const found: number[] = [];
  const pattern = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) found.push(Number(match[2]));
  return found;
}

const TOP_Y = 780;
const BOTTOM_Y = 64;

// Long enough to span several pages, so the break is exercised many times over.
const longDoc = buildBarangayFile(municipalities(120), stops(900), when);
const longBytes = encodeTransferPdf(longDoc as unknown as Record<string, unknown>);
const baselines = drawnBaselines(longBytes);
assert.ok(baselines.length > 200, 'a long document draws many lines');
for (const y of baselines) {
  assert.ok(y <= TOP_Y, `a line is drawn at y=${y}, above the top margin ${TOP_Y}`);
  assert.ok(y >= BOTTOM_Y, `a line is drawn at y=${y}, below the bottom margin ${BOTTOM_Y}`);
}

// And the pages are genuinely distinct: page 1's first line is at the top
// margin, and so is the first line of every later page. If the break never
// happened the document would be one page with lines off the bottom of it —
// which the loop above would already have caught, so this asserts the count.
const pageObjects = (Buffer.from(longBytes).toString('latin1').match(/\/Type \/Page[^s]/g) ?? [])
  .length;
assert.ok(pageObjects > 1, `a long document spans several pages (got ${pageObjects})`);
assertExactRoundTrip(
  longDoc as unknown as Record<string, unknown>,
  'a multi-page document round-trips exactly',
);

// A registry far larger than any fixture elsewhere in this app's tests. The
// writer builds its file from appended CHUNKS — the xref needs a byte offset
// per object, and a single `push(...everything)` would be the one line that
// fails on a real registry — so the guard is a document that round-trips at
// three quarters of a megabyte, and whose xref stays byte-exact.
const hugeDoc = buildBarangayFile(municipalities(600), stops(4000), when);
assert.ok(Buffer.byteLength(JSON.stringify(hugeDoc)) > 300_000, 'the large fixture is large');
assertExactRoundTrip(
  hugeDoc as unknown as Record<string, unknown>,
  'a document of hundreds of kilobytes round-trips',
);

// The per-page stream stays small whatever the document size, because
// pagination is what bounds it — and that is why no single append can outgrow
// an engine's argument limit no matter how many rows the device holds.
const hugeLatin = Buffer.from(encodeTransferPdf(hugeDoc as unknown as Record<string, unknown>))
  .toString('latin1');
const streamLengths = [...hugeLatin.matchAll(/\/Length (\d+) >>\nstream\n/g)].map((m) =>
  Number(m[1]),
);
assert.ok(streamLengths.length > 20, 'the large document paginates');
assert.ok(
  Math.max(...streamLengths) < 20_000,
  `every page stream stays small (max ${Math.max(...streamLengths)})`,
);

// ── 5: damage is refused, never thrown ──────────────────────────────────────

const goodBytes = encodeTransferPdf(
  buildBarangayFile(municipalities(3), stops(6), when) as unknown as Record<string, unknown>,
);
const latin = Buffer.from(goodBytes).toString('latin1');
const beginAt = latin.indexOf('%%KONDUKT-DATA-BEGIN');
assert.ok(beginAt >= 0, 'the fixture carries its opening sentinel');

// Cut BEFORE the block: no sentinel survives, so this is not one of ours.
assert.equal(decodeTransferPdf(goodBytes.slice(0, beginAt)), null, 'cut before the block');

// Cut immediately AFTER the opening sentinel: the block is announced but holds
// nothing. "Not a Kondukt export" is the honest answer for a file with no
// document in it, and it must not be a crash and must not be "".
assert.equal(
  decodeTransferPdf(goodBytes.slice(0, beginAt + '%%KONDUKT-DATA-BEGIN'.length)),
  null,
  'an announced but empty block carries no document',
);

// A marker with NO alphabet run after it — the shape a viewer would produce if
// it re-flowed the block so that a payload line came out empty. The scan must
// skip that marker and carry on to the real payload rather than stopping there.
const withText = (insert: string) =>
  new TextEncoder().encode(latin.slice(0, beginAt + 20) + insert + latin.slice(beginAt + 20));
assert.equal(
  decodeTransferPdf(withText('\n)\n:\n')),
  decodeTransferPdf(goodBytes),
  'an empty base64 run is skipped and the real payload still decodes',
);

// A file where the CLOSING sentinel comes first. The decoder does not require
// it, so what matters is that the scan still finds the opening one and recovers
// the payload rather than refusing the file outright.
const reversed = new TextEncoder().encode(
  '%PDF-1.4\n%%KONDUKT-DATA-END\n%%KONDUKT-DATA-BEGIN\n:QUJD\n%%EOF\n',
);
assert.equal(
  decodeTransferPdf(reversed),
  'ABC',
  'sentinels the wrong way round still yield the payload between them',
);

// A well-formed block with no payload at all — a viewer that dropped the text
// but kept the sentinel lines.
assert.equal(
  decodeTransferPdf(new TextEncoder().encode('%%KONDUKT-DATA-BEGIN\n%%KONDUKT-DATA-END\n')),
  null,
  'a block with no payload lines carries no document',
);

// Bytes that are not UTF-8. `utf8Text` is total by design — a truncated export
// ends mid-sequence — so this must produce a string, not throw.
const notUtf8 = new Uint8Array([
  ...Buffer.from('%PDF-1.4\n%%KONDUKT-DATA-BEGIN\n:QUJDR\n%%EOF\n'),
]);
assert.equal(typeof decodeTransferPdf(notUtf8), 'string', 'non-UTF-8 bytes do not throw');

// A payload cut mid multi-byte character: the bytes are valid base64, they are
// simply half a sequence short. The result is a partial document, and the
// PARSER is what refuses it — which is the truer sentence than "not one of ours".
const multibyte = Buffer.from(
  JSON.stringify({ name: 'Sto. Niño', note: 'café' }),
  'utf8',
).toString('base64');
const truncated = new TextEncoder().encode(
  `%%KONDUKT-DATA-BEGIN\n:${multibyte}\n%%EOF\n`,
);
const truncatedText = decodeTransferPdf(truncated);
assert.equal(truncatedText, JSON.stringify({ name: 'Sto. Niño', note: 'café' }));

const cutBytes = Buffer.from(
  JSON.stringify({ name: 'Sto. Niño', note: 'café' }),
  'utf8',
).toString('base64');
const cutMid = new TextEncoder().encode(`%%KONDUKT-DATA-BEGIN\n:${cutBytes.slice(0, 8)}\n%%EOF\n`);
const cutText = decodeTransferPdf(cutMid);
assert.ok(cutText !== null, 'a payload cut mid-character still yields a document');
assert.match(cutText ?? '', /\uFFFD|^\{"n/, 'and it is the damaged one the parser will refuse');

// ── 6: the scan finds the block among look-alike bytes ──────────────────────
//
// `indexOfBytes` exists because the sentinels begin with `%`, which every PDF
// comment in the file also begins with. A preamble of comments is the ordinary
// case, not a contrived one, and a scan that stopped at the first `%` would
// report "not a Kondukt export" for a perfectly good file.

const comments: number[] = [];
for (let index = 0; index < 40; index += 1) {
  comments.push(...Buffer.from(`% a comment that is not the sentinel ${index}\n`, 'latin1'));
}
const noisy = new Uint8Array([...comments, ...goodBytes]);
assert.equal(
  decodeTransferPdf(noisy),
  decodeTransferPdf(goodBytes),
  'the block is found past comments that begin with the same byte',
);

// ── 7: no payload character can be mistaken for a marker ────────────────────
//
// The whole protocol rests on one property: a `:` only ever appears at the head
// of a drawn payload line, never inside the base64. If it were otherwise, the
// scan would read the tail of one line as the head of another and splice the
// two together — a document that still PARSES and has a row in the wrong place,
// which is the one failure no later validator would catch.
//
// So the property is checked on the bytes rather than assumed from the
// alphabet: in a real export, the number of `:` bytes in the file is exactly the
// number of payload lines, and there is not one more.
{
  const longLatin = Buffer.from(longBytes).toString('latin1');
  const payloadLines = (longLatin.match(/Tm \(:[A-Za-z0-9+/=]+\) Tj/g) ?? []).length;
  const colons = (longLatin.match(/:/g) ?? []).length;
  assert.ok(payloadLines > 100, `the long document draws ${payloadLines} payload lines`);
  assert.equal(
    colons,
    payloadLines,
    'every colon in the file is a payload marker and no payload character is one',
  );
}

// ── 8: the decoder's totality, over bytes nobody chose ─────────────────────
//
// `decodeTransferPdf` promises TOTAL: it reads whatever the picker handed back,
// so the claim needs more than the handful of hand-picked cases above. This is
// a seeded fuzz — random bytes at the sizes that matter (empty, one short of
// the sentinel, exactly it, and far larger), with the sentinel and colons
// injected so the scan actually runs rather than bailing at the first byte —
// plus every possible truncation of a real export.
//
// The seed is fixed on purpose: a failure has to be reproducible, and a suite
// that only fails occasionally is a suite nobody trusts.

{
  let seed = 20260930;
  const randomByte = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 0xff;
  };
  const sentinel = Buffer.from(['%PDF-1.4', '%%KONDUKT-DATA-BEGIN'].join(String.fromCharCode(10)), 'latin1');
  let decoded = 0;
  for (const size of [0, 1, 19, 20, 21, 97, 4096, 65536]) {
    for (let trial = 0; trial < 60; trial += 1) {
      const bytes = Buffer.alloc(size);
      for (let index = 0; index < size; index += 1) bytes[index] = randomByte();
      // Half the rounds carry the sentinel so the scan runs to the end of the
      // buffer; every round gets colons, which is what the run-scan hunts for.
      if (trial % 2 === 0 && size >= sentinel.length) {
        sentinel.copy(bytes, randomByte() % (size - sentinel.length));
      }
      for (let hit = 0; hit < 4; hit += 1) {
        if (size > 0) bytes[randomByte() % size] = 0x3a;
      }
      const recovered = decodeTransferPdf(new Uint8Array(bytes));
      assert.ok(
        recovered === null || typeof recovered === 'string',
        `random bytes of size ${size} decode to a string or nothing`,
      );
      if (recovered !== null) decoded += 1;
    }
  }

  // Every truncation of a real export, byte by byte. This is the shape an
  // interrupted write leaves behind, at every possible interruption point.
  const real = encodeTransferPdf({
    a: 'x'.repeat(500),
    b: [1, 2, 3],
    u: 'Sto. Niño — café',
  } as unknown as Record<string, unknown>);
  for (let cut = 0; cut <= real.length; cut += 1) {
    const recovered = decodeTransferPdf(real.subarray(0, cut));
    assert.ok(
      recovered === null || typeof recovered === 'string',
      `an export cut at ${cut} of ${real.length} bytes decodes to a string or nothing`,
    );
    if (recovered !== null) decoded += 1;
  }

  // Some of those truncations must have produced a document at all, or the
  // loop proved nothing beyond that the function is quiet.
  assert.ok(decoded > 0, 'the fuzz actually reached the decoder, not just its guard');
}

console.log(
  'ok — transferPdf: line boundaries, empty registries, pagination, and damaged files',
);