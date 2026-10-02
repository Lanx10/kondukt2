import {
  priceTicket,
  MINIMUM_FARE_DISCOUNT_PERCENT,
  type FareRules,
  type PassengerType,
} from './addTicketFare';

/**
 * Self-check for the fare rule's boundary.
 *
 * Run with: npx tsx src/lib/addTicketFare.test.ts
 *
 * Two cases, one boundary, one rounding: at or under the minimum distance
 * the fare is the flat minimum fare (no rate multiplied); past it the fare is
 * the distance times the rate, with the minimum fare never added and never
 * lifted onto it; and either way the fare is a whole peso, `.5`–`.9` up,
 * `.4`–`.0` down.
 *
 * And the one place the two do not agree: a concessionaire on the **minimum**
 * fare is a percentage off it, not metered at the special peso per km, because
 * the minimum is a flat amount with no distance for a per-km rate to multiply.
 * Past the minimum the special peso per km stands, untouched by any percentage.
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

// ₱50 minimum fare over the first 4.5 km, then ₱1 per km — the rate is
// deliberately too small to reach the minimum fare, so a lift would show.
const rules: FareRules = {
  minimumFareCentavos: 5_000,
  minimumDistanceMilli: 4_500,
  ratePerKmCentavos: 100,
  expressRatePerKmCentavos: 100,
  specialRatePerKmCentavos: 50,
  specialExpressRatePerKmCentavos: 50,
};
const priceOf = (
  distanceMilli: number,
  passengerType: PassengerType = 'REGULAR',
  usesExpressWay = false,
) =>
  priceTicket({
    distanceMilli,
    usesExpressWay,
    passengerType,
    quantity: 1,
    rules,
  })!;
const price = (distanceMilli: number) => priceOf(distanceMilli).perPassengerCentavos;

// Inside the boundary: flat minimum fare, whatever the rate would say.
check('under the minimum distance is the minimum fare', price(1_000), 5_000);
check('at the minimum distance is the minimum fare', price(4_500), 5_000);

// Past the boundary: the whole distance times the rate, nothing added, then
// rounded to the whole peso — the fraction decides, `.5` up and `.4` down.
check('₱4.60 rounds up to ₱5.00', price(4_600), 500);
check('₱7.90 rounds up to ₱8.00', price(7_900), 800);
check('₱7.40 rounds down to ₱7.00', price(7_400), 700);
check('the minimum fare is never lifted onto a longer leg', price(10_000), 1_000);

// The concession on the minimum fare: a percentage, never the special rate.
// ₱50.00 less 20% is ₱40.00, while the special ₱0.50/km would have made the
// very same leg ₱4.50 — the wrong kind of number entirely for a flat fare.
check('PWD inside the minimum is 20% off the minimum fare', priceOf(1_000, 'PWD').perPassengerCentavos, 4_000);
check('PWD at the minimum distance is 20% off', priceOf(4_500, 'PWD').perPassengerCentavos, 4_000);
check('a Student on the minimum is discounted the same way', priceOf(1_000, 'STUDENT').perPassengerCentavos, 4_000);
check('a Senior on the minimum is discounted the same way', priceOf(1_000, 'SENIOR_CITIZEN').perPassengerCentavos, 4_000);

// The road cannot change a flat peso amount, so the express way discounts the
// minimum by the same percentage — it does not add a second rule.
check('the express way does not change the minimum discount', priceOf(1_000, 'PWD', true).perPassengerCentavos, 4_000);

// Past the minimum the special peso per km is the discount, and no percentage
// is subtracted from it. 10 km x ₱0.50 = ₱5.00.
check('past the minimum a PWD is metered at the special peso per km', priceOf(10_000, 'PWD').perPassengerCentavos, 500);
check('past the minimum no percentage is taken off the special rate', priceOf(10_000, 'PWD').minimumDiscountPercent, 0);
check('inside the minimum the breakdown reports the percentage', priceOf(1_000, 'PWD').minimumDiscountPercent, MINIMUM_FARE_DISCOUNT_PERCENT);

// A Regular passenger is never a concessionaire: the minimum is the minimum.
check('a Regular passenger is never discounted', priceOf(1_000, 'REGULAR').perPassengerCentavos, 5_000);
check('a Regular passenger reports no discount', priceOf(1_000, 'REGULAR').minimumDiscountPercent, 0);

// The discount is per passenger, so a group of three is three times ₱40.00.
const threePax = priceTicket({ distanceMilli: 1_000, usesExpressWay: false, passengerType: 'PWD', quantity: 3, rules })!;
check('the discount is per passenger', threePax.perPassengerCentavos * 3, threePax.totalCentavos);
check('three discounted passengers total ₱120.00', threePax.totalCentavos, 12_000);

// A minimum fare that is not a whole peso: the percentage is taken on integers
// and the whole-peso rounding then does what it does everywhere else.
const oddRules: FareRules = { ...rules, minimumFareCentavos: 3_333 };
const odd = (passengerType: PassengerType) =>
  priceTicket({ distanceMilli: 1_000, usesExpressWay: false, passengerType, quantity: 1, rules: oddRules })!;
check('a Regular still pays the odd minimum, rounded to ₱33.00', odd('REGULAR').perPassengerCentavos, 3_300);
check('a PWD pays 20% off the odd minimum, rounded to ₱27.00', odd('PWD').perPassengerCentavos, 2_700);

process.exitCode = failures === 0 ? 0 : 1;
