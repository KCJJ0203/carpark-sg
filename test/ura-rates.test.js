const test = require("node:test");
const assert = require("node:assert");
const { parseRateTable, feeFor, parseTime } = require("../src/ura-rates");

// The fixtures below are REAL rows from URA's Car_Park_Details, copied
// verbatim, because the whole point of this engine is that URA's own numbers
// drive it. Inventing plausible-looking rows would test the code against my
// idea of the data rather than against the data.

// ANGULLIA PARK OFF ST (A0007) - electronic, and one of the 146 carparks that
// publish a whole-night flat price alongside a per-half-hour rate.
const ANGULLIA = parseRateTable([
  { startTime: "07.00 AM", endTime: "11.00 AM", weekdayRate: "$1.30", weekdayMin: "30 mins", satdayRate: "$1.30", satdayMin: "30 mins", sunPHRate: "$0.70", sunPHMin: "30 mins" },
  { startTime: "11.00 AM", endTime: "05.00 PM", weekdayRate: "$1.50", weekdayMin: "30 mins", satdayRate: "$1.50", satdayMin: "30 mins", sunPHRate: "$0.80", sunPHMin: "30 mins" },
  { startTime: "05.00 PM", endTime: "10.30 PM", weekdayRate: "$0.80", weekdayMin: "30 mins", satdayRate: "$0.80", satdayMin: "30 mins", sunPHRate: "$0.80", sunPHMin: "30 mins" },
  { startTime: "10.30 PM", endTime: "07.00 AM", weekdayRate: "$0.70", weekdayMin: "30 mins", satdayRate: "$0.70", satdayMin: "30 mins", sunPHRate: "$0.70", sunPHMin: "30 mins" },
  { startTime: "10.30 PM", endTime: "07.00 AM", weekdayRate: "$5.60", weekdayMin: "510 mins", satdayRate: "$5.60", satdayMin: "510 mins", sunPHRate: "$5.60", sunPHMin: "510 mins" },
]);

// ALJUNIED RD (MINOR) (A0028) - a coupon street with two windows URA publishes
// NO rate for at all, and one that is explicitly free on Sundays.
const ALJUNIED = parseRateTable([
  { startTime: "07.00 AM", endTime: "08.30 AM" },
  { startTime: "08.30 AM", endTime: "05.00 PM", weekdayRate: "$0.60", weekdayMin: "30 mins", satdayRate: "$0.60", satdayMin: "30 mins", sunPHRate: "$0.00", sunPHMin: "0 mins" },
  { startTime: "05.00 PM", endTime: "10.00 PM", weekdayRate: "$0.00", weekdayMin: "0 mins", satdayRate: "$0.00", satdayMin: "0 mins", sunPHRate: "$0.00", sunPHMin: "0 mins" },
  { startTime: "10.00 PM", endTime: "07.00 AM" },
]);

// ALIWAL ST (A0004) - a coupon street that is explicitly free overnight, which
// is what makes ALJUNIED's silence meaningful rather than a synonym for free.
const ALIWAL = parseRateTable([
  { startTime: "07.00 AM", endTime: "08.30 AM", weekdayRate: "$0.00", weekdayMin: "0 mins", satdayRate: "$0.00", satdayMin: "0 mins", sunPHRate: "$0.00", sunPHMin: "0 mins" },
  { startTime: "08.30 AM", endTime: "05.00 PM", weekdayRate: "$0.60", weekdayMin: "30 mins", satdayRate: "$0.60", satdayMin: "30 mins", sunPHRate: "$0.60", sunPHMin: "30 mins" },
  { startTime: "05.00 PM", endTime: "10.00 PM", weekdayRate: "$0.60", weekdayMin: "30 mins", satdayRate: "$0.60", satdayMin: "30 mins", sunPHRate: "$0.60", sunPHMin: "30 mins" },
  { startTime: "10.00 PM", endTime: "07.00 AM", weekdayRate: "$0.00", weekdayMin: "0 mins", satdayRate: "$0.00", satdayMin: "0 mins", sunPHRate: "$0.00", sunPHMin: "0 mins" },
]);

// The adapter normalises URA's "C"/"B" to this wording, so the tests use what
// the adapter actually produces rather than what the API sends.
const cp = (rates, system) => ({
  id: "ura:TEST",
  parkingSystem: system === "C" ? "COUPON PARKING" : "ELECTRONIC PARKING",
  rates,
});
const at = (iso) => new Date(iso);
const never = () => false;

test("parses URA's clock format, including noon and midnight", () => {
  assert.strictEqual(parseTime("07.00 AM"), 420);
  assert.strictEqual(parseTime("10.30 PM"), 1350);
  assert.strictEqual(parseTime("12.00 PM"), 720);
  assert.strictEqual(parseTime("12.00 AM"), 0);
  assert.strictEqual(parseTime("nonsense"), null);
});

test("a window whose end is not after its start wraps past midnight", () => {
  const night = ANGULLIA.find((w) => w.from === 1350);
  assert.strictEqual(night.to, 420);
  assert.strictEqual(night.span, 510, "22.30 to 07.00 is 510 minutes");
});

test("prices a stay inside one window", () => {
  // Wednesday 09:00, one hour, at $1.30 per half hour.
  const r = feeFor(cp(ANGULLIA), at("2026-08-19T09:00:00+08:00"), 60, never);
  assert.strictEqual(r.total, 2.6);
  assert.strictEqual(r.capApplied, null);
});

// Rates change during the day, so a stay that crosses a boundary must be
// priced at each rate for the part of the stay it covers. Charging the whole
// stay at the rate in force on arrival is the obvious wrong implementation.
test("prices each half of a boundary-crossing stay at its own rate", () => {
  // 10:00 to 12:00 Wednesday: an hour at $1.30, then an hour at $1.50.
  const r = feeFor(cp(ANGULLIA), at("2026-08-19T10:00:00+08:00"), 120, never);
  assert.strictEqual(r.total, 5.6);
  assert.strictEqual(r.lines.length, 2);
  assert.deepStrictEqual(r.lines.map((l) => l.amount), [2.6, 3]);
});

test("uses the Sunday column on a Sunday", () => {
  const r = feeFor(cp(ANGULLIA), at("2026-08-23T09:00:00+08:00"), 60, never);
  assert.strictEqual(r.total, 1.4, "$0.70 per half hour, not the weekday $1.30");
});

test("prices a public holiday as a Sunday, because that is URA's own column", () => {
  const r = feeFor(cp(ANGULLIA), at("2026-08-19T09:00:00+08:00"), 60, () => true);
  assert.strictEqual(r.total, 1.4);
});

// The trap this engine exists for. URA publishes the night as TWO rows: an
// accruing rate and a flat price whose charging unit is the whole window. Read
// as a second rate it would bill $11.90 for a night URA sells at $5.60.
test("the whole-night flat price caps the night", async (t) => {
  await t.test("a full night is charged the flat price", () => {
    const r = feeFor(cp(ANGULLIA), at("2026-08-19T22:30:00+08:00"), 510, never);
    assert.strictEqual(r.metered, 11.9, "17 half hours at $0.70 accrues this");
    assert.strictEqual(r.total, 5.6, "but the night is sold at $5.60");
    assert.strictEqual(r.capApplied, "window");
  });

  await t.test("an hour of the night is NOT charged the flat price", () => {
    const r = feeFor(cp(ANGULLIA), at("2026-08-19T23:00:00+08:00"), 60, never);
    assert.strictEqual(r.total, 1.4);
    assert.strictEqual(r.capApplied, null, "a cap must not become a minimum charge");
  });

  // REGRESSION: every one of the 152 flat rows in the live data covers a window
  // that crosses midnight. An earlier version grouped charges by calendar day,
  // which split this stay at 00:00 and capped the two halves separately -
  // $7.70 instead of $5.60, on every Saturday night and every holiday eve.
  await t.test("a Saturday night running into Sunday is still one night", () => {
    const r = feeFor(cp(ANGULLIA), at("2026-08-22T22:30:00+08:00"), 510, never);
    assert.strictEqual(r.total, 5.6);
    assert.strictEqual(r.capApplied, "window");
  });

  await t.test("two nights are capped twice, not once", () => {
    // Wednesday 22:30 through to Friday 07:00: two whole nights and the day in
    // between, so the flat price applies once per night.
    const r = feeFor(cp(ANGULLIA), at("2026-08-19T22:30:00+08:00"), 510 + 930 + 510, never);
    const nightLines = r.lines.filter((l) => /Whole-night/.test(l.label));
    assert.strictEqual(nightLines.length, 2);
  });
});

// The breakdown has to add up, or the total is something the reader must take
// on trust - and this app's whole claim is that it shows its working.
test("the line items sum to the total", () => {
  for (const [name, start, mins] of [
    ["one window", "2026-08-19T09:00:00+08:00", 60],
    ["crossing", "2026-08-19T10:00:00+08:00", 120],
    ["capped night", "2026-08-19T22:30:00+08:00", 510],
    ["two nights", "2026-08-19T22:30:00+08:00", 1950],
  ]) {
    const r = feeFor(cp(ANGULLIA), at(start), mins, never);
    const sum = Math.round(r.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
    assert.strictEqual(sum, r.total, name);
  }
});

// The cardinal rule of this project, in the one place it is easiest to break.
// URA writes "$0.00 / 0 mins" where parking really is free. A row with no rate
// fields at all is a different thing, and in the live data it is always an
// on-street bay overnight or in the morning peak - which may mean free, or may
// mean no parking allowed. Guessing "free" is the guess that earns a fine.
test("an absent rate is not a free rate", async (t) => {
  await t.test("an explicitly free window costs nothing", () => {
    const r = feeFor(cp(ALIWAL, "C"), at("2026-08-19T07:15:00+08:00"), 30, never);
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.free, true);
    assert.strictEqual(r.unavailable, null);
  });

  await t.test("a window with no published rate cannot be priced", () => {
    const r = feeFor(cp(ALJUNIED, "C"), at("2026-08-19T07:30:00+08:00"), 30, never);
    assert.strictEqual(r.total, null, "never $0");
    assert.strictEqual(r.unavailable, "rate-not-published");
  });

  await t.test("a stay that only clips an unpriced window is still unpriced", () => {
    // 08:00 to 09:00 Wednesday: half an hour in the silent window, half in the
    // $0.60 one. Pricing only the half we know would understate the stay.
    const r = feeFor(cp(ALJUNIED, "C"), at("2026-08-19T08:00:00+08:00"), 60, never);
    assert.strictEqual(r.total, null);
    assert.strictEqual(r.unavailable, "rate-not-published");
  });

  await t.test("a carpark with no rate table at all says so", () => {
    const r = feeFor(cp([], "C"), at("2026-08-19T09:00:00+08:00"), 60, never);
    assert.strictEqual(r.total, null);
    assert.strictEqual(r.unavailable, "no-rates");
  });
});

test("a street that is free on Sundays is free on Sundays", () => {
  const r = feeFor(cp(ALJUNIED, "C"), at("2026-08-23T09:00:00+08:00"), 120, never);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.free, true);
});

test("prices a stay that starts free and turns chargeable", () => {
  // Aliwal St, Wednesday 08:00 for an hour: free until 08:30, then $0.60.
  const r = feeFor(cp(ALIWAL, "C"), at("2026-08-19T08:00:00+08:00"), 60, never);
  assert.strictEqual(r.total, 0.6);
  assert.strictEqual(r.free, false);
  assert.deepStrictEqual(r.lines.map((l) => l.label), ["Free parking", "$0.60 per 30 min"]);
});

// A paper coupon buys a whole block however little of it you use, so a coupon
// street quotes two honest numbers rather than one convenient one.
test("coupon carparks also report the whole-coupon price", () => {
  const r = feeFor(cp(ALIWAL, "C"), at("2026-08-19T09:00:00+08:00"), 45, never);
  assert.strictEqual(r.method, "coupon");
  assert.strictEqual(r.total, 0.9, "45 minutes by the minute");
  assert.strictEqual(r.couponTotal, 1.2, "but two half-hour coupons must be displayed");
});

test("electronic carparks quote no coupon price", () => {
  const r = feeFor(cp(ANGULLIA, "B"), at("2026-08-19T09:00:00+08:00"), 45, never);
  assert.strictEqual(r.method, "electronic");
  assert.strictEqual(r.couponTotal, null);
});

test("a zero-length stay costs nothing and is not an error", () => {
  const r = feeFor(cp(ANGULLIA), at("2026-08-19T09:00:00+08:00"), 0, never);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.unavailable, null);
});
