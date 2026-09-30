import {
  MUNICIPALITY_NAME_COMMA_ERROR,
  MUNICIPALITY_NAME_ERROR,
  MUNICIPALITY_PROVINCE_COMMA_ERROR,
  MUNICIPALITY_PROVINCE_ERROR,
  MUNICIPALITY_SAVE_ERROR,
  commitMunicipalityEditorField,
  duplicateMunicipalityError,
  initialMunicipalityEditorUiState,
  municipalityEditorChrome,
  municipalityEditorHint,
  municipalityEditorUiStateFrom,
  municipalityEditorValidate,
} from './municipalityEditorState';

/**
 * Self-check for the Municipality Editor's pure logic.
 *
 * Run with: npx tsx src/lib/municipalityEditorState.test.ts
 *
 * The fragile parts: the refusal order (comma before the next field's
 * emptiness), every sentence verbatim from the prototype, the notice/mask
 * clearing rules, and the caption's count clauses — including the
 * one-municipality singular and the null-count frame.
 */

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'pass' : 'FAIL'}  ${name}${
      ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`
    }`,
  );
}

// ── create defaults ─────────────────────────────────────────────────────────
const init = initialMunicipalityEditorUiState();
check('create name empty', init.name, '');
check('create province empty', init.province, '');
check('no notice on open', init.notice, null);
check('no marked field on open', init.invalid, null);
check('not saving on open', init.isSaving, false);

// ── validation: the file's order, the file's sentences ──────────────────────
check(
  'name empty is first',
  municipalityEditorValidate({ name: '   ', province: '' }),
  { field: 'name', message: MUNICIPALITY_NAME_ERROR },
);
check(
  'the name comma beats an empty province',
  municipalityEditorValidate({ name: 'San, Jose', province: '' }),
  { field: 'name', message: MUNICIPALITY_NAME_COMMA_ERROR },
);
check(
  'province empty is third',
  municipalityEditorValidate({ name: 'San Jose', province: '  ' }),
  { field: 'province', message: MUNICIPALITY_PROVINCE_ERROR },
);
check(
  'the province comma is last before the duplicate',
  municipalityEditorValidate({ name: 'San Jose', province: 'Bulacan, Central' }),
  { field: 'province', message: MUNICIPALITY_PROVINCE_COMMA_ERROR },
);
check(
  'a clean pair passes the local checks',
  municipalityEditorValidate({ name: 'San Jose', province: 'Bulacan' }),
  null,
);
check(
  'validation does NOT check the duplicate — the data layer owns the pair',
  municipalityEditorValidate({ name: 'Malolos', province: 'Bulacan' }),
  null,
);
check(
  'the rejection sentence, verbatim',
  duplicateMunicipalityError('Malolos', 'Bulacan'),
  'Malolos is already listed in Bulacan.',
);
check('the save-failure sentence', MUNICIPALITY_SAVE_ERROR, 'Unable to save municipality.');

// ── one keystroke: notice out, this field's mark out, the other mark stays ──
const marked = {
  ...initialMunicipalityEditorUiState(),
  name: 'Malolos',
  province: 'Bulacan',
  notice: MUNICIPALITY_NAME_ERROR,
  invalid: 'name' as const,
};
const afterName = commitMunicipalityEditorField(marked, 'name', 'Malolo');
check('a name keystroke writes the value', afterName.name, 'Malolo');
check('a name keystroke clears the notice', afterName.notice, null);
check("a name keystroke clears the NAME's mark", afterName.invalid, null);
const afterProvince = commitMunicipalityEditorField(marked, 'province', 'Bulac');
check('a province keystroke clears the notice', afterProvince.notice, null);
check(
  "the name's mark survives a province keystroke — the value at fault did not change",
  afterProvince.invalid,
  'name',
);
check('the untouched value survives', afterProvince.name, 'Malolos');

// ── the caption ─────────────────────────────────────────────────────────────
check(
  'an empty province asks for input',
  municipalityEditorHint('', '', null),
  'Type a name and a province. A new municipality starts with no barangays.',
);
check(
  'the COUNT(*) frame shows the same instruction',
  municipalityEditorHint('San Jose', 'Bulacan', null),
  'Type a name and a province. A new municipality starts with no barangays.',
);
check(
  'both typed: the composed pair and the count',
  municipalityEditorHint('San Jose', 'Bulacan', 10),
  'Stores "San Jose, Bulacan" · 10 municipalities in Bulacan.',
);
check(
  'a province with none is the first, not zero',
  municipalityEditorHint('San Jose', 'Bulacan', 0),
  'Stores "San Jose, Bulacan" · first municipality in Bulacan.',
);
check(
  'one municipality is singular',
  municipalityEditorHint('San Jose', 'Bulacan', 1),
  'Stores "San Jose, Bulacan" · 1 municipality in Bulacan.',
);
check(
  'no name yet drops the Stores clause',
  municipalityEditorHint('', 'Bulacan', 10),
  '10 municipalities in Bulacan.',
);
check(
  'the count rule does not filter active — it counts the province',
  municipalityEditorHint('X', 'Zambales', 4),
  'Stores "X, Zambales" · 4 municipalities in Zambales.',
);

// ── the edit half: the same form, loaded from a stored row ──────────────────
const loaded = municipalityEditorUiStateFrom({ name: 'Olongapo', province: 'Zambales' });
check('an edit opens with the row\u2019s own name', loaded.name, 'Olongapo');
check('an edit opens with the row\u2019s own province', loaded.province, 'Zambales');
check('an edit opens with no notice', loaded.notice, null);
check('an edit opens with no marked field', loaded.invalid, null);
check(
  'the loaded values are not trimmed on the way in',
  municipalityEditorUiStateFrom({ name: ' San Jose ', province: ' Bulacan ' }).name,
  ' San Jose ',
);
// The same validator, unchanged: one form, one contract.
check(
  'a loaded row validates as valid',
  municipalityEditorValidate({ name: loaded.name, province: loaded.province }),
  null,
);
check(
  'a rename to the same pair is written, not refused here',
  municipalityEditorValidate({ name: 'Olongapo', province: 'Zambales' }),
  null,
);
check(
  'the comma refusal applies to edits too',
  municipalityEditorValidate({ name: 'Olongapo, Zambales', province: 'Zambales' }),
  { field: 'name', message: MUNICIPALITY_NAME_COMMA_ERROR },
);

// The chrome's two modes, in words.
const createChrome = municipalityEditorChrome(null);
check('create is titled Add Municipality', createChrome.title, 'Add Municipality');
check('create saves a municipality', createChrome.saveLabel, 'SAVE MUNICIPALITY');
const editChrome = municipalityEditorChrome(3);
check('edit is titled Edit Municipality', editChrome.title, 'Edit Municipality');
check('edit saves changes', editChrome.saveLabel, 'SAVE CHANGES');
check(
  'edit states what it does not touch',
  editChrome.subtitle,
  'Renames the record, keeps its links',
);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
