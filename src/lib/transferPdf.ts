/**
 * The PDF container the Configuration screens' Import / Export now writes and
 * reads.
 *
 * WHY A HAND-ROLLED WRITER: this ships as a JS-only update against
 * `runtimeVersion 1.0.2`, and every off-the-shelf PDF library in this app's
 * weight class either needs a new native module or drags in a bundler target
 * this app does not configure. A PDF is a documented text format, so the
 * handful of objects this file needs — a catalog, a page tree, two base-14
 * fonts and one content stream per page — are written directly here. `Courier`
 * is a base-14 font, so nothing is embedded and nothing is subsetted; the file
 * stays small, opens in any viewer, and adds no native module.
 *
 * HOW THE DATA SURVIVES: the document `transferState.ts` builds is
 * `JSON.stringify`-ed, encoded UTF-8, and base64-encoded, and those base64
 * characters are drawn on the page as ordinary Courier text between the two
 * sentinel lines `%%KONDUKT-DATA-BEGIN` and `%%KONDUKT-DATA-END`. The import
 * scans the raw file BYTES for those sentinels, decodes what lies between them
 * and hands the JSON to the parser that already existed. The export is
 * therefore a real, readable, printable PDF whose round trip is the same JSON
 * the app already proved — the validators in `transferState.ts` are untouched.
 *
 * WHY BASE64 AND NOT THE RAW JSON: a PDF string is a byte string with its own
 * escaping, and the one font encoding every viewer honours (WinAnsi) cannot
 * represent code points above U+00FF. Writing the JSON straight into the
 * stream would mean either corrupting a name that holds a character outside
 * Latin-1 or silently replacing it — and on restore a replaced character
 * creates a second record instead of the one the user backed up. Base64 is pure
 * ASCII: no escaping needed and unaffected by any font.
 *
 * WHAT THE PAGE SAYS: only the block. There is no title, no timestamp, no
 * counts and no listing of places — the request was a container that carries
 * the data, and prose on the page is content nobody asked for, is content that
 * no longer matches the document the moment a row changes, and on a device with
 * hundreds of barangays costs pages. The file is still a genuine, openable,
 * printable PDF; it simply has nothing to say beyond what it holds.
 *
 * WHY EACH PAYLOAD LINE CARRIES A `:` MARKER: the decoder scans the raw file
 * bytes, and a content stream is not just the text it draws — between two drawn
 * lines sit the operators `Tj ET`, and every letter of that is a base64
 * alphabet character. Reading "everything between the sentinels that is not
 * punctuation" therefore decodes the operators as payload and produces
 * nonsense, silently. So each payload line is drawn as a marker followed by
 * base64, and only the alphabet run IMMEDIATELY after a marker is read. The
 * operators between lines then stop the run by themselves, and the decoding
 * cannot pick them up.
 *
 * WHY UTF-8 AND BASE64 ARE HAND-ROLLED: both are a dozen lines, both are
 * exercised by `transferFile.test.ts` against the tilde in "Sto. Niño", and
 * writing them means this module depends on no global that Hermes, the Node
 * test harness and the browser preview happen to provide.
 *
 * No I/O, no React, no native module — byte work only, so it is unit tested
 * under plain `tsx`.
 */

/** Opens the machine-readable block. Found in the raw bytes, never re-flowed. */
const PAYLOAD_BEGIN = '%%KONDUKT-DATA-BEGIN';

/**
 * Closes it, for a reader. The decoder does not REQUIRE it: a file cut short
 * mid-write still has an opening sentinel and a partly drawn block, and
 * reporting that as "not a Kondukt export" would be a lie. Recovering the
 * partial document and letting the JSON parser refuse it produces the truer
 * sentence, which is why the scan runs to the end of the file either way.
 */
const PAYLOAD_END = '%%KONDUKT-DATA-END';

/**
 * Opens each drawn payload line.
 *
 * A colon: not a base64 character, and not one the content stream puts
 * anywhere on its own — every operator between two drawn lines is letters,
 * digits, slashes and brackets. That is what lets the decoder tell payload from
 * syntax with certainty rather than with a hope.
 */
const PAYLOAD_MARKER = ':';

/**
 * Base64 characters drawn per line.
 *
 * Courier is 0.6em wide, so 96 of them at 8pt is 460.8pt against a 487pt text
 * column (A4 less two 54pt margins). The count only has to satisfy that: the
 * import discards every byte between the sentinels that is not in the base64
 * alphabet, so a viewer may re-wrap the page without breaking the payload.
 */
const PAYLOAD_CHARS_PER_LINE = 96;

/** A4, in PostScript points. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Text column: 54pt margins. */
const MARGIN = 54;
const TOP_Y = 780;
const BOTTOM_Y = 64;

/** Extra space a line leaves under itself, so the 8pt payload stays legible. */
const LINE_GAP = 4;

/** One drawn line, before it becomes positioned `Tj` operators. */
type PdfLine = {
  text: string;
  /** 1 is Courier, 2 is Courier-Bold — the two fonts the page resources name. */
  font: 1 | 2;
  size: number;
  /** Extra space above this line, for the gaps between sections. */
  gapBefore: number;
};

const FONT_REGULAR =
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
const FONT_BOLD =
  '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';

/**
 * Builds the export's PDF: a readable header, then the payload block,
 * paginated as many pages as the base64 needs.
 *
 * Takes the document loose on purpose (`Record<string, unknown>`), the way the
 * parse path does: the header is presentation derived from whatever the caller
 * built, and a field it cannot read is described as unknown rather than thrown
 * on the way out of a backup the user asked for.
 */
export function encodeTransferPdf(file: Record<string, unknown>): Uint8Array {
  const payload = base64(utf8Bytes(JSON.stringify(file)));
  const block: PdfLine[] = [{ text: PAYLOAD_BEGIN, font: 2, size: 8, gapBefore: 0 }];
  for (let start = 0; start < payload.length; start += PAYLOAD_CHARS_PER_LINE) {
    block.push({
      text: PAYLOAD_MARKER + payload.slice(start, start + PAYLOAD_CHARS_PER_LINE),
      font: 1,
      size: 8,
      gapBefore: 0,
    });
  }
  block.push({ text: PAYLOAD_END, font: 2, size: 8, gapBefore: 0 });

  return assemblePdf(splitPages(block));
}

/**
 * Recovers the embedded Kondukt document from a picked file's raw bytes.
 *
 * Returns `null` for anything that is not one of our exports — a photo, a PDF
 * from another app, our own file with its payload stripped — so the caller can
 * say "that PDF is not a Kondukt export" instead of handing the JSON parser
 * something that was never JSON.
 *
 * The scan is over BYTES, never over a re-flowed content stream: a viewer may
 * wrap, re-indent or re-encode the lines it draws, and the payload must not
 * depend on that. Everything between the sentinels that is not a base64
 * character is dropped, so line breaks and the `\r\n` a viewer writes back are
 * handled by construction rather than by luck.
 */
export function decodeTransferPdf(bytes: Uint8Array): string | null {
  // This reads a file the user picked off their own device, so it is untrusted
  // input and the contract is TOTAL: no byte sequence may throw out of here. A
  // crash on a corrupt backup would answer "import failed" with a red screen.
  // `utf8Text` below is total by construction, and the scan below cannot throw
  // either — but the catch is the thing that ENFORCES the contract rather than
  // merely documenting it, so it stays: an unreadable file is one sentence, and
  // it must never cost the screen it was opened from.
  try {
    return recoverDocument(bytes);
  } catch {
    return null;
  }
}

function recoverDocument(bytes: Uint8Array): string | null {
  const beginAt = indexOfBytes(bytes, asciiBytes(PAYLOAD_BEGIN), 0);
  if (beginAt < 0) return null;

  const decoded: number[] = [];
  let at = beginAt + PAYLOAD_BEGIN.length;
  for (;;) {
    const markerAt = bytes.indexOf(PAYLOAD_MARKER_CODE, at);
    if (markerAt < 0) break;
    // Only the alphabet run that DIRECTLY follows a marker. Anything else the
    // stream carries — the closing paren, `Tj ET`, the next line's opening
    // paren — ends the run before a single operator letter can be mistaken for
    // data.
    let read = markerAt + 1;
    while (read < bytes.length && BASE64_VALUES[bytes[read]] >= 0) {
      decoded.push(bytes[read]);
      read += 1;
    }
    at = read;
  }
  const document = unbase64(decoded);
  if (document.length === 0) return null;
  return utf8Text(document);
}

// ── what is drawn ──────────────────────────────────────────────────────────

/*
 * The page is the block and nothing else, which is what keeps this module's one
 * remaining promise cheap: it says nothing about what the data is CALLED. The
 * words "barangay", "municipality" and "terminal" live in `transferRegistry.ts`,
 * which owns them for the sheet and the screen alike. An earlier version printed
 * a counts line and re-declared the nouns here to do it, which meant a rename in
 * the registry would have left the file describing the data in words the app no
 * longer used. With no prose on the page there is no second copy of that policy
 * to drift, and nothing to keep in step.
 */

// ── pagination ──────────────────────────────────────────────────────────────

/**
 * Breaks the line list into pages at the bottom margin.
 *
 * Leading is each line's own size plus its gap, so the 8pt payload block and
 * the 16pt title share one pass without a hard-coded lines-per-page that would
 * be wrong the moment either size changed.
 */
function splitPages(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let y = TOP_Y;
  for (const line of lines) {
    const baseline = y - line.gapBefore - line.size;
    if (current.length > 0 && baseline < BOTTOM_Y) {
      pages.push(current);
      current = [line];
      y = TOP_Y - line.gapBefore - line.size;
      continue;
    }
    current.push(line);
    y = baseline - LINE_GAP;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

// ── the PDF itself ──────────────────────────────────────────────────────────

/**
 * Collects byte chunks while tracking their total length.
 *
 * Two things force this instead of one flat array. The xref table needs the
 * offset of every object in BYTES, and the page streams carry WinAnsi bytes
 * above 127 (the tilde in "Sto. Niño") where a JS string's length and its byte
 * length part company. A wrong xref offset is the one defect that makes a PDF
 * unreadable in strict readers and repairable-but-suspicious in lenient ones, so
 * it is counted, never guessed.
 *
 * Note what does NOT force it: nothing here is spread into a call. Pagination
 * bounds every page stream to a few kilobytes, so an earlier worry about
 * `push(...bytes)` outgrowing the argument limit was measured and found not to
 * apply — `transferPdf.test.ts` pins the bound rather than the worry.
 */
function byteWriter() {
  const chunks: (number[] | Uint8Array)[] = [];
  let size = 0;
  return {
    push(chunk: number[] | Uint8Array): void {
      chunks.push(chunk);
      size += chunk.length;
    },
    get length(): number {
      return size;
    },
    toBytes(): Uint8Array {
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      return bytes;
    },
  };
}

/**
 * One page's content stream: a `BT`/`ET` per line, each carrying its own text
 * matrix, so a line's position never depends on the line before it.
 */
function contentStream(lines: PdfLine[]): Uint8Array {
  const write = byteWriter();
  let y = TOP_Y;
  for (const line of lines) {
    y -= line.gapBefore;
    write.push(asciiBytes(`BT /F${line.font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y} Tm `));
    write.push(literalString(winAnsiBytes(line.text)));
    write.push(asciiBytes(' Tj ET\n'));
    y -= line.size + LINE_GAP;
  }
  return write.toBytes();
}

/**
 * Assembles the file: header, indirect objects, an xref table, the trailer.
 *
 * Object numbers are fixed: 1 catalog, 2 page tree, 3 Courier, 4 Courier-Bold,
 * then a page and its stream per page from 5 upwards, and the producer info
 * last.
 */
function assemblePdf(pages: PdfLine[][]): Uint8Array {
  const streams = pages.map((lines) => contentStream(lines));
  const pageCount = pages.length;
  const infoObject = 5 + pageCount * 2;
  // The highest object number in the file. The loops below walk to THIS, not
  // to the array's length: the array is sparse and one longer, and an xref
  // entry pointing at an object that does not exist is the defect that makes
  // a strict reader refuse the whole file.
  const lastObject = infoObject;
  const kids: string[] = [];
  for (let index = 0; index < pageCount; index += 1) kids.push(`${5 + index * 2} 0 R`);

  const objects: (number[] | Uint8Array)[] = new Array(lastObject + 1);
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`);
  objects[3] = asciiBytes(FONT_REGULAR);
  objects[4] = asciiBytes(FONT_BOLD);
  streams.forEach((stream, index) => {
    objects[5 + index * 2] = asciiBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
    );
    const streamObject = byteWriter();
    streamObject.push(asciiBytes(`<< /Length ${stream.length} >>\nstream\n`));
    streamObject.push(Array.from(stream));
    streamObject.push(asciiBytes('endstream'));
    objects[6 + index * 2] = streamObject.toBytes();
  });
  objects[infoObject] = asciiBytes('<< /Producer (Kondukt) /Creator (Kondukt) >>');

  const write = byteWriter();
  write.push(asciiBytes('%PDF-1.4\n'));
  // A binary comment marks the file as binary for tools that sniff it, which
  // stops them from "helpfully" re-encoding the streams as text.
  write.push([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const offsets: number[] = [];
  for (let id = 1; id <= lastObject; id += 1) {
    offsets[id] = write.length;
    write.push(asciiBytes(`${id} 0 obj\n`));
    write.push(objects[id]);
    write.push(asciiBytes('\nendobj\n'));
  }

  const startXref = write.length;
  write.push(asciiBytes(`xref\n0 ${lastObject + 1}\n`));
  // Entry zero heads the free list by definition and is always present.
  write.push(asciiBytes('0000000000 65535 f\r\n'));
  for (let id = 1; id <= lastObject; id += 1) {
    // Exactly 20 bytes per entry: 10 + 5 + the two-character flags + CRLF.
    write.push(asciiBytes(`${String(offsets[id]).padStart(10, '0')} 00000 n\r\n`));
  }
  write.push(
    asciiBytes(
      `trailer\n<< /Size ${lastObject + 1} /Root 1 0 R /Info ${infoObject} 0 R >>\n` +
        `startxref\n${startXref}\n%%EOF\n`,
    ),
  );
  return write.toBytes();
}

// ── PDF string and byte primitives ──────────────────────────────────────────

/** Wraps bytes as a PDF literal string, escaping only what a literal needs. */
function literalString(bytes: number[]): number[] {
  const out: number[] = [0x28]; // '('
  for (const byte of bytes) {
    // `\`, `(` and `)` end or nest the string; anything unprintable is octal.
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out.push(0x5c, byte);
    } else if (byte < 32 || byte > 126) {
      out.push(...asciiBytes(`\\${byte.toString(8).padStart(3, '0')}`));
    } else {
      out.push(byte);
    }
  }
  out.push(0x29); // ')'
  return out;
}

/** The first index of `needle` in `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: number[], from: number): number {
  // The needle is always the non-empty opening sentinel, so there is no empty
  // case to answer. A hit near the end compares past the haystack and reads
  // `undefined`, which fails to equal the byte it wanted — a short tail is
  // therefore a miss, not a read off the end.
  let start = Math.max(0, from);
  for (;;) {
    // `indexOf` is native; only the bytes after a hit are compared by hand.
    const at = haystack.indexOf(needle[0], start);
    if (at < 0) return -1;
    let matched = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[at + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return at;
    start = at + 1;
  }
}

// ── encoding, written out rather than assumed ────────────────────────────────

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The marker's own byte, for the raw scan. */
const PAYLOAD_MARKER_CODE = PAYLOAD_MARKER.charCodeAt(0);

/** What a malformed sequence becomes: U+FFFD, never an exception. */
const REPLACEMENT = String.fromCharCode(0xfffd);

/** Byte to base64 value, or -1 for a byte that is not in the alphabet. */
const BASE64_VALUES = (() => {
  const table = new Int8Array(256).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/** A string that is ASCII by construction — the PDF's own syntax, never data. */
function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) out.push(text.charCodeAt(index));
  return out;
}

/**
 * The page's own text, as WinAnsi bytes.
 *
 * A code point WinAnsi cannot represent is drawn as `?`. That is safe because
 * these lines are never read back — the payload goes through base64 precisely
 * so it cannot be lossy — and a visible `?` is honest about a viewer that would
 * not have drawn the glyph anyway.
 */
function winAnsiBytes(text: string): number[] {
  const out: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    out.push(codePoint <= 0xff ? codePoint : 0x3f);
  }
  return out;
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) index += 1; // a surrogate pair is one code point
    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      out.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return out;
}

/**
 * UTF-8 bytes back to a string, tolerantly.
 *
 * Tolerantly is the requirement, not a nicety: a payload cut short — exactly
 * what a write interrupted mid-export looks like — ends in a half-formed
 * multi-byte sequence, and `String.fromCodePoint` THROWS on a code point past
 * U+10FFFF. A corrupt file must be refused in a sentence by the parser below,
 * never by a crash. Anything malformed becomes U+FFFD, which the JSON parse
 * then rejects exactly as it should.
 */
function utf8Text(bytes: ArrayLike<number>): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let codePoint: number;
    let width: number;
    if (first < 0x80) {
      codePoint = first;
      width = 1;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      width = 2;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      width = 3;
    } else {
      codePoint = first & 0x07;
      width = 4;
    }
    if (index + width > bytes.length) {
      out += REPLACEMENT;
      break;
    }
    for (let offset = 1; offset < width; offset += 1) {
      codePoint = (codePoint << 6) | (bytes[index + offset] & 0x3f);
    }
    index += width;
    out += codePoint > 0x10ffff ? REPLACEMENT : String.fromCodePoint(codePoint);
  }
  return out;
}

function base64(bytes: number[]): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += BASE64_ALPHABET[first >> 2];
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out +=
      second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
  }
  return out;
}

/**
 * Base64 back to bytes.
 *
 * Six bits at a time, least-significant group first, which is what makes this
 * different from `atob`: the alphabet run on the page is split across lines,
 * so it is read a character at a time here rather than in whole 4-character
 * groups, and a trailing partial group is dropped exactly as padding would.
 */
function unbase64(alphabet: number[]): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of alphabet) {
    const value = BASE64_VALUES[byte];
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}