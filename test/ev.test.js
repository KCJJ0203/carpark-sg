const test = require("node:test");
const assert = require("node:assert");
const ev = require("../src/sources/ev");

// Shaped exactly like the EVCBatch file (note LTA's "longtitude" spelling).
const batch = {
  LastUpdatedTime: "2026-11-01 23:45:00",
  evLocationsData: [
    {
      name: "CLARKE QUAY", address: "3E RIVER VALLEY ROAD SINGAPORE 179024",
      latitude: 1.290314, longtitude: 103.846728,
      chargingPoints: [
        { status: "1", operator: "SP MOBILITY PTE. LTD.", position: "L4 49", plugTypes: [
          { plugType: "Type 2", current: "AC", powerRating: "22", price: "0.8066", priceType: "kWh",
            evIds: [{ evCpId: "A-001", status: "1" }] }] },
        { status: "0", operator: "SP MOBILITY PTE. LTD.", position: "L4 50", plugTypes: [
          { plugType: "Type 2", current: "AC", powerRating: "22", price: "0.8066", priceType: "kWh",
            evIds: [{ evCpId: "B-001", status: "0" }] }] },
        { status: "1", operator: "SP MOBILITY PTE. LTD.", position: "B2 51 & 52", plugTypes: [
          { plugType: "Combo 2", current: "DC", powerRating: "50", price: "0.8938", priceType: "kWh",
            evIds: [{ evCpId: "C-001", status: "1" }, { evCpId: "C-002", status: "" }] }] },
      ],
    },
    {
      name: "SHELL SOMEWHERE", address: "1 ROAD SINGAPORE 123456",
      latitude: 1.35, longtitude: 103.9,
      chargingPoints: [{ status: "100", operator: "SHELL SINGAPORE PTE. LTD.", position: "", plugTypes: [
        { plugType: "Combo 2", current: "DC", powerRating: "180", price: "", priceType: "",
          evIds: [{ evCpId: "D-001", status: "" }] }] }],
    },
    // Outside Singapore: a bad coordinate must not put a pin in the sea.
    { name: "NOWHERE", latitude: 0, longtitude: 0, chargingPoints: [] },
  ],
};

const carparks = [
  { id: "lta:59", name: "Clarke Quay", lat: 1.29035, lng: 103.84670 },
  { id: "hdb:X", name: "BLK 1 SOMEWHERE", lat: 1.3504, lng: 103.9030 },   // ~330 m away
];

test("groups chargers by kind and counts free, busy and out of service", () => {
  const d = ev.compact(batch, carparks);
  assert.strictEqual(d.sites.length, 2);
  const [id, name, , , groups] = d.sites[0];
  assert.strictEqual(id, "lta:59");
  assert.strictEqual(name, "CLARKE QUAY");
  // DC first, because a fast charger is the reason to drive somewhere.
  assert.deepStrictEqual(groups[0], ["Combo 2", 50, 1, 0.8938, "kWh", 2, 1, 1, "SP Mobility", "B2"]);
  assert.deepStrictEqual(groups[1], ["Type 2", 22, 0, 0.8066, "kWh", 2, 1, 0, "SP Mobility", "L4"]);
});

test("a charger site far from any carpark stays unattached, with no made-up price", () => {
  const d = ev.compact(batch, carparks);
  const shell = d.sites[1];
  assert.strictEqual(shell[0], null);
  assert.strictEqual(shell[4][0][3], null);
  assert.strictEqual(shell[4][0][7], 1);
  assert.strictEqual(shell[4][0][8], "Shell Recharge");
});

test("the batch time is Singapore time", () => {
  assert.strictEqual(ev.batchTime("2026-11-01 23:45:00"), "2026-11-01T15:45:00.000Z");
  assert.strictEqual(ev.batchTime("garbage"), null);
});

test("matches by block number only within 150 m", () => {
  const near = ev.indexCarparks([{ id: "hdb:A", name: "BLK 128A PLANTATION CRESCENT", lat: 1.35, lng: 103.7 }]);
  // ~90 m apart: too far on distance alone, close enough with a shared block.
  assert.strictEqual(ev.matchCarpark({ lat: 1.3508, lng: 103.7, name: "BLK 128A TENGAH" }, near), "hdb:A");
  assert.strictEqual(ev.matchCarpark({ lat: 1.3508, lng: 103.7, name: "SOME CONDO" }, near), null);
});

test("operator and level names read the way a driver says them", () => {
  assert.strictEqual(ev.operatorName("TESLA MOTORS SINGAPORE PRIVATE LIMITED"), "Tesla Motors Singapore");
  assert.strictEqual(ev.operatorName("CHARGE+ PTE. LTD."), "Charge+");
  assert.strictEqual(ev.levelOf("L01 3"), "L1");
  assert.strictEqual(ev.levelOf("lot 5"), null);
});

test("serialises one site per line", () => {
  const s = ev.serialise(new Date("2026-11-01T16:00:00Z"), ev.compact(batch, carparks));
  const j = JSON.parse(s);
  assert.strictEqual(j.at, "2026-11-01T15:45:00.000Z");
  assert.strictEqual(s.split("\n").length, 2 + j.sites.length + 1);
});
