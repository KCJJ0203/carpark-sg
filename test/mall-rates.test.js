const test = require("node:test");
const assert = require("node:assert");
const { feeFor, validate } = require("../src/mall-rates");
const { TARIFFS } = require("../src/mall-tariffs");

// Expected totals are worked out BY HAND from each mall's posted wording, not
// read off the engine. The tariffs are the real transcribed ones, so these
// also pin the transcription: change a price and a test here should break.

const at = (s) => new Date(s + "+08:00");
const noHoliday = () => false;
const fee = (id, when, minutes, holiday) => feeFor(TARIFFS[id], at(when), minutes, holiday || noHoliday);

test("every transcribed tariff is well formed and covers every minute", () => {
  for (const [id, t] of Object.entries(TARIFFS)) assert.ok(validate(id, t), id);
});

test("Plaza Singapura, weekday afternoon: first hour then per 15 minutes", () => {
  // Tue 2pm, 2 hours: $1.95 + 4 x $0.55
  assert.strictEqual(fee("lta:9", "2026-11-03T14:00", 120).total, 4.15);
});

test("a stay inside the grace period is free", () => {
  const f = fee("lta:9", "2026-11-03T14:00", 10);
  assert.strictEqual(f.total, 0);
  assert.ok(f.grace);
});

test("a stay crossing into the evening adds the entry charge and says it is an estimate", () => {
  // Tue 5pm-7pm: $1.95 for 5-6pm, then $3.25 per entry from 6pm
  const f = fee("lta:9", "2026-11-03T17:00", 120);
  assert.strictEqual(f.total, 5.2);
  assert.ok(f.crossed);
});

test("CQ: free lunch window sits inside the hourly rate", () => {
  // Tue 11am-3pm: $1.60 first hour, free 12-2pm, then 4 x $0.55 from 2pm
  assert.strictEqual(fee("lta:59", "2026-11-03T11:00", 240).total, 3.8);
});

test("CQ: the evening free window ends on 31 Dec 2026", () => {
  assert.strictEqual(fee("lta:59", "2026-11-03T18:00", 120).total, 0);
  // Same Tuesday evening in January: $1.60 + 4 x $0.55
  assert.strictEqual(fee("lta:59", "2027-01-05T18:00", 120).total, 3.8);
});

test("CQ: 3am on Sunday is still Saturday's night, hourly, not Sunday's entry", () => {
  assert.strictEqual(fee("lta:59", "2026-11-08T03:00", 60).total, 1.6);
  assert.strictEqual(fee("lta:59", "2026-11-08T08:00", 60).total, 3);
});

test("CQ: a public holiday on a weekday is per entry; its eve is not free", () => {
  const ph = (iso) => iso === "2026-11-04";
  assert.strictEqual(fee("lta:59", "2026-11-04T13:00", 60, ph).total, 3);
  // Tue 3 Nov is the eve: no free lunch, $1.60 + 4 x $0.55
  assert.strictEqual(fee("lta:59", "2026-11-03T12:00", 120, ph).total, 3.8);
});

test("Marina Square weekend: tiered first hours then per half hour", () => {
  // Sat 1pm, 5 hours: $2.44 (2h) + $1.22 + $1.22 + 2 x $1.43
  assert.strictEqual(fee("lta:2", "2026-11-07T13:00", 300).total, 7.74);
});

test("IMM weekday: first hour free, second $1.20, then $0.40 per 15 minutes", () => {
  assert.strictEqual(fee("lta:53", "2026-11-03T13:00", 180).total, 2.8);
  assert.strictEqual(fee("lta:53", "2026-11-03T13:00", 60).total, 0);
});

test("The Cathay: 2am on Tuesday belongs to Monday night's entry charge", () => {
  assert.strictEqual(fee("lta:10", "2026-11-03T02:00", 60).total, 2.95);
});

test("Suntec weekends are not priced rather than guessed", () => {
  const f = fee("lta:1", "2026-11-07T13:00", 120);
  assert.strictEqual(f.total, null);
  assert.strictEqual(f.unavailable, "rate-not-published");
  // Weekday: $2.60 + 2 x $1.30
  assert.strictEqual(fee("lta:1", "2026-11-03T10:00", 120).total, 5.2);
});

test("Funan on a weekday public holiday uses the weekend table", () => {
  const ph = (iso) => iso === "2026-11-02";
  // Mon PH 1pm, 3 hours: $2.60 (first 2h) + 4 x $0.65
  assert.strictEqual(fee("lta:66", "2026-11-02T13:00", 180, ph).total, 5.2);
});

test("a carpark with no tariff is unpriced, never $0", () => {
  const f = feeFor(undefined, at("2026-11-03T13:00"), 60, noHoliday);
  assert.strictEqual(f.total, null);
  assert.strictEqual(f.unavailable, "source-has-no-rates");
});

test("Resorts World: weekday daily cap", () => {
  // Tue 10am, 10 hours: $6.50 + 18 x $1.10 = $26.30, capped at $13.10
  const f = fee("lta:26", "2026-11-03T10:00", 600);
  assert.strictEqual(f.total, 13.1);
  assert.strictEqual(f.capApplied, "day");
});

test("Wisma Atria: lunch surcharge only for cars entering 12-2pm", () => {
  // Tue 1pm, 1 hour: $2.60 + $1.10
  assert.strictEqual(fee("lta:14", "2026-11-03T13:00", 60).total, 3.7);
  // Tue 11am, 2 hours, parked over lunch but entered before it: $2.60 + 2 x $1.70
  assert.strictEqual(fee("lta:14", "2026-11-03T11:00", 120).total, 6);
});

test("Paragon: peak surcharge Mon-Sat only", () => {
  // Tue 2pm, 1 hour: $3.00 + $2.10
  assert.strictEqual(fee("lta:55", "2026-11-03T14:00", 60).total, 5.1);
  // Sun 2pm: no surcharge
  assert.strictEqual(fee("lta:55", "2026-11-08T14:00", 60).total, 3);
});

test("Orchard Gateway charges a fresh first hour in each slot", () => {
  // Tue 5pm-7pm: $2.40 (5-6pm) + $2.51 (6-7pm, a new first hour)
  assert.strictEqual(fee("lta:52", "2026-11-03T17:00", 120).total, 4.91);
});

test("VivoCity: weekday and weekend, eve of a holiday priced as weekend", () => {
  // Tue 2pm, 2 hours: $1.60 + 2 x $0.80
  assert.strictEqual(fee("lta:16", "2026-11-03T14:00", 120).total, 3.2);
  // Sat: $2.20 + 2 x $1.10
  assert.strictEqual(fee("lta:50", "2026-11-07T14:00", 120).total, 4.4);
  const ph = (iso) => iso === "2026-11-04";
  assert.strictEqual(fee("lta:16", "2026-11-03T14:00", 120, ph).total, 4.4);
});

test("Sentosa: per 15 minutes by day, capped at $10 a day", () => {
  // Sat 10am, 1h: 4 x $0.55
  assert.strictEqual(fee("lta:17", "2026-11-07T10:00", 60).total, 2.2);
  // Sat 8am-5pm then evening entry: 36 x $0.55 = $19.80 + $4.00, capped at $10
  assert.strictEqual(fee("lta:17", "2026-11-07T08:00", 600).total, 10);
});

test("Ngee Ann City: posted before GST, so 9% is added to the total", () => {
  // Tue 3pm, 1h: 2 x $1.20 = $2.40, plus 9% = $2.616
  assert.strictEqual(fee("lta:13", "2026-11-17T15:00", 60).total, 2.62);
  // Sat 3pm, 2h: $2.40 first hour + 2 x $1.50 = $5.40, plus 9% = $5.886
  assert.strictEqual(fee("lta:13", "2026-11-21T15:00", 120).total, 5.89);
});

test("hours a carpark gives no rate for are never priced", () => {
  // Far East Plaza says nothing about midnight to 8am.
  assert.strictEqual(fee("lta:20", "2026-11-17T07:00", 120).unavailable, "rate-not-published");
  assert.strictEqual(fee("lta:20", "2026-11-17T07:00", 120).total, null);
  // From 8am it is priced: $2.00 + 2 x $1.50 = $5.00, plus 9%
  assert.strictEqual(fee("lta:20", "2026-11-17T10:00", 120).total, 5.45);
});

test("Millenia: Friday's evening entry runs to 2am, Sunday's band into Monday", () => {
  // Arriving 12.30am on a Saturday is still Friday night: $3.00 per entry
  assert.strictEqual(fee("lta:5", "2026-11-21T00:30", 30).total, 3);
  // Arriving 1am on a Monday is still Sunday: $2.80 for the first 2 hours
  assert.strictEqual(fee("lta:5", "2026-11-23T01:00", 60).total, 2.8);
  // A Wednesday 3am is Tuesday night's overnight rate: $3.90 first hour
  assert.strictEqual(fee("lta:5", "2026-11-18T03:00", 60).total, 3.9);
});

test("Tang Plaza: 5 cents a minute after the first hour, capped at $18", () => {
  // 6am-4pm: $3.00 + 540 x $0.05 = $30.00, capped
  assert.strictEqual(fee("lta:18", "2026-11-17T06:00", 600).total, 18);
});
