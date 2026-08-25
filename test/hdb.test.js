const test = require("node:test");
const assert = require("node:assert");
const { toCarpark, toAvailability } = require("../src/sources/hdb");

const RAW = {
  car_park_no: "ACB", address: "BLK 270/271 ALBERT CENTRE BASEMENT CAR PARK",
  x_coord: "30314.7936", y_coord: "31490.4942", car_park_type: "BASEMENT CAR PARK",
  type_of_parking_system: "ELECTRONIC PARKING", short_term_parking: "WHOLE DAY",
  free_parking: "NO", car_park_decks: "1", gantry_height: "1.8", car_park_basement: "Y",
};

test("maps a raw record to the common shape", () => {
  const c = toCarpark(RAW);
  assert.strictEqual(c.id, "hdb:ACB");
  assert.strictEqual(c.source, "hdb");
  assert.strictEqual(c.address, RAW.address);
});

// IDs are namespaced so a future URA or LTA carpark can never collide with an
// HDB one, and so the UI can say where a number came from.
test("namespaces the id by source", () => {
  assert.match(toCarpark(RAW).id, /^hdb:/);
});

test("converts coordinates to lat/lng", () => {
  const c = toCarpark(RAW);
  assert.ok(Math.abs(c.lat - 1.3011) < 0.001, "lat was " + c.lat);
  assert.ok(Math.abs(c.lng - 103.8541) < 0.001, "lng was " + c.lng);
});

// Gantry height decides whether a van or a car with a roof box fits at all.
test("keeps gantry height as a number", () => {
  assert.strictEqual(toCarpark(RAW).gantryHeight, 1.8);
});

test("a missing gantry height is null, never zero", () => {
  const c = toCarpark(Object.assign({}, RAW, { gantry_height: "0" }));
  assert.strictEqual(c.gantryHeight, null, "0.0 means unknown here, not a 0m gantry");
});

test("parses the parking windows", () => {
  const c = toCarpark(Object.assign({}, RAW, { free_parking: "SUN & PH FR 7AM-10.30PM" }));
  assert.strictEqual(c.freeParking.length, 1);
  assert.deepStrictEqual(c.freeParking[0].days, ["SUN", "PH"]);
});

// A carpark we cannot place on a map is useless and must not be silently
// given a default position.
// Night parking is a yes/no in the data and a scheme in the world: it decides
// both whether an overnight stay is permitted and whether it is capped at $5.
test("reads the night parking scheme flag", () => {
  assert.strictEqual(toCarpark(Object.assign({}, RAW, { night_parking: "YES" })).nightParking, true);
  assert.strictEqual(toCarpark(Object.assign({}, RAW, { night_parking: "NO" })).nightParking, false);
});

test("a missing night parking flag is treated as no scheme", () => {
  assert.strictEqual(toCarpark(RAW).nightParking, false);
});

test("returns null when coordinates cannot be converted", () => {
  assert.strictEqual(toCarpark(Object.assign({}, RAW, { x_coord: "", y_coord: "" })), null);
});

const LIVE = {
  carpark_number: "ACB",
  update_datetime: "2026-08-19T01:40:42",
  carpark_info: [{ total_lots: "105", lot_type: "C", lots_available: "31" }],
};

test("maps live availability to the common shape", () => {
  const a = toAvailability(LIVE);
  assert.strictEqual(a.id, "hdb:ACB");
  assert.deepStrictEqual(a.lots, [{ type: "C", total: 105, available: 31 }]);
});

// total_lots of 0 appears in the feed. It means "not reported", and showing it
// as a full carpark would send people away from somewhere with space.
test("total_lots of 0 is unknown, not full", () => {
  const a = toAvailability(Object.assign({}, LIVE, {
    carpark_info: [{ total_lots: "0", lot_type: "C", lots_available: "0" }],
  }));
  assert.strictEqual(a.lots[0].total, null);
  assert.strictEqual(a.lots[0].available, null);
});

test("keeps every lot type, not just cars", () => {
  const a = toAvailability(Object.assign({}, LIVE, {
    carpark_info: [
      { total_lots: "105", lot_type: "C", lots_available: "31" },
      { total_lots: "20", lot_type: "Y", lots_available: "5" },
    ],
  }));
  assert.strictEqual(a.lots.length, 2);
  assert.strictEqual(a.lots[1].type, "Y");
});
