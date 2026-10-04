import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import {
  duplicateBarangayError,
  validateBarangayEditorFields,
  validateTerminalEditorFields,
} from './terminalEditorState';
import { municipalityEditorValidate } from './municipalityEditorState';
import { barangayNameOf } from './barangayPickerState';
import { formatScaled, SCALE_KM } from './fareFormat';

/**
 * The pure half of the Configuration screens' Import / Export.
 *
 * The file is a JSON document on disk, written and read through
 * `expo-file-system` by `transferFile.ts` — this module decides WHAT that
 * document says and whether one may be trusted. No I/O, no React, no SQLite,
 * so every rule below is exercised by `npx tsx src/lib/transferState.test.ts`
 * against fixtures.
 *
 * TWO FILE KINDS, ONE ENVELOPE. Each screen owns a registry:
 *
 *   · `barangay-config` carries the MUNICIPALITY LIST and the registered-KM
 *     stops filed as `BARANGAY`. Both tabs travel together: a barangay whose
 *     municipality is missing is a row the scope filter cannot explain and
 *     the editor cannot fix.
 *   · `terminal-config` carries the stops filed as `TERMINAL`.
 *
 * A stop is exported as its PLACE half and its stored `km_marker`, never as
 * the composed `name` column, and it links to its municipality BY NAME: ids
 * are this device's autoincrement and mean nothing on another one, so a link
 * is only carried when the importing device already lists that name.
 *
 * THE VALIDATION IS THE EDITORS', NOT A SECOND COPY. An imported municipality
 * runs `municipalityEditorValidate`; an imported stop runs the very
 * `validateBarangayEditorFields` / `validateTerminalEditorFields` the on-screen
 * form runs on the same fields, at the same boundaries: name empty → name
 * comma → duplicate → KM. An import that accepted a row the form would refuse
 * would write a record the user cannot reproduce by hand — and the store's own
 * duplicate SELECT would reject it a moment later anyway.
 *
 * FAILURE IS A LIST, NEVER A THROW. The sheet shows what was refused and why,
 * and every accepted row is still imported: a file with one bad row out of two
 * hundred is a working backup, not a broken one.
 */

/** The envelope's shape version. A file from a newer app is refused whole. */
export const TRANSFER_FORMAT_VERSION = 1;

/** Which registry a file carries. Read from the file, never inferred. */
export type TransferKind = 'barangay-config' | 'terminal-config';

/** The stops' key in a written file — kind-specific, so the file reads true. */
function stopsKey(kind: TransferKind): 'barangays' | 'terminals' {
  return kind === 'barangay-config' ? 'barangays' : 'terminals';
}

/**
 * A file's stops under whichever key its kind used. Takes the loose shape
 * because the parse path holds an UNVALIDATED document — the readers below
 * re-check every field — while a written file satisfies it too.
 */
function stopsOf(file: Record<string, unknown>, kind: TransferKind): ExportedStop[] {
  return file[stopsKey(kind)] as ExportedStop[];
}

/** Human title for a file kind, for this module's own copy. */
function transferKindTitle(kind: TransferKind): string {
  return kind === 'barangay-config' ? 'Barangay configuration' : 'Terminal configuration';
}

/** The stops' plural noun, for the counts line. */
function transferStopsNoun(kind: TransferKind): 'barangays' | 'terminals' {
  return kind === 'barangay-config' ? 'barangays' : 'terminals';
}

// ── Export ─────────────────────────────────────────────────────────────────

/** What one municipality contributes: the two fields it has, plus its flag. */
export type ExportedMunicipality = {
  name: string;
  province: string;
  is_active: 0 | 1;
};

/**
 * What one stop contributes: its PLACE half and its registered KM, never the
 * composed `name` column. The tail after the comma is composition, rebuilt on
 * import from the municipality the file names.
 */
export type ExportedStop = {
  name: string;
  /** The linked municipality's name, or null when the row is unlinked. */
  municipality: string | null;
  /** Integer thousandths of a km — the stored unit, never rounded text. */
  km_marker: number;
  is_active: 0 | 1;
};

/** The document as written. `exportedAt` is epoch millis. */
export type TransferFile = {
  format: 'kondukt-transfer';
  version: number;
  kind: TransferKind;
  exportedAt: number;
  municipalities: ExportedMunicipality[];
  /** Keyed `barangays` or `terminals`; both are stops, read through `stopsKey`. */
  [key: string]: unknown;
};

/**
 * The Barangay Configuration screen's file: every municipality and every stop
 * filed as `BARANGAY`, inactive rows included. A deactivated stop still exists
 * and still shows in history, so omitting it from a backup would lose it on
 * restore.
 */
export function buildBarangayFile(
  municipalities: MunicipalityRowRecord[],
  barangays: TerminalRowRecord[],
  now: number,
): TransferFile {
  const file: TransferFile = {
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION,
    kind: 'barangay-config',
    exportedAt: now,
    municipalities: municipalities.map(toExportedMunicipality),
  };
  file.barangays = barangays.map((row) =>
    toExportedStop(row, municipalityNameById(municipalities)),
  );
  return file;
}

/**
 * The Terminal Configuration screen's file.
 *
 * Municipalities travel as REFERENCES: the file records the name so an import
 * can re-link a stop to a municipality this device already lists, but it never
 * CREATES one. The Municipality Editor owns that registry, and a terminal file
 * that silently minted towns would write rows no screen on this device asked
 * for.
 *
 * The argument order matches `buildBarangayFile` — municipalities, then the
 * registry's stops — so one `TransferRegistry.build` signature serves both.
 * The original order was terminals-first, which made the two builders
 * interchangeable only by accident.
 */
export function buildTerminalFile(
  municipalities: MunicipalityRowRecord[],
  terminals: TerminalRowRecord[],
  now: number,
): TransferFile {
  const file: TransferFile = {
    format: 'kondukt-transfer',
    version: TRANSFER_FORMAT_VERSION,
    kind: 'terminal-config',
    exportedAt: now,
    municipalities: municipalities.map(toExportedMunicipality),
  };
  file.terminals = terminals.map((row) =>
    toExportedStop(row, municipalityNameById(municipalities)),
  );
  return file;
}

function municipalityNameById(municipalities: MunicipalityRowRecord[]): Map<number, string> {
  return new Map(municipalities.map((row) => [row.id, row.name]));
}

function toExportedMunicipality(row: MunicipalityRowRecord): ExportedMunicipality {
  return {
    name: row.name,
    province: typeof row.province === 'string' ? row.province : '',
    is_active: row.is_active === 1 ? 1 : 0,
  };
}

function toExportedStop(
  row: TerminalRowRecord,
  nameById: Map<number, string>,
): ExportedStop {
  return {
    // The PLACE half only. A row with no comma is its own place; a terminal
    // with no municipality exports the bare name it is stored under.
    name: barangayNameOf(row.name),
    municipality:
      row.municipality_id === null ? null : (nameById.get(row.municipality_id) ?? null),
    km_marker: row.km_marker,
    is_active: row.is_active === 1 ? 1 : 0,
  };
}

/** How many rows a written file holds, for the sheet's confirmation line. */
export function transferFileCounts(file: TransferFile): {
  municipalities: number;
  stops: number;
} {
  return {
    municipalities: file.municipalities.length,
    stops: stopsOf(file, file.kind).length,
  };
}

// ── Import ─────────────────────────────────────────────────────────────────

/** One refusal, addressed at the sheet: which row, and what is wrong. */
export type TransferIssue = {
  /** 1-based position in the file's stop list; 0 for a municipality or file. */
  index: number;
  /** The row's name as the file spelled it, for a readable sentence. */
  label: string;
  message: string;
};

/** A municipality the validators accepted, ready for the store. */
export type AcceptedMunicipality = {
  name: string;
  province: string;
  is_active: 0 | 1;
};

/**
 * A stop the validators accepted, ready for the store.
 *
 * `municipalityName` is deliberately a NAME and not an id: the caller resolves
 * it against the rows this device holds, and a file can never dictate which
 * autoincrement value a row gets.
 */
export type AcceptedStop = {
  /** The place half, trimmed. */
  name: string;
  km_marker: number;
  is_active: 0 | 1;
  municipalityName: string | null;
};

/** Everything one import produced: the accepted rows and everything refused. */
export type ParsedTransfer = {
  /** Non-null when the file itself cannot be read at all. */
  fatal: string | null;
  municipalities: AcceptedMunicipality[];
  stops: AcceptedStop[];
  issues: TransferIssue[];
};

/** The whole file is unusable, so there is nothing to import at all. */
function fatalTransfer(message: string): ParsedTransfer {
  return { fatal: message, municipalities: [], stops: [], issues: [] };
}

/**
 * Reads and validates a file against one registry.
 *
 * `existingTerminals` must already be filtered to THIS registry's rows by the
 * caller — a barangay file must not see a terminal as a duplicate, or vice
 * versa, or the two screens start refusing each other's rows.
 */
export function parseTransferFile(input: {
  text: string;
  kind: TransferKind;
  existingMunicipalities: MunicipalityRowRecord[];
  existingTerminals: TerminalRowRecord[];
}): ParsedTransfer {
  const { text, kind, existingMunicipalities, existingTerminals } = input;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fatalTransfer('That file is not readable Kondukt data.');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fatalTransfer('That file is not readable Kondukt data.');
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== 'kondukt-transfer') {
    return fatalTransfer('That file was not exported from Kondukt.');
  }
  if (typeof file.version !== 'number') {
    return fatalTransfer('That file does not say which version it was written by.');
  }
  if (file.version > TRANSFER_FORMAT_VERSION) {
    return fatalTransfer(
      `That file was written by a newer version of Kondukt (v${file.version}).`,
    );
  }
  // The kind is checked, never inferred: reading a terminal file as a barangay
  // file would file its stops under the wrong registry, and the two screens
  // would quietly start listing each other's rows again.
  if (file.kind !== kind) {
    return fatalTransfer(
      `That file holds ${transferKindTitle(file.kind as TransferKind).toLowerCase()} data, ` +
        `and this screen manages ${transferKindTitle(kind).toLowerCase()} data.`,
    );
  }

  const issues: TransferIssue[] = [];
  const municipalities = readMunicipalities(
    file.municipalities,
    existingMunicipalities,
    issues,
  );
  const stops =
    kind === 'barangay-config'
      ? readBarangays(
          stopsOf(file, kind),
          municipalities,
          existingMunicipalities,
          existingTerminals,
          issues,
        )
      : readTerminals(stopsOf(file, kind), existingTerminals, issues);

  return { fatal: null, municipalities, stops, issues };
}

/**
 * The municipalities, one at a time, through the Municipality Editor's own
 * validator and then its own duplicate rule — the pair (name + province), both
 * lower-cased, because the same town in two provinces is two real rows.
 */
function readMunicipalities(
  value: unknown,
  existing: MunicipalityRowRecord[],
  issues: TransferIssue[],
): AcceptedMunicipality[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ index: 0, label: 'Municipalities', message: 'The municipality list is not a list.' });
    return [];
  }
  const accepted: AcceptedMunicipality[] = [];
  value.forEach((row, position) => {
    const at = position + 1;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      issues.push({ index: 0, label: `Municipality ${at}`, message: 'That row is not a record.' });
      return;
    }
    const candidate = row as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const province = typeof candidate.province === 'string' ? candidate.province : '';
    const refusal = municipalityEditorValidate({ name, province });
    if (refusal !== null) {
      issues.push({
        index: 0,
        label: name.trim() === '' ? `Municipality ${at}` : name.trim(),
        message: refusal.message,
      });
      return;
    }
    const nameTrimmed = name.trim();
    const provinceTrimmed = province.trim();
    const seen = (row2: { name: string; province: string }) =>
      row2.name.toLowerCase() === nameTrimmed.toLowerCase() &&
      row2.province.toLowerCase() === provinceTrimmed.toLowerCase();
    if (existing.some(seen) || accepted.some(seen)) {
      issues.push({
        index: 0,
        label: nameTrimmed,
        message: `${nameTrimmed} is already listed in ${provinceTrimmed}.`,
      });
      return;
    }
    accepted.push({
      name: nameTrimmed,
      province: provinceTrimmed,
      // An absent flag is an ACTIVE row: the column's own default, and the
      // only value a create can write. Only an explicit 0 deactivates.
      is_active: candidate.is_active === 0 ? 0 : 1,
    });
  });
  return accepted;
}

/**
 * The stops of a barangay file, through the Barangay Editor's own validator:
 * place name, municipality link, registered KM, plus the duplicate rule that
 * is scoped to ONE municipality.
 *
 * The validator wants ids, and the file names municipalities — so the accepted
 * municipalities are handed over as placeholder rows whose ids are positions.
 * Nothing here ever writes one back: the id that reaches the store is the one
 * the store assigns, found from the name the caller resolves.
 */
function readBarangays(
  value: unknown,
  municipalities: AcceptedMunicipality[],
  existingMunicipalities: MunicipalityRowRecord[],
  existingTerminals: TerminalRowRecord[],
  issues: TransferIssue[],
): AcceptedStop[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ index: 0, label: 'Barangays', message: 'The barangay list is not a list.' });
    return [];
  }
  /**
   * The link collection the validator reads, and it is BOTH sources: the rows
   * this file contributes AND the ones this device already holds.
   *
   * The second half is not optional. A restore into a device that already
   * lists Olongapo City has every municipality in the file refused as a
   * duplicate, so a collection built from the file alone would leave every
   * stop's link unresolvable and refuse the whole registry with "Choose the
   * municipality this barangay belongs to" — a stop whose municipality IS on
   * this device, refused for it.
   */
  const known: MunicipalityRowRecord[] = [
    ...existingMunicipalities,
    ...municipalities.map((m, index) => ({
      id: -(index + 1),
      name: m.name,
      province: m.province,
      is_active: m.is_active,
    })),
  ];
  const existingNameById = municipalityNameById(existingMunicipalities);
  const accepted: AcceptedStop[] = [];

  value.forEach((row, position) => {
    const at = position + 1;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      issues.push({ index: 0, label: `Row ${at}`, message: 'That row is not a record.' });
      return;
    }
    const candidate = row as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const label = name.trim() === '' ? `Row ${at}` : name.trim();
    const municipalityName =
      typeof candidate.municipality === 'string' && candidate.municipality.trim() !== ''
        ? candidate.municipality.trim()
        : null;
    const municipalityId =
      municipalityName === null
        ? null
        : (known.find((row2) => row2.name.toLowerCase() === municipalityName.toLowerCase())
            ?.id ?? null);
    const result = validateBarangayEditorFields(
      { name, municipalityId, km: kmTextOf(candidate.km_marker) },
      {
        municipalities: known,
        // `terminals: []` is deliberate. This validator's own duplicate check
        // compares `municipality_id`, and the ids in `known` are placeholders
        // (negative for the file's rows) that mean nothing to this device's
        // real ids — passing the device's rows here would match them against
        // the wrong ids and refuse legal rows. The duplicate is checked below
        // instead, by NAME, which is what actually crosses devices.
        terminals: [],
        editingId: null,
        requireActiveMunicipality: false,
      },
    );
    if (result.nameError !== null || result.muniError !== null || result.kmError !== null) {
      issues.push({
        index: at,
        label,
        message: result.nameError ?? result.muniError ?? (result.kmError as string),
      });
      return;
    }
    // The device's own duplicate, judged by NAME because an id from this file
    // would mean nothing here.
    const duplicateInDevice = existingTerminals.some(
      (row2) =>
        (row2.municipality_id === null ? '' : existingNameById.get(row2.municipality_id) ?? '') ===
          municipalityName &&
        barangayNameOf(row2.name).toLowerCase() === label.toLowerCase(),
    );
    const duplicateInFile = accepted.some(
      (row2) =>
        (row2.municipalityName ?? '') === municipalityName &&
        row2.name.toLowerCase() === label.toLowerCase(),
    );
    if (duplicateInDevice || duplicateInFile) {
      issues.push({
        index: at,
        label,
        message:
          municipalityName === null
            ? `${label} is already registered.`
            : duplicateBarangayError(label, municipalityName),
      });
      return;
    }
    accepted.push({
      name: label,
      km_marker: result.kmStored as number,
      is_active: candidate.is_active === 0 ? 0 : 1,
      municipalityName,
    });
  });
  return accepted;
}

/**
 * The stops of a terminal file, through the Terminal Editor's own validator:
 * the place name and the registered KM, where a comma is legal in the name
 * because the composed column carries one.
 *
 * The duplicate is the composed name, lower-cased, whole — the same
 * `lower(name)` the store's own SELECT compares, so a restore into a
 * populated registry adds only what is genuinely new.
 */
function readTerminals(
  value: unknown,
  existingTerminals: TerminalRowRecord[],
  issues: TransferIssue[],
): AcceptedStop[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ index: 0, label: 'Terminals', message: 'The terminal list is not a list.' });
    return [];
  }
  const accepted: AcceptedStop[] = [];
  value.forEach((row, position) => {
    const at = position + 1;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      issues.push({ index: 0, label: `Row ${at}`, message: 'That row is not a record.' });
      return;
    }
    const candidate = row as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const label = name.trim() === '' ? `Row ${at}` : name.trim();
    const result = validateTerminalEditorFields({
      name,
      km: kmTextOf(candidate.km_marker),
    });
    if (result.nameError !== null || result.kmError !== null) {
      issues.push({ index: at, label, message: result.nameError ?? (result.kmError as string) });
      return;
    }
    const composed = label.toLowerCase();
    if (
      accepted.some((row2) => row2.name.toLowerCase() === composed) ||
      existingTerminals.some((row2) => row2.name.toLowerCase() === composed)
    ) {
      issues.push({ index: at, label, message: `${label} is already registered.` });
      return;
    }
    accepted.push({
      name: label,
      km_marker: result.kmStored as number,
      is_active: candidate.is_active === 0 ? 0 : 1,
      municipalityName:
        typeof candidate.municipality === 'string' && candidate.municipality.trim() !== ''
          ? candidate.municipality.trim()
          : null,
    });
  });
  return accepted;
}

/**
 * A file's marker, read as the text a driver would have typed.
 *
 * `formatScaled` for a stored integer — the same conversion the editor's field
 * loads through, so `232400` is judged as `232.4` by the same validator, and a
 * string marker is judged as itself. Anything else becomes empty text, which
 * every validator refuses with its own KM error rather than a crash.
 */
function kmTextOf(kmMarker: unknown): string {
  if (typeof kmMarker === 'number' && Number.isFinite(kmMarker)) {
    return formatScaled(kmMarker, SCALE_KM);
  }
  return typeof kmMarker === 'string' ? kmMarker : '';
}

// ── Copy ───────────────────────────────────────────────────────────────────

/** "3 municipalities and 20 barangays" / "1 terminal" — never "1 terminals". */
export function transferCountLine(
  municipalities: number,
  stops: number,
  kind: TransferKind,
): string {
  const noun = transferStopsNoun(kind);
  const singular = noun === 'barangays' ? 'barangay' : 'terminal';
  const parts: string[] = [];
  if (municipalities > 0) {
    parts.push(`${municipalities} ${municipalities === 1 ? 'municipality' : 'municipalities'}`);
  }
  parts.push(`${stops} ${stops === 1 ? singular : noun}`);
  return parts.join(' and ');
}

/** The refusals, one per line, for the sheet's own error card. */
export function transferIssueLines(issues: TransferIssue[]): string[] {
  return issues.map((issue) =>
    issue.index === 0
      ? `${issue.label}: ${issue.message}`
      : `Row ${issue.index} — ${issue.label}: ${issue.message}`,
  );
}
