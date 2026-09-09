const test = require("node:test");
const assert = require("node:assert");
const { encodeSnapshot, decodeSnapshot } = require("../src/history");

const RECORDS = [
  { id: "hdb:HE12", source: "hdb", at: "2026-08-20T21:34:25", lots: [{ type: "C", total: 105, available: 31 }] },
  { id: "hdb:ACB", source: "hdb", at: "2026-08-20T21:20:00", lots: [
    { type: "C", total: 200, available: 5 }, { type: "Y", total: 20, available: 20 }] },
];
const NOW = new Date("2026-08-20T21:35:00+08:00");

test("round-trips a snapshot without losing anything", () => {
  const back = decodeSnapshot(JSON.parse(encodeSnapshot(NOW, RECORDS)));
  assert.strictEqual(back.length, 3, "one row per carpark per lot type");
  const he12 = back.find((r) => r.id === "hdb:HE12");
  assert.strictEqual(he12.total, 105);
  assert.strictEqual(he12.available, 31);
  assert.strictEqual(he12.type, "C");
});

test("keeps every lot type separately", () => {
  const back = decodeSnapshot(JSON.parse(encodeSnapshot(NOW, RECORDS)));
  const acb = back.filter((r) => r.id === "hdb:ACB");
  assert.deepStrictEqual(acb.map((r) => r.type).sort(), ["C", "Y"]);
});

// Storage was 300KB per snapshot as one JSON object per carpark. At a snapshot
// every 30 minutes that is 420MB a month for data we will mostly aggregate.
test("is dramatically smaller than one object per carpark", () => {
  const verbose = RECORDS.map((r) => JSON.stringify({ t: NOW.toISOString(), ...r })).join("\n");
  const compact = encodeSnapshot(NOW, RECORDS);
  assert.ok(compact.length < verbose.length * 0.6, `compact ${compact.length} vs verbose ${verbose.length}`);
});

// The age of each reading is what tells the UI whether to trust a number, so it
// survives compaction - stored as minutes from the snapshot time rather than as
// a repeated ISO string.
test("preserves how stale each reading was", () => {
  const back = decodeSnapshot(JSON.parse(encodeSnapshot(NOW, RECORDS)));
  assert.strictEqual(back.find((r) => r.id === "hdb:HE12").ageMinutes, 1);
  assert.strictEqual(back.find((r) => r.id === "hdb:ACB").ageMinutes, 15);
});

test("skips carparks reporting no usable totals", () => {
  const s = encodeSnapshot(NOW, [{ id: "hdb:X", source: "hdb", at: null, lots: [{ type: "C", total: null, available: null }] }]);
  assert.strictEqual(s, null, "nothing worth writing");
});

// URA reports how many lots are free and never how many exist. Dropping those
// readings would throw away the only record we will ever have of that moment.
test("keeps a reading that has a count but no total", () => {
  const line = encodeSnapshot(new Date("2026-09-09T02:00:00Z"), [
    { id: "ura:S0049", source: "ura", at: null, lots: [{ type: "C", total: null, available: 95 }] },
  ]);
  assert.deepStrictEqual(JSON.parse(line).r, [["ura:S0049", "C", null, 95, null]]);
});

test("still drops a reading that says nothing at all", () => {
  const line = encodeSnapshot(new Date("2026-09-09T02:00:00Z"), [
    { id: "hdb:ACB", source: "hdb", at: null, lots: [{ type: "C", total: null, available: null }] },
  ]);
  assert.strictEqual(line, null);
});

// A total-less reading cannot become "40% free", so the predictions must keep
// ignoring it rather than inventing a denominator.
test("a total-less reading teaches the predictions nothing", () => {
  const { accumulate } = require("../src/patterns");
  const acc = accumulate([{ t: "2026-08-19T01:00:00Z", r: [["ura:S0049", "C", null, 95, null]] }], () => false);
  assert.strictEqual(acc["ura:S0049"], undefined);
});
