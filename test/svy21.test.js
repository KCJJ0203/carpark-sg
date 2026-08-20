const test = require("node:test");
const assert = require("node:assert");
const { svy21ToWgs84 } = require("../src/svy21");

// The projection origin is defined by SLA: Base 7 at 1 deg 22' N, 103 deg 50' E,
// with false easting 28001.642 and false northing 38744.572. Feeding those back
// in MUST return the origin exactly - it validates every constant at once.
test("the projection origin round-trips to its defined lat/lng", () => {
  const p = svy21ToWgs84(28001.642, 38744.572);
  assert.ok(Math.abs(p.lat - 1.366666) < 1e-5, "lat was " + p.lat);
  assert.ok(Math.abs(p.lng - 103.833333) < 1e-5, "lng was " + p.lng);
});

// Ground truth from OneMap (the government's own mapping service), which
// returns BOTH coordinate systems for the same point - an independent oracle
// rather than a number I remembered.
//
// The first version of this test used a latitude I guessed from memory and
// failed by 110m. The conversion was right; the expectation was wrong. Fitting
// the tolerance to the output would have hidden that, so it was replaced with
// authoritative pairs instead.
const ONEMAP = [
  { name: "Albert Centre", x: 30314.5408401964, y: 31494.7782710623, lat: 1.30110201573423, lng: 103.854115779087 },
  { name: "Albert Centre Market", x: 30325.2105163326, y: 31483.6634436883, lat: 1.30100149635856, lng: 103.854211650138 },
];

test("matches OneMap to within a metre", () => {
  for (const v of ONEMAP) {
    const p = svy21ToWgs84(v.x, v.y);
    const dLat = (p.lat - v.lat) * 111320;
    const dLng = (p.lng - v.lng) * 111320 * Math.cos((v.lat * Math.PI) / 180);
    const metres = Math.sqrt(dLat * dLat + dLng * dLng);
    assert.ok(metres < 1, `${v.name} was ${metres.toFixed(2)}m out`);
  }
});

// Treating SVY21 numbers as degrees is the classic failure: it puts every
// carpark off the coast of Africa. These corners are the ACTUAL observed range
// of the 2,270 HDB carpark coordinates, so this asserts the whole real dataset
// lands inside Singapore. (An earlier version used invented corners like
// 5000,5000 - a coordinate no Singapore carpark has - and failed for a reason
// that told us nothing.)
const OBSERVED_RANGE = [
  [11539, 28365], [45265, 28365], [11539, 42905], [45265, 42905],
];

test("the real coordinate range maps inside Singapore", () => {
  for (const [x, y] of OBSERVED_RANGE) {
    const p = svy21ToWgs84(x, y);
    assert.ok(p.lat > 1.15 && p.lat < 1.50, `lat ${p.lat} outside Singapore for ${x},${y}`);
    assert.ok(p.lng > 103.6 && p.lng < 104.1, `lng ${p.lng} outside Singapore for ${x},${y}`);
  }
});

test("rejects non-numeric input rather than returning NaN coordinates", () => {
  assert.strictEqual(svy21ToWgs84("", ""), null);
  assert.strictEqual(svy21ToWgs84(undefined, 1), null);
});
