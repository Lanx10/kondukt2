import {
  applyFareInputFilter,
  fareTextFromStored,
  formatScaled,
  parseScaled,
  SCALE_KM,
  SCALE_PERCENT,
  SCALE_PESO,
  toStoredFareValues,
  validateFareFields,
} from './fareFormat';

/**
 * Self-check for the fare scale conversions and save-time validation.
 *
 * Run with: npx tsx src/lib/fareFormat.test.ts
 *
 * The fragile parts: exact decimal semantics without floats, half-away-from-
 * zero rounding, trailing-zero stripping on load, percent bounds, and the
 * input filter's shape.
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

// ── parse: money ×100 ───────────────────────────────────────────────────────
check('1.75 → 175 centavos', parseScaled('1.75', SCALE_PESO), 175);
check('50 → 5000 centavos', parseScaled('50', SCALE_PESO), 5000);
check('0 parses as zero, not empty', parseScaled('0', SCALE_PESO), 0);
check('0.00 parses as zero', parseScaled('0.00', SCALE_PESO), 0);
check('2.50 → 250 (trailing zero kept)', parseScaled('2.50', SCALE_PESO), 250);

// Half away from zero: the third decimal decides.
check('1.755 → 176 (half rounds up)', parseScaled('1.755', SCALE_PESO), 176);
check('1.754 → 175 (under half rounds down)', parseScaled('1.754', SCALE_PESO), 175);

// ── parse: km ×1000 ─────────────────────────────────────────────────────────
check('4.5 km → 4500 thousandths', parseScaled('4.5', SCALE_KM), 4500);
check('0.5 km → 500 thousandths', parseScaled('0.5', SCALE_KM), 500);
check('4.5005 km → 4501 (half up)', parseScaled('4.5005', SCALE_KM), 4501);

// ── parse: rejects ──────────────────────────────────────────────────────────
check('empty is rejected', parseScaled('', SCALE_PESO), null);
check('whitespace is rejected', parseScaled('   ', SCALE_PESO), null);
check('1.2.3 is rejected', parseScaled('1.2.3', SCALE_PESO), null);
check('-5 is rejected', parseScaled('-5', SCALE_PESO), null);
check('letters are rejected', parseScaled('abc', SCALE_PESO), null);

// ── format: trailing zeros stripped ─────────────────────────────────────────
check('1000 → "10"', formatScaled(1000, SCALE_PESO), '10');
check('175 → "1.75"', formatScaled(175, SCALE_PESO), '1.75');
check('2000 → "20"', formatScaled(2000, SCALE_PERCENT), '20');
check('2050 → "20.5"', formatScaled(2050, SCALE_PERCENT), '20.5');
check('4500 → "4.5"', formatScaled(4500, SCALE_KM), '4.5');
check('0 → "0"', formatScaled(0, SCALE_PESO), '0');

// ── input filter ────────────────────────────────────────────────────────────
check('digits pass', applyFareInputFilter('', '12.5'), '12.5');
check('minus dropped', applyFareInputFilter('5', '-5'), '5');
check('comma dropped', applyFareInputFilter('1', '1,5'), '1');
check('peso sign dropped', applyFareInputFilter('5', '₱5'), '5');
check('letters dropped entirely', applyFareInputFilter('', '1a'), '');
check('letters dropped keeping prior text', applyFareInputFilter('1', '1a'), '1');
check('two decimal points CAN be typed', applyFareInputFilter('1.2', '1.2.3'), '1.2.3');
check('more decimal points still typeable', applyFareInputFilter('1.2.3', '1.2.3.'), '1.2.3.');

// ── validation ──────────────────────────────────────────────────────────────
const good = {
  minimumFare: '50',
  minimumDistance: '4.5',
  ratePerKm: '1.75',
  expressRatePerKm: '2.25',
  deluxeRatePerKm: '2.50',
  expressDeluxeRatePerKm: '3.00',
  specialRate: '1.00',
  specialExpressRate: '1.25',
  specialDeluxeRate: '1.50',
  specialExpressDeluxeRate: '1.75',
};
check('a complete form validates clean', validateFareFields(good), null);

const oneBad = { ...good, minimumFare: '' };
const oneBadErrors = validateFareFields(oneBad);
check('empty field fails with its message', oneBadErrors?.minimumFare, 'Enter a valid minimum fare.');
check('other fields stay clean in the same pass', Object.keys(oneBadErrors ?? {}).length, 1);

const threeBad = { ...good, minimumFare: '', ratePerKm: '1.2.3', expressRatePerKm: '-1' };
check('three bad fields report together', Object.keys(validateFareFields(threeBad) ?? {}).length, 3);

check('passenger express rate validates clean', validateFareFields({ ...good, specialExpressRate: '2.50' }), null);
check('zero is not treated as empty', validateFareFields({ ...good, minimumFare: '0', minimumDistance: '0' }), null);

// ── round trip and stored conversion ────────────────────────────────────────
const stored = toStoredFareValues(good);
check('minimum fare stored as centavos', stored.minimumFare, 5000);
check('minimum distance stored as thousandths', stored.minimumDistance, 4500);
check('regular rate stored as centavos', stored.ratePerKm, 175);
check('passenger express rate stored as centavos', stored.specialExpressRate, 125);
check('passenger express deluxe rate stored as centavos', stored.specialExpressDeluxeRate, 175);

const derived = fareTextFromStored(
  {
    minimum_fare: 1000,
    minimum_distance_milli: 4500,
    rate_per_km: 175,
    express_rate_per_km: 225,
    deluxe_rate_per_km: 250,
    express_deluxe_rate_per_km: 300,
    special_rate_per_km: 100,
    special_express_rate_per_km: 125,
    special_deluxe_rate_per_km: 150,
    special_express_deluxe_rate_per_km: 175,
  },
);
check('loaded minimum fare strips zeros', derived.minimumFare, '10');
check('loaded rate keeps significant decimals', derived.ratePerKm, '1.75');
check('loaded passenger express rate strips zeros', derived.specialExpressRate, '1.25');
check('loaded passenger express deluxe rate', derived.specialExpressDeluxeRate, '1.75');

const noRow = fareTextFromStored(null);
check('no fare row keeps fields empty', noRow.minimumFare, '');

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
