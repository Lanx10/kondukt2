/**
 * The Municipality Editor's pure logic — add-municipality.html's two-field
 * create form, ported sentence for sentence.
 *
 * The screen owns rendering; this module owns the decisions. First, the
 * validation contract is the PROTOTYPE's, not the terminal editor's: one
 * refusal at a time, the field at fault returned WITH its message, because
 * this screen has no shared validator to honor and the file is the design.
 * The order is name empty → name comma → province empty → province comma —
 * the comma is second because it is a structural defect: two readers of the
 * same stored string (`barangayNameOf` first comma, `passengerState`'s
 * `municipalityOf` last comma) disagree while the value is ambiguous, so no
 * later check can be trusted first. The DUPLICATE is deliberately not
 * checked here: its rule is a SELECT on the pair in the data layer, and its
 * rejection arrives through the same notice slot verbatim.
 *
 * Second, the notice is ONE slot for a field refusal and a whole-save
 * failure alike — one message, never a stack — and the two channels differ
 * by their mark: a field refusal also marks and focuses its field, a save
 * failure does not touch a field.
 *
 * Third, the caption: derived, never typed. The count is the data layer's
 * COUNT(*) over the same table the registry lists, passed in as it arrives.
 */

export type MunicipalityEditorField = 'name' | 'province';

export type MunicipalityEditorUiState = {
  name: string;
  province: string;
  /** The one notice slot: a refusal sentence or a save failure, never both. */
  notice: string | null;
  /** Which field the current refusal marked; null on a save failure. */
  invalid: MunicipalityEditorField | null;
  isSaving: boolean;
};

export const MUNICIPALITY_NAME_ERROR = 'Enter the municipality name.';
export const MUNICIPALITY_NAME_COMMA_ERROR = 'Remove the comma from the municipality name.';
export const MUNICIPALITY_PROVINCE_ERROR = 'Enter the province.';
export const MUNICIPALITY_PROVINCE_COMMA_ERROR = 'Remove the comma from the province.';
/**
 * The SQLite equivalent of the prototype's storage-quota sentence: the app
 * writes through INSERT, and a rejected INSERT is the honest failure here.
 */
export const MUNICIPALITY_SAVE_ERROR = 'Unable to save municipality.';

/** The data layer's rejection, echoed verbatim: `<name> is already listed in <province>.` */
export function duplicateMunicipalityError(name: string, province: string): string {
  return `${name} is already listed in ${province}.`;
}

/** Both fields EMPTY in create — nothing is pre-filled for a new record. */
export function initialMunicipalityEditorUiState(): MunicipalityEditorUiState {
  return { name: '', province: '', notice: null, invalid: null, isSaving: false };
}

/**
 * The same state, loaded from a stored row — the screen's edit half.
 *
 * The two fields are the row's own values, untouched: the editor writes back
 * what it shows, and a trimmed-on-load value would silently rewrite a record
 * nobody edited. The validation trims for its own checks, not for the form.
 */
export function municipalityEditorUiStateFrom(row: {
  name: string;
  province: string;
}): MunicipalityEditorUiState {
  return { name: row.name, province: row.province, notice: null, invalid: null, isSaving: false };
}

/**
 * The screen's chrome, in its two modes.
 *
 * Editing is the same two fields and the same one write; what changes is what
 * the screen may promise. A rename does not reach the barangays already linked
 * to the row — their stored names are snapshots — so the subtitle says what the
 * change does and does not touch rather than repeating the create copy.
 */
export function municipalityEditorChrome(id: number | null): {
  title: string;
  subtitle: string;
  backLabel: string;
  saveLabel: string;
} {
  return id === null
    ? {
        title: 'Add Municipality',
        subtitle: 'Groups barangays under one place',
        backLabel: 'Back to barangay configuration',
        saveLabel: 'SAVE MUNICIPALITY',
      }
    : {
        title: 'Edit Municipality',
        subtitle: 'Renames the record, keeps its links',
        backLabel: 'Back to barangay configuration',
        saveLabel: 'SAVE CHANGES',
      };
}

/**
 * The first refusal, in the file's order. Trimming happens here — what is
 * stored is the trimmed value, so what is validated is the trimmed value.
 */
export function municipalityEditorValidate(fields: {
  name: string;
  province: string;
}): { field: MunicipalityEditorField; message: string } | null {
  const name = fields.name.trim();
  if (name === '') return { field: 'name', message: MUNICIPALITY_NAME_ERROR };
  if (name.indexOf(',') !== -1) {
    return { field: 'name', message: MUNICIPALITY_NAME_COMMA_ERROR };
  }
  const province = fields.province.trim();
  if (province === '') return { field: 'province', message: MUNICIPALITY_PROVINCE_ERROR };
  if (province.indexOf(',') !== -1) {
    return { field: 'province', message: MUNICIPALITY_PROVINCE_COMMA_ERROR };
  }
  return null;
}

/**
 * A keystroke in one field: the value updates, the notice clears (the file
 * clears it on any input), and THAT field's mark clears — the error belonged
 * to the value that caused it, so it goes when that value changes, not when
 * a notice is dismissed. This notice has no dismiss at all. The other
 * field's mark survives its neighbour's keystroke, exactly as the file's
 * `removeAttribute` on the typed element does.
 */
export function commitMunicipalityEditorField(
  state: MunicipalityEditorUiState,
  field: MunicipalityEditorField,
  value: string,
): MunicipalityEditorUiState {
  return {
    ...state,
    name: field === 'name' ? value : state.name,
    province: field === 'province' ? value : state.province,
    notice: null,
    invalid: state.invalid === field ? null : state.invalid,
  };
}

/**
 * The caption under the card — the screen's only count, `.range-caption` in
 * the file, 10px below the card. Empty province asks for input; a counted
 * province names what it already has (a typo reads as a wrong count instead
 * of quietly minting a new province); `count === null` is the one frame
 * before the COUNT(*) answers, and the instruction stands in for it.
 */
export function municipalityEditorHint(
  name: string,
  province: string,
  count: number | null,
): string {
  const trimmedProvince = province.trim();
  if (trimmedProvince === '' || count === null) {
    return 'Type a name and a province. A new municipality starts with no barangays.';
  }
  const tail =
    count === 0
      ? `first municipality in ${trimmedProvince}`
      : `${count} ${count === 1 ? 'municipality' : 'municipalities'} in ${trimmedProvince}`;
  const trimmedName = name.trim();
  return trimmedName === ''
    ? `${tail}.`
    : `Stores "${trimmedName}, ${trimmedProvince}" · ${tail}.`;
}
