const test = require("node:test");
const assert = require("node:assert");
const { bucketFor, accumulate, encode, typical, MIN_SAMPLES, BUCKETS } = require("../src/patterns");

// Carparks behave completely differently by day type. An HDB residential
// carpark is full overnight and empty at 10am on a WEEKDAY, but stays full on a
// Sunday morning. Averaging those together would describe neither, so the week
// is split into weekday / Saturday / Sunday-or-holiday, 24 hours each.
test("has 72 buckets: three day types by 24 hours", () => {
  assert.strictEqual(BUCKETS, 72);
});

test("puts a weekday morning in the weekday band", () => {
  // Wednesday 09:00 SGT
  assert.strictEqual(bucketFor(new Date("2026-08-19T09:00:00+08:00"), false), 9);
});

test("separates Saturday from the working week", () => {
  assert.strictEqual(bucketFor(new Date("2026-08-22T09:00:00+08:00"), false), 24 + 9);
});

test("separates Sunday", () => {
  assert.strictEqual(bucketFor(new Date("2026-08-23T09:00:00+08:00"), false), 48 + 9);
});

// A public holiday behaves like a Sunday - people are at home and parking is
// free at most HDB carparks. Treating it as an ordinary weekday would poison
// the weekday average with a day that looks nothing like one.
test("treats a public holiday as a Sunday, even midweek", () => {
  assert.strictEqual(bucketFor(new Date("2026-08-19T09:00:00+08:00"), true), 48 + 9);
});

const snap = (t, id, total, available) => ({
  t, r: [[id, "C", total, available, 0]],
});

// Same weekday and hour, N weeks apart. Written as real date arithmetic because
// hand-rolling "19 + w * 7" produced 2026-08-33 and 2026-08-40, which are not
// dates - the tests failed and the code was fine.
const weeklyAt = (startIso, weeks) => {
  const d = new Date(startIso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString();
};

test("averages repeated readings for the same bucket", () => {
  const acc = accumulate([
    snap("2026-08-19T01:00:00Z", "hdb:A", 100, 40),  // 09:00 SGT Wednesday
    snap("2026-08-26T01:00:00Z", "hdb:A", 100, 60),  // 09:00 SGT the next Wednesday
  ], () => false);
  assert.strictEqual(acc["hdb:A"][9].count, 2);
  assert.ok(Math.abs(acc["hdb:A"][9].sum / acc["hdb:A"][9].count - 0.5) < 1e-9);
});

test("ignores readings with no usable total", () => {
  const acc = accumulate([{ t: "2026-08-19T01:00:00Z", r: [["hdb:A", "C", 0, 0, 0]] }], () => false);
  assert.strictEqual(acc["hdb:A"], undefined);
});

// Only car lots drive the headline number. Motorcycle lots being empty says
// nothing about whether a driver will find a space.
test("uses car lots only", () => {
  const acc = accumulate([{ t: "2026-08-19T01:00:00Z", r: [["hdb:A", "Y", 20, 20, 0]] }], () => false);
  assert.strictEqual(acc["hdb:A"], undefined);
});

test("encodes a bucket as a decile digit", () => {
  const acc = accumulate([snap("2026-08-19T01:00:00Z", "hdb:A", 100, 40)], () => false);
  // One sample is below the threshold, so it must not be published as fact.
  assert.strictEqual(encode(acc["hdb:A"])[9], "-");
});

test("publishes a bucket once it has enough samples", () => {
  const snaps = [];
  for (let w = 0; w < MIN_SAMPLES; w++) {
    snaps.push(snap(weeklyAt("2026-08-19T01:00:00Z", w), "hdb:A", 100, 40));
  }
  const acc = accumulate(snaps, () => false);
  const s = encode(acc["hdb:A"]);
  assert.notStrictEqual(s[9], "-", "should be published now");
  assert.strictEqual(s.length, BUCKETS);
});

// Reading a bucket back must say plainly when it does not know, so the UI can
// stay silent rather than draw a confident line through three data points.
test("reports unknown buckets as unknown", () => {
  const r = typical("-".repeat(72), 9);
  assert.strictEqual(r.known, false);
});

test("round-trips an availability figure to within a decile", () => {
  const snaps = [];
  for (let w = 0; w < MIN_SAMPLES; w++) {
    snaps.push(snap(weeklyAt("2026-08-19T01:00:00Z", w), "hdb:A", 100, 40));
  }
  const s = encode(accumulate(snaps, () => false)["hdb:A"]);
  const r = typical(s, 9);
  assert.strictEqual(r.known, true);
  assert.ok(Math.abs(r.available - 0.4) <= 0.05, "got " + r.available);
});

// A carpark whose sensors are dead reports every lot free, for ever. The list
// already flags that ("sensors may be down") - but the predictions used to
// swallow it as truth and then say "Usually 100% free now" with complete
// confidence. Measured in real history: hdb:ACM reported every one of its 738
// readings as fully empty, and 20 other carparks did the same.
//
// A confident wrong number is this project's cardinal sin: it sends someone
// across town to a full carpark. Silence is the honest answer.
test("readings that look like dead sensors are not learned from", async (t) => {
  const isHoliday = () => false;

  // Ten Wednesdays at 09:00 SGT, which is bucket 9.
  const START = "2026-08-19T01:00:00Z";
  const weeks = (n) => Array.from({ length: n }, (_, i) => weeklyAt(START, i));

  await t.test("a big carpark reporting every lot free teaches nothing", () => {
    const acc = accumulate(weeks(10).map((t) => snap(t, "hdb:DEAD", 500, 500)), isHoliday);
    assert.strictEqual(acc["hdb:DEAD"], undefined,
      "a carpark with only unreported-looking readings should have no pattern at all");
  });

  await t.test("a small carpark really can be empty, and is believed", () => {
    // Below the 50-lot line an empty carpark is entirely plausible, so warning
    // about these would train people to ignore the warning.
    const acc = accumulate(weeks(10).map((t) => snap(t, "hdb:TINY", 8, 8)), isHoliday);
    assert.ok(acc["hdb:TINY"], "8 of 8 lots free is believable");
    assert.strictEqual(encode(acc["hdb:TINY"])[9], "9");
  });

  await t.test("good readings survive alongside discarded ones", () => {
    const snaps = weeks(10).map((t) => ({
      t, r: [["hdb:MIXED", "C", 500, 500, 0], ["hdb:REAL", "C", 500, 250, 0]],
    }));
    const acc = accumulate(snaps, isHoliday);
    assert.strictEqual(acc["hdb:MIXED"], undefined);
    assert.ok(acc["hdb:REAL"], "a plausible reading in the same snapshot is kept");
    assert.strictEqual(encode(acc["hdb:REAL"])[9], "5", "250 of 500 is about half");
  });
});
