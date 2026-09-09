const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const lta = require("../src/sources/lta");

// Verbatim rows from the live CarParkAvailabilityv2 feed, not hand-written
// lookalikes. The set is chosen for the traits the adapter has to get right:
// four LTA carparks (a mall, an attraction, a heartland mall), the one URA row
// that carries an empty Location, the two HDB rows with the undocumented
// LotType "S", and a plain HDB and URA row to prove they are filtered out.
const ROWS = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "lta-car-park-availability.sample.json"), "utf8"));

const ltaRows = ROWS.filter(lta.isLta);
const rowsFor = (id) => ROWS.filter((r) => r.CarParkID === id && r.Agency === "LTA");
const build = (id) => lta.toCarpark(rowsFor(id));

test("keeps only the LTA rows", () => {
  // The whole reason this adapter exists in this shape. HDB and URA carparks
  // appear in this feed too, and they are already collected from the sources
  // that own them; passing them through would put two records with the same
  // identity into one snapshot from two feeds that disagree.
  assert.equal(ltaRows.length, 4);
  assert.ok(ROWS.some((r) => r.Agency === "HDB"), "fixture must contain HDB rows to exclude");
  assert.ok(ROWS.some((r) => r.Agency === "URA"), "fixture must contain URA rows to exclude");
  for (const r of ltaRows) assert.equal(r.Agency, "LTA");
});

test("maps an LTA carpark into the common shape", () => {
  const c = build("2");
  assert.equal(c.id, "lta:2");
  assert.equal(c.source, "lta");
  assert.equal(c.name, "Marina Square");
  assert.equal(c.address, "Marina Square");
  assert.ok(Math.abs(c.lat - 1.29115) < 1e-6);
  assert.ok(Math.abs(c.lng - 103.85728) < 1e-6);
  assert.equal(c.type, "OFF-STREET CAR PARK");
});

test("claims nothing the feed does not publish", () => {
  // Every one of these is a field some other source fills in. DataMall does
  // not, and a default here would read as a fact.
  const c = build("23");
  assert.equal(c.rates, null, "LTA publishes no rates");
  assert.equal(c.capacity, null, "LTA publishes lots FREE, never how many exist");
  assert.equal(c.parkingSystem, null);
  assert.equal(c.gantryHeight, null);
  assert.equal(c.decks, null);
  assert.equal(c.nightParking, null, "the Night Parking Scheme is an HDB scheme");
  assert.deepEqual(c.freeParking, [], "no rates means no free-parking hours either");
  assert.deepEqual(c.shortTermParking, []);
});

test("an empty freeParking can never read as free right now", () => {
  const { isFreeAt } = require("../src/windows");
  const c = build("17");
  for (let h = 0; h < 24; h++) {
    const t = new Date("2026-09-09T00:00+08:00");
    t.setHours(h);
    assert.equal(isFreeAt(c.freeParking, t, false), false,
      "no published hours must never be reported as free at " + h + ":00");
  }
});

test("availability reports a count with no denominator", () => {
  const a = lta.toAvailability(rowsFor("63"), "2026-09-09T07:30:00.000Z");
  assert.equal(a.id, "lta:63");
  assert.equal(a.source, "lta");
  assert.equal(a.lots.length, 1);
  assert.equal(a.lots[0].type, "C");
  assert.equal(a.lots[0].available, 379);
  // The important one: no total is published, so there is no fullness to
  // compute and the page must not render an unknown total as a full or empty
  // bar. null, never 0 and never the available count.
  assert.equal(a.lots[0].total, null);
});

test("rejects coordinates it cannot use instead of plotting them at zero", () => {
  assert.equal(lta.toPoint(""), null, "the live feed really does carry an empty Location");
  assert.equal(lta.toPoint("1.30403"), null, "half a coordinate is not a coordinate");
  assert.equal(lta.toPoint("abc def"), null);
  assert.equal(lta.toPoint("0 0"), null, "the Gulf of Guinea is not in Singapore");
  assert.equal(lta.toPoint("51.5074 -0.1278"), null, "neither is London");
  assert.deepEqual(lta.toPoint("1.29115 103.85728"), { lat: 1.29115, lng: 103.85728 });
});

test("drops a carpark it cannot place rather than inventing a position", () => {
  const bad = [{ ...ltaRows[0], Location: "" }];
  assert.equal(lta.toCarpark(bad), null);
  const nameless = [{ ...ltaRows[0], Development: "" }];
  assert.equal(lta.toCarpark(nameless), null);
});

test("passes an undocumented lot type through unchanged", () => {
  // "S" appears on exactly two HDB rows in the live feed and is documented
  // nowhere. Mapping it to a type we recognise would be a guess about what a
  // driver can park there; passing it through says only what the feed said.
  const s = ROWS.filter((r) => r.LotType === "S");
  assert.equal(s.length, 2);
  const a = lta.toAvailability([{ ...s[0], Agency: "LTA", CarParkID: "X1" }], "2026-09-09T00:00:00Z");
  assert.equal(a.lots[0].type, "S");
});

test("translates the lot types it does recognise into this project's vocabulary", () => {
  const at = "2026-09-09T00:00:00Z";
  const one = (lotType) => lta.toAvailability(
    [{ ...ltaRows[0], LotType: lotType }], at).lots[0].type;
  assert.equal(one("C"), "C");
  assert.equal(one("Y"), "Y", "motorcycle");
  assert.equal(one("H"), "H", "heavy vehicle");
});

test("a missing lot count is unknown, not zero", () => {
  const a = lta.toAvailability(
    [{ ...ltaRows[0], AvailableLots: null }], "2026-09-09T00:00:00Z");
  assert.equal(a.lots[0].available, null, "null must not become 0, which reads as full");
});
