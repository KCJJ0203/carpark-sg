const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ura = require("../src/sources/ura");
const { isFreeAt, matchesWindow } = require("../src/windows");

// Verbatim rows from the live services, not hand-written lookalikes. Three
// carparks chosen because between them they carry every trait the adapter has
// to get right: an off-street lot with a whole-night flat price, a coupon
// street with windows URA publishes no rate for, and a coupon street that is
// explicitly free overnight.
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8"));
const DETAILS = read("ura-car-park-details.sample.json");
const AVAILABILITY = read("ura-car-park-availability.sample.json");

const rowsFor = (code) => DETAILS.filter((r) => r.ppCode === code);
const build = (code) => ura.toCarpark(rowsFor(code));

test("maps a URA carpark into the common shape", () => {
  const c = build("A0007");
  assert.strictEqual(c.id, "ura:A0007", "IDs are namespaced so sources cannot collide");
  assert.strictEqual(c.source, "ura");
  assert.strictEqual(c.name, "ANGULLIA PARK OFF ST");
  assert.strictEqual(c.parkingSystem, "ELECTRONIC PARKING");
  assert.strictEqual(c.capacity, 268);
  assert.ok(c.rates.length, "carries URA's own rate table");
});

// URA publishes SVY21 metres, the same trap as HDB: read as degrees they place
// every carpark off the coast of West Africa.
test("converts SVY21 to coordinates that are actually in Singapore", () => {
  for (const code of ["A0007", "A0028", "A0004"]) {
    const c = build(code);
    assert.ok(c.lat > 1.15 && c.lat < 1.48, code + " latitude " + c.lat);
    assert.ok(c.lng > 103.6 && c.lng < 104.1, code + " longitude " + c.lng);
  }
});

// KC asked to be able to tell a multi-storey from a row of parallel bays. URA's
// naming is the only signal for it, and it is a clean one: 88 of the 658 car
// carparks end in "OFF ST" and none of the rest do.
test("tells off-street lots from on-street bays", () => {
  assert.strictEqual(build("A0007").type, "OFF-STREET CAR PARK");
  assert.strictEqual(build("A0028").type, "ON-STREET PARKING");
  assert.strictEqual(ura.isOffStreet("ANGULLIA PARK OFF ST"), true);
  assert.strictEqual(ura.isOffStreet("ALIWAL ST"), false, "a road named St is not off-street");
});

test("normalises URA's parking-system letters to the project's wording", () => {
  assert.strictEqual(build("A0004").parkingSystem, "COUPON PARKING");
  assert.strictEqual(build("A0007").parkingSystem, "ELECTRONIC PARKING");
});

// The Night Parking Scheme is an HDB scheme. Reporting false would read as
// "you may not park here overnight", which is a different claim from "this
// scheme does not apply to this carpark".
test("does not claim an HDB scheme applies to URA carparks", () => {
  assert.strictEqual(build("A0007").nightParking, null);
  assert.strictEqual(build("A0007").gantryHeight, null, "URA publishes no gantry heights");
});

test("drops a carpark it cannot place on a map rather than guessing a position", () => {
  const rows = rowsFor("A0007").map((r) => ({ ...r, geometries: [] }));
  assert.strictEqual(ura.toCarpark(rows), null);
});

test("ignores carparks with no car lots", () => {
  assert.strictEqual(ura.toCarpark(rowsFor("A0007").filter((r) => r.vehCat !== "Car")), null);
});

// URA's free hours are "$0.00 / 0 mins" rows inside the rate table. Restating
// them as parsed windows is what lets the existing "free right now" display
// work for URA without knowing anything about URA.
test("re-expresses free hours as windows the rest of the app understands", async (t) => {
  const aliwal = build("A0004");

  await t.test("a window that wraps past midnight becomes two", () => {
    // src/windows.js deliberately has no wrapping window, so 10pm-7am has to
    // be stored as 10pm-midnight and midnight-7am.
    const night = aliwal.freeParking.filter((w) => w.from === 1320 || w.to === 420);
    assert.strictEqual(night.length, 2);
    assert.deepStrictEqual(night.map((w) => [w.from, w.to]).sort((a, b) => a[0] - b[0]),
      [[0, 420], [1320, 1440]]);
  });

  await t.test("free overnight, chargeable in the afternoon", () => {
    assert.strictEqual(isFreeAt(aliwal.freeParking, new Date("2026-08-19T23:00:00+08:00"), false), true);
    assert.strictEqual(isFreeAt(aliwal.freeParking, new Date("2026-08-19T06:00:00+08:00"), false), true);
    assert.strictEqual(isFreeAt(aliwal.freeParking, new Date("2026-08-19T14:00:00+08:00"), false), false);
  });

  await t.test("a Sunday-only free window is not free on a Wednesday", () => {
    // Aljunied Rd (MINOR) charges $0.60 on weekdays 08.30-17.00 and nothing at
    // all on Sundays, so the day set has to survive the translation.
    const aljunied = build("A0028");
    assert.strictEqual(isFreeAt(aljunied.freeParking, new Date("2026-08-23T09:00:00+08:00"), false), true);
    assert.strictEqual(isFreeAt(aljunied.freeParking, new Date("2026-08-19T09:00:00+08:00"), false), false);
  });

  await t.test("a public holiday gets the Sunday treatment", () => {
    const aljunied = build("A0028");
    assert.strictEqual(isFreeAt(aljunied.freeParking, new Date("2026-08-19T09:00:00+08:00"), true), true);
  });
});

// A window URA publishes no rate for may mean free and may equally mean no
// parking. Listing it as short-term parkable would be the guess that costs the
// driver a fine, so it is left out of the hours entirely.
test("hours exclude the windows URA publishes no rate for", () => {
  const aljunied = build("A0028");
  const parkable = (iso) => matchesWindow(aljunied.shortTermParking,
    ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(iso).getUTCDay()],
    new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes(), false);
  // 07.00-08.30 and 22.00-07.00 carry no rate at all for this street.
  assert.strictEqual(parkable("2026-08-19T07:30:00Z"), false, "07:30 has no published rate");
  assert.strictEqual(parkable("2026-08-19T09:30:00Z"), true, "09:30 is $0.60 per half hour");
  assert.strictEqual(parkable("2026-08-19T18:00:00Z"), true, "18:00 is explicitly free");
});

test("maps live availability, and does not invent a total", () => {
  const rows = AVAILABILITY.filter((r) => r.carparkNo === "S0049");
  const a = ura.toAvailability(rows, "2026-09-09T10:00:00.000Z");
  assert.strictEqual(a.id, "ura:S0049");
  assert.strictEqual(a.source, "ura");
  assert.deepStrictEqual(a.lots, [{ type: "C", total: null, available: 95 }]);
});

// URA calls motorcycle lots "M" and the rest of this project calls them "Y".
// One vocabulary is worth more than fidelity to either source's spelling.
test("translates URA's lot-type letters", () => {
  const a = ura.toAvailability(AVAILABILITY.filter((r) => r.carparkNo === "J0122"), "t");
  assert.strictEqual(a.lots[0].type, "Y");
});

test("a reported zero is zero lots free, not a missing reading", () => {
  const a = ura.toAvailability(AVAILABILITY.filter((r) => r.carparkNo === "P0113"), "t");
  assert.strictEqual(a.lots[0].available, 0);
});
