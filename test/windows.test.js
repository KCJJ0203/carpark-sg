const test = require("node:test");
const assert = require("node:assert");
const { parseWindow, isFreeAt } = require("../src/windows");

// The dataset writes these as prose. Getting them wrong means telling someone
// parking is free when it is not, which costs them money - the single most
// damaging thing this app can do.
test("parses a Sunday and public-holiday free window", () => {
  assert.deepStrictEqual(parseWindow("SUN & PH FR 7AM-10.30PM"), [
    { days: ["SUN", "PH"], from: 420, to: 1350 },
  ]);
});

test("parses the afternoon variant", () => {
  assert.deepStrictEqual(parseWindow("SUN & PH FR 1PM-10.30PM"), [
    { days: ["SUN", "PH"], from: 780, to: 1350 },
  ]);
});

test("NO means never, not always", () => {
  assert.deepStrictEqual(parseWindow("NO"), []);
});

test("WHOLE DAY covers every day, all day", () => {
  assert.deepStrictEqual(parseWindow("WHOLE DAY"), [
    { days: ["ALL"], from: 0, to: 1440 },
  ]);
});

test("parses a plain daily window", () => {
  assert.deepStrictEqual(parseWindow("7AM-7PM"), [{ days: ["ALL"], from: 420, to: 1140 }]);
});

test("parses a half-hour end time", () => {
  assert.deepStrictEqual(parseWindow("7AM-10.30PM"), [{ days: ["ALL"], from: 420, to: 1350 }]);
});

// Unknown wording must not be guessed at. Returning [] means "not free", which
// is the safe direction: the user pays when they expected to, rather than
// getting a fine.
test("returns nothing for wording it does not understand", () => {
  assert.deepStrictEqual(parseWindow("MON-FRI EXCEPT ALTERNATE TUESDAYS"), []);
  assert.deepStrictEqual(parseWindow(""), []);
  assert.deepStrictEqual(parseWindow(null), []);
});

// 12AM/12PM are the classic off-by-twelve-hours bug.
test("handles noon and midnight correctly", () => {
  assert.deepStrictEqual(parseWindow("12AM-12PM"), [{ days: ["ALL"], from: 0, to: 720 }]);
});

const SUN_9AM = new Date("2026-08-23T09:00:00+08:00"); // a Sunday
const WED_9AM = new Date("2026-08-19T09:00:00+08:00"); // a Wednesday

test("free on Sunday morning inside the window", () => {
  const w = parseWindow("SUN & PH FR 7AM-10.30PM");
  assert.strictEqual(isFreeAt(w, SUN_9AM, false), true);
});

test("NOT free on a weekday, same time", () => {
  const w = parseWindow("SUN & PH FR 7AM-10.30PM");
  assert.strictEqual(isFreeAt(w, WED_9AM, false), false);
});

// A public holiday falling on a weekday is exactly the case a naive
// day-of-week check gets wrong.
test("free on a weekday that is a public holiday", () => {
  const w = parseWindow("SUN & PH FR 7AM-10.30PM");
  assert.strictEqual(isFreeAt(w, WED_9AM, true), true);
});

test("not free before the window opens", () => {
  const w = parseWindow("SUN & PH FR 1PM-10.30PM");
  assert.strictEqual(isFreeAt(w, SUN_9AM, false), false);
});

test("no windows means never free", () => {
  assert.strictEqual(isFreeAt([], SUN_9AM, true), false);
});
