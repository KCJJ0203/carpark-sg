const test = require("node:test");
const assert = require("node:assert");
const { looksUnreported } = require("../src/quality");

// 36 of 1,999 carparks reported EVERY lot free at midday, including one with
// 2,754 lots. A large carpark that empty is not credible - the sensors are very
// likely offline and reporting the total as the availability.
//
// The threshold is not a guess: the observed sizes were
// 4, 4, 4, 10, 10, then 50, 66, 98 ... 2754. The gap between 10 and 50 is where
// "plausibly empty" stops and "probably broken" starts.
test("flags a large carpark reporting every lot free", () => {
  assert.strictEqual(looksUnreported(882, 882), true);
  assert.strictEqual(looksUnreported(2754, 2754), true);
  assert.strictEqual(looksUnreported(50, 50), true);
});

// A four-lot carpark really can be empty. Crying wolf on those trains people to
// ignore the warning where it matters.
test("does not flag a tiny carpark that really can be empty", () => {
  assert.strictEqual(looksUnreported(4, 4), false);
  assert.strictEqual(looksUnreported(10, 10), false);
});

test("does not flag ordinary partial availability", () => {
  assert.strictEqual(looksUnreported(381, 287), false);
  assert.strictEqual(looksUnreported(100, 1), false);
});

// Genuinely full is a real and useful answer, not a fault.
test("does not flag a full carpark", () => {
  assert.strictEqual(looksUnreported(300, 0), false);
});

test("handles missing data without throwing", () => {
  assert.strictEqual(looksUnreported(null, null), false);
  assert.strictEqual(looksUnreported(0, 0), false);
});
