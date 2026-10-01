import { priceTicket, type FareRules } from './addTicketFare';

/**
 * Self-check for the fare rule's boundary.
 *
 * Run with: npx tsx src/lib/addTicketFare.test.ts
 *
 * Two cases, one boundary: at or under the minimum distance the fare is the
 * flat minimum fare (no rate multiplied); past it the fare is the distance
 * times the rate, with the minimum fare never added and never lifted onto it.
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
const price = (distanceMilli: number) =>
  priceTicket({
    distanceMilli,
    usesExpressWay: false,
    passengerType: 'REGULAR',
    quantity: 1,
    rules,
  })!.perPassengerCentavos;

// Inside the boundary: flat minimum fare, whatever the rate would say.
check('under the minimum distance is the minimum fare', price(1_000), 5_000);
check('at the minimum distance is the minimum fare', price(4_500), 5_000);

// Past the boundary: the whole distance times the rate, nothing added.
check('past the minimum distance is distance × rate', price(4_600), 460);
check('the minimum fare is never lifted onto a longer leg', price(10_000), 1_000);

process.exitCode = failures === 0 ? 0 : 1;
