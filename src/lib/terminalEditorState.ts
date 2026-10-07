import type { MunicipalityRowRecord, TerminalRowRecord } from '../data/schema';
import { formatScaled, parseScaled, SCALE_KM } from './fareFormat';
import { barangayNameOf } from './barangayPickerState';

/**
 * The Terminal Editor screen's pure logic.
 *
 * The screen owns rendering; this module owns the decisions a careless port
 * gets wrong. First, record construction: an edit carries through every
 * column the user cannot see — this store's `is_active` and the row's `id` —
 * so a save can never reset a deactivated terminal to active. Second, the
 * validation contract: every check runs on every attempt and all failures
 * show together — the prototype's first-error-only `validate()` is the one
 * contract this port deliberately drops, stated here as the decision: a
 * form that highlights one error per tap costs a tap per error.
 * Third, the one-way rule: the KM and name text a user typed is theirs until
 * a fresh load — nothing reformats it after a save.
 *
 * THE KM RULE IS THE FILE'S, NOT parseScaled's. `parseTerminalKm` is
 * add-terminal.html's `parseKm` ported: 1–3 integer digits, at most 2
 * decimals, thousands separators stripped, positive only — which caps a
 * marker at 999.9 KM and refuses the raw stored value (`231000`), the exact
 * mistake this field invites. The Barangay Editor keeps `parseScaled`'s
 * looser rule (its own prototype accepts `12.345`); the two editors ship two
 * rules and neither screen ships two phrasings.
 *
 * The composed name is built at the form boundary and never here for the
 * write. The two routes compose differently, and both composers live here:
 * the barangay route joins the place to its municipality row
 * (`barangayEditorComposeName`); the terminal route no longer asks for a
 * municipality, so it stores the bare place on create and carries a stored
 * name's tail through an edit (`composeTerminalName`) — the UPDATE replaces
 * the whole column, and dropping the tail would erase provenance the form
 * never showed. The DUPLICATE is not validated here at all: its
 * rule is a SELECT on `lower(name)` in `saveTerminal()`, and its rejection
 * arrives through the save channel verbatim — same discipline as
 * `saveMunicipality`.
 */

export type TerminalEditorMode = 'create' | 'edit';

/** The screen's whole visible state, strings only, per the spec's shape. */
export type TerminalEditorUiState = {
  mode: TerminalEditorMode;
  name: string;
  nameError: string | null;
  km: string;
  kmError: string | null;
  /** The one notice slot: a store rejection or a write failure, never a field error. */
  saveError: string | null;
  isLoading: boolean;
  isSaving: boolean;
};

export const TERMINAL_NAME_ERROR = 'Enter a terminal name.';
/** The comma refusal — the name IS the place/municipality split for every reader downstream. */
export const TERMINAL_COMMA_ERROR = 'Remove the comma from the terminal name.';
/** The file's sentence: it names the cap the rule enforces. */
export const TERMINAL_KM_ERROR = 'Enter the registered KM as a number, up to 999.9.';
/**
 * The Barangay Editor's KM sentence, kept for its looser rule — its own
 * prototype accepts `12.345` and `0`, so naming the terminal route's cap
 * here would describe a refusal this path never makes.
 */
export const BARANGAY_KM_ERROR = 'Enter a valid KM marker.';
export const TERMINAL_SAVE_ERROR = 'Unable to save terminal.';
/** The Barangay Editor's own. It used to show the terminal sentence above, so a
 *  user adding a barangay was told a TERMINAL had failed to save. */
export const BARANGAY_SAVE_ERROR = 'Unable to save barangay.';
export const TERMINAL_NOT_FOUND_ERROR = 'Terminal not found.';
export const BARANGAY_NOT_FOUND_ERROR = 'Barangay not found.';

/** Verbatim copy, from the mode alone — the two modes differ here only. */
export function terminalEditorTitle(mode: TerminalEditorMode): string {
  return mode === 'create' ? 'ADD TERMINAL' : 'EDIT TERMINAL';
}

/** The all-caps title normalized for the screen reader, per the a11y spec. */
export function terminalEditorAccessibilityTitle(
  mode: TerminalEditorMode,
): string {
  return mode === 'create' ? 'Add terminal' : 'Edit terminal';
}

/** The screen's initial state. Both fields EMPTY in create — never "0". */
export function initialTerminalEditorUiState(
  mode: TerminalEditorMode,
): TerminalEditorUiState {
  return {
    mode,
    name: '',
    nameError: null,
    km: '',
    kmError: null,
    saveError: null,
    isLoading: mode === 'edit',
    isSaving: false,
  };
}

/**
 * One load-time derivation: the stored integer becomes field text with
 * trailing zeros stripped (4500 → "4.5", 0 → "0") and the name field takes
 * the PLACE half of the composed string (first comma — written down beside
 * the other splitters). The municipality link is NOT read: it is the
 * Barangay Editor's field, and this route leaves the stored column exactly
 * as the store holds it. A `null` record means the id does not exist — only
 * meaningful for edit; create never loads a record.
 */
export function terminalEditorFieldsFromRecord(
  record: TerminalRowRecord | null,
): { name: string; km: string } | null {
  if (record === null) return null;
  const comma = record.name.indexOf(',');
  return {
    name: (comma === -1 ? record.name : record.name.slice(0, comma)).trim(),
    km: formatScaled(record.km_marker, SCALE_KM),
  };
}

/**
 * A keystroke in one field: value updates, that field's error and the
 * save-failure card clear — the stale-failure rule. The other field's error
 * is untouched; all errors showing together must survive a one-field fix.
 */
export function commitTerminalEditorField(
  state: TerminalEditorUiState,
  field: 'name' | 'km',
  value: string,
): TerminalEditorUiState {
  const next: TerminalEditorUiState = {
    ...state,
    name: field === 'name' ? value : state.name,
    km: field === 'km' ? value : state.km,
  };
  if (field === 'name') next.nameError = null;
  else next.kmError = null;
  // Any keystroke dismisses a stale save failure — fixing a typo also
  // dismisses it, per the existing editor's behavior.
  next.saveError = null;
  return next;
}

/**
 * add-terminal.html's `parseKm`, ported byte for byte: the text as the driver
 * typed it, thousands separators stripped, then the file's own rule —
 * 1–3 integer digits, at most 2 decimals, positive — and thousandths out.
 * `231000` is refused (six digits: the raw stored value, the mistake this
 * field most invites), `0` and negatives are refused, `1,2` reads as `12` →
 * `12000`, and `232.44` stores `232440` — the display rounds it away, the
 * store keeps what was typed.
 */
const KM_RE = /^\d{1,3}(?:\.\d{1,2})?$/;
export function parseTerminalKm(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!KM_RE.test(trimmed)) return null;
  const value = parseFloat(trimmed);
  if (!isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000);
}

/**
 * Validates both fields on a save attempt and converts the KM text.
 *
 * Every failure at once — never the first alone — and `kmStored: null` on
 * any failure, so a caller can never save with a half-converted value. The
 * overflow rule lives here: `parseScaled` succeeds for a huge digit string
 * that would still exceed the 2^53 integer range `Number` can hold exactly
 * (this store's integers are JS numbers), so the converted result is checked
 * back for exactness and any loss reads as the KM field error.
 */
/**
 * The Barangay Editor's KM conversion: `parseScaled` decides the text,
 * `Number.isSafeInteger` decides the stored integer, and the error is always
 * the KM field's own — never a crash, never a silent truncation. Its own
 * prototype accepts `12.345`; the terminal route uses the file's cap below.
 * `kmStored` is null on any failure, so a caller can never save a
 * half-converted value.
 */
function convertKmField(km: string): { kmError: string | null; kmStored: number | null } {
  const parsed = parseScaled(km, SCALE_KM);
  if (parsed === null) {
    // Empty and malformed ("1.2.3") both land here.
    return { kmError: BARANGAY_KM_ERROR, kmStored: null };
  }
  if (!Number.isSafeInteger(parsed)) {
    // Parses as a decimal but exceeds what a stored integer can hold
    // exactly: a field error, never a crash or a silently truncated value.
    return { kmError: BARANGAY_KM_ERROR, kmStored: null };
  }
  return { kmError: null, kmStored: parsed };
}

/**
 * Every failure at once, in the file's precedence within each field: name
 * empty → name comma; KM any refusal. There is no municipality check here —
 * the link is the Barangay Editor's field to choose, and a terminal created
 * by this route carries none of its own. The duplicate is NOT here — its
 * rule is the data layer's SELECT on the composed name, and its sentence
 * arrives through the save channel.
 */
export function validateTerminalEditorFields(state: Pick<TerminalEditorUiState, 'name' | 'km'>): {
  nameError: string | null;
  kmError: string | null;
  kmStored: number | null;
} {
  const trimmedName = state.name.trim();
  let nameError: string | null = null;
  if (trimmedName === '') nameError = TERMINAL_NAME_ERROR;
  else if (trimmedName.indexOf(',') !== -1) nameError = TERMINAL_COMMA_ERROR;

  const { kmError, kmStored } = (() => {
    const stored = parseTerminalKm(state.km);
    // Empty, malformed ("1.2.3"), zero, negative, raw thousandths, 4+ digits.
    return stored === null
      ? { kmError: TERMINAL_KM_ERROR, kmStored: null }
      : { kmError: null, kmStored: stored };
  })();
  return { nameError, kmError, kmStored };
}

export type TerminalWrite = {
  id: number | null;
  name: string;
  km_marker: number;
  is_active: 0 | 1;
  /**
   * Present only when the caller knows the link — the Barangay Editor, which
   * always passes it because a new stop is linked by construction. The
   * terminal route never passes it: the UPDATE branch therefore leaves the
   * stored column untouched, and a save from the two-field form can never
   * null a link it does not show.
   */
  municipality_id?: number | null;
};

/**
 * The record written on save, built from the loaded row where there is one.
 *
 * Edit carries through every stored column the screen cannot edit (id and
 * the active flag ride through, so an inactive terminal stays inactive).
 * Create asks the store for a fresh id with the active default. The
 * municipality link is written when the caller passes one — create always
 * does on the Barangay Editor, which exists to mint linked rows, while the
 * terminal route passes none. Timestamps are the store's business; the
 * screen writes none.
 */
export function buildTerminalWrite(
  loaded: TerminalRowRecord | null,
  name: string,
  kmStored: number,
  municipalityId?: number | null,
): TerminalWrite {
  const base: TerminalWrite =
    loaded === null
      ? { id: null, name, km_marker: kmStored, is_active: 1 }
      : {
          id: loaded.id,
          name,
          km_marker: kmStored,
          is_active: loaded.is_active === 1 ? 1 : 0,
        };
  if (municipalityId !== undefined) base.municipality_id = municipalityId;
  return base;
}

/**
 * What the terminal route writes into `terminals.name`. The route no longer
 * asks for a municipality, so create stores the bare place — and an edit
 * carries the stored tail byte-for-byte: the UPDATE replaces the whole
 * column, and rewriting `'Santa Cruz, Olongapo'` as `'Santa Cruz'` would
 * erase the provenance the unlinked readers display. The tail belongs to
 * the record's history, not to a control on this form.
 */
export function composeTerminalName(name: string, loaded: TerminalRowRecord | null): string {
  const trimmed = name.trim();
  if (loaded === null) return trimmed;
  const comma = loaded.name.indexOf(',');
  return comma === -1 ? trimmed : `${trimmed}${loaded.name.slice(comma)}`;
}

// ── Barangay Editor: create and edit over the same three fields ────────────
//
// The Barangay Editor is the registry's own route (`id` null = create), and
// it reuses every decision above rather than forking one: the same
// conversion (`convertKmField` → `parseScaled` + the safe-integer wall), the
// same all-errors-at-once contract, the same one-way record construction.
// What it adds are the three facts the two-field Terminal Editor has no
// fields for: the municipality link, the comma that IS the name/municipality
// split for every reader downstream, and the duplicate that refuses the same
// barangay twice in one municipality.

export const BARANGAY_NAME_ERROR = 'Enter the barangay name.';
/**
 * The comma refusal. `barangayNameOf` splits terminals.name on the FIRST
 * comma and `passengerState`'s municipalityOf on the LAST, so a second comma
 * in a barangay name renders two different records on two screens — refused
 * at the boundary instead of repaired downstream. The Terminal Editor's own
 * route still accepts a comma; closing that half is a separate change to a
 * tested screen, not this port.
 */
export const BARANGAY_COMMA_ERROR = 'Remove the comma from the barangay name.';
export const BARANGAY_MUNICIPALITY_REQUIRED_ERROR =
  'Choose the municipality this barangay belongs to.';
export const BARANGAY_MUNICIPALITY_GONE_ERROR =
  'That municipality is no longer available.';

/** The duplicate, named with both halves: what and where. */
export function duplicateBarangayError(name: string, municipalityName: string): string {
  return `${name} is already registered in ${municipalityName}.`;
}

export type BarangayEditorFields = {
  name: string;
  municipalityId: number | null;
  km: string;
};

export type BarangayEditorValidation = {
  nameError: string | null;
  muniError: string | null;
  kmError: string | null;
  kmStored: number | null;
};

export type BarangayEditorContext = {
  municipalities: MunicipalityRowRecord[];
  terminals: TerminalRowRecord[];
  /** The row being edited — excluded from its own duplicate check. */
  editingId?: number | null;
  /**
   * Create refuses a deactivated municipality (it could be deactivated
   * between render and save); edit may keep the one it loaded, or a driver
   * could never fix a row whose municipality was deactivated later.
   */
  requireActiveMunicipality: boolean;
  /** Edit keeps the no-municipality row it loaded — see the terminal context. */
  allowMissingMunicipality?: boolean;
};

/**
 * Every failure at once, exactly like the module's own validator — the
 * prototype's first-error-only `validate()` is the one contract this port
 * deliberately drops: a three-field form that highlights only the name on a
 * tap that also failed the KM costs one tap per error. Within the name field
 * the prototype's precedence holds: empty, then comma, then duplicate.
 */
export function validateBarangayEditorFields(
  fields: BarangayEditorFields,
  context: BarangayEditorContext,
): BarangayEditorValidation {
  const name = fields.name.trim();

  let nameError: string | null = null;
  if (name === '') nameError = BARANGAY_NAME_ERROR;
  else if (name.indexOf(',') !== -1) nameError = BARANGAY_COMMA_ERROR;

  const municipality =
    context.municipalities.find((row) => row.id === fields.municipalityId) ?? null;
  let muniError: string | null = null;
  if (fields.municipalityId === null) {
    if (!context.allowMissingMunicipality) muniError = BARANGAY_MUNICIPALITY_REQUIRED_ERROR;
  } else if (
    municipality === null ||
    (context.requireActiveMunicipality && municipality.is_active !== 1)
  ) {
    muniError = BARANGAY_MUNICIPALITY_GONE_ERROR;
  }

  const { kmError, kmStored } = convertKmField(fields.km);

  // The duplicate: same municipality link, same barangay part of the stored
  // name, case-insensitive — and it counts a deactivated row, because a stop
  // that exists but is inactive still owns its name.
  if (nameError === null && municipality !== null) {
    const editingId = context.editingId ?? null;
    const duplicate = context.terminals.some(
      (row) =>
        (editingId === null || row.id !== editingId) &&
        row.municipality_id === fields.municipalityId &&
        barangayNameOf(row.name).toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) nameError = duplicateBarangayError(name, municipality.name);
  }

  return { nameError, muniError, kmError, kmStored };
}

/**
 * The display label: `<name>, <province>` as the prototype prints it, minus
 * the double the app's own seed produces — that seed stores the province
 * inside the name too (`'Olongapo, Zambales'`), and printing the pair then
 * reads `Olongapo, Zambales, Zambales`.
 */
export function municipalityDisplayLabel(municipality: MunicipalityRowRecord): string {
  const province =
    typeof municipality.province === 'string' ? municipality.province : '';
  return province !== '' && !municipality.name.endsWith(`, ${province}`)
    ? `${municipality.name}, ${province}`
    : municipality.name;
}

/**
 * What goes into `terminals.name` — and what the hint promises, because the
 * hint is the only place the driver sees the stored value before it exists.
 *
 * Create composes `<barangay>, <municipality row name>`, the seed's own
 * shape (`'Santa Cruz, Olongapo'`). Edit keeps the stored tail byte-for-byte
 * unless the municipality actually changed: an edit that only fixes a KM
 * must not rewrite an existing row's tail under the last-comma readers.
 */
export function barangayEditorComposeName(
  fields: BarangayEditorFields,
  municipality: MunicipalityRowRecord | null,
  loaded: TerminalRowRecord | null,
): string {
  const name = fields.name.trim();
  if (loaded !== null && fields.municipalityId === loaded.municipality_id) {
    const comma = loaded.name.indexOf(',');
    return comma === -1 ? name : `${name}${loaded.name.slice(comma)}`;
  }
  return municipality === null ? name : `${name}, ${municipality.name}`;
}

/**
 * The nearest stored marker in the given rows, or the highest when no number
 * is typed yet — every figure is a stored row, inactive ones included,
 * because a deactivated stop still sits on the route. KM text renders through
 * `formatScaled`, so trailing zeros are trimmed: the honest rendering of
 * 5000 is `5 KM`, never `5.0 KM`. The caller owns the scoping: the barangay
 * route passes one municipality's rows, the terminal route the registry.
 */
function kmContextLine(
  terminals: TerminalRowRecord[],
  typedKm: number | null,
  /** What follows `nearest … · ` — the stored name as each editor prints it. */
  nameOf: (stored: string) => string,
): string {
  const rows = [...terminals].sort((a, b) => a.km_marker - b.km_marker);
  const format = (milli: number) => `${formatScaled(milli, SCALE_KM)} KM`;
  if (rows.length === 0) return 'no marker registered here yet';
  if (typedKm === null) {
    return `highest marker here ${format(rows[rows.length - 1].km_marker)}`;
  }
  let best = rows[0];
  for (const row of rows) {
    if (Math.abs(row.km_marker - typedKm) < Math.abs(best.km_marker - typedKm)) {
      best = row;
    }
  }
  return `nearest ${format(best.km_marker)} · ${nameOf(best.name)}`;
}

/**
 * The barangay route's hint under the card: the composed name, the province,
 * and the marker context the chosen municipality already holds — derived
 * from the same rows the registry lists, never typed. Before a municipality
 * is chosen it says exactly that and nothing else.
 */
export function barangayEditorHint(
  fields: BarangayEditorFields,
  context: {
    municipalities: MunicipalityRowRecord[];
    terminals: TerminalRowRecord[];
    loaded?: TerminalRowRecord | null;
  },
): string {
  if (fields.municipalityId === null) {
    return 'Choose a municipality to see the KM markers registered in it.';
  }
  const municipality =
    context.municipalities.find((row) => row.id === fields.municipalityId) ?? null;
  if (municipality === null) return '';
  const name = fields.name.trim();
  const province =
    typeof municipality.province === 'string' ? municipality.province : '';
  // A typed comma falls into the same branch as an empty name. The validator
  // refuses the comma outright, so composing a name from it would print a
  // `Stores "Bagong, Olongapo, Olongapo"` — telling the user this is what will
  // be saved while the field above them is being refused for exactly that. The
  // context (which municipality, which markers) is still true and still useful,
  // so that part of the line stays.
  const head =
    name === '' || name.includes(',')
      ? municipalityDisplayLabel(municipality)
      : `Stores "${barangayEditorComposeName(fields, municipality, context.loaded ?? null)}"${
          province === '' ? '' : ` · ${province}`
        }`;
  return `${head} · ${kmContextLine(
    context.terminals.filter((row) => row.municipality_id === municipality.id),
    convertKmField(fields.km).kmStored,
    barangayNameOf,
  )}`;
}

/**
 * The terminal route's hint: what will be stored, and where the typed marker
 * sits on the registered route. The route has no municipality field, so the
 * context is the WHOLE stop registry — every marker on the one road, however
 * it was filed. The typed number parses through the file's cap (a refused
 * `231000` reads as "nothing typed yet", so the hint shows the highest
 * marker), and the nearest line prints the FULL stored name, the way
 * add-terminal.html does (`nearest 232.4 KM · Olongapo, Olongapo`), because
 * that string is the row. No name means the caption is the context alone.
 */
export function terminalEditorHint(
  fields: { name: string; km: string },
  context: { terminals: TerminalRowRecord[] },
): string {
  const line = kmContextLine(context.terminals, parseTerminalKm(fields.km), (stored) => stored);
  if (fields.name.trim() === '') {
    // The caption is the context alone, sentence-case: "Highest marker here
    // 232.4 KM" or, on a registry with no rows yet, the honest "No marker
    // registered here yet".
    return line.charAt(0).toUpperCase() + line.slice(1);
  }
  return `Stores "${fields.name.trim()}" · ${line}`;
}

export type BarangayMunicipalityOption = {
  id: number;
  name: string;
  province: string;
  /** Every row of this municipality, any status — a card sub-line counts
   *  existence, so a municipality whose only stop is inactive still owns one. */
  barangayCount: number;
};

/**
 * What the municipality sheet offers: ACTIVE municipalities only (a new
 * record cannot belong to a deactivated one), sorted by province then name
 * so the list is geographic rather than by database id, each carrying the
 * all-status barangay count its sub-line prints.
 */
export function barangayEditorMunicipalityOptions(
  municipalities: MunicipalityRowRecord[],
  terminals: TerminalRowRecord[],
): BarangayMunicipalityOption[] {
  return municipalities
    .filter((row) => row.is_active === 1)
    .map((row) => ({
      id: row.id,
      name: row.name,
      province: typeof row.province === 'string' ? row.province : '',
      barangayCount: terminals.filter((term) => term.municipality_id === row.id).length,
    }))
    .sort((a, b) =>
      a.province === b.province
        ? a.name.localeCompare(b.name)
        : a.province.localeCompare(b.province),
    );
}

/**
 * Load-time prefill for edit: the field holds the BARANGAY part of the
 * stored name — the tail is carried by `barangayEditorComposeName` on write,
 * so re-entering it here would compose it twice.
 */
export function barangayEditorFieldsFromRecord(
  record: TerminalRowRecord | null,
): { name: string; municipalityId: number | null; km: string } | null {
  if (record === null) return null;
  const base = terminalEditorFieldsFromRecord(record);
  return {
    name: barangayNameOf(record.name),
    municipalityId: record.municipality_id,
    km: base === null ? '' : base.km,
  };
}
