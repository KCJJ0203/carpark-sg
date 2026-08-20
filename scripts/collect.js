// One collection run. Designed to be safe to run every few minutes forever.
//
//   node scripts/collect.js            append one availability snapshot
//   node scripts/collect.js --carparks also rebuild the static carpark list
//
// History is APPEND-ONLY, one JSON object per line, one file per day. A failed
// or half-finished run can add a bad line but can never corrupt what came
// before - which matters because history is the one thing we cannot re-collect.
// Every day we do not run this is a day of history that is gone for good.

const fs = require("fs");
const path = require("path");
const hdb = require("../src/sources/hdb");
const { encodeSnapshot } = require("../src/history");

const DATA = path.join(__dirname, "..", "data");
const HISTORY = path.join(DATA, "history");

// Registering a source here is all it should ever take to add URA or LTA.
const SOURCES = [hdb];

function sgDateStamp(d) {
  // Files are named by SINGAPORE date, not UTC: a run at 08:00 SGT belongs to
  // today, not to yesterday's UTC file.
  const sg = new Date(d.getTime() + 8 * 3600 * 1000);
  return sg.toISOString().slice(0, 10);
}

async function collectAvailability(now) {
  fs.mkdirSync(HISTORY, { recursive: true });
  const stamp = sgDateStamp(now);
  const file = path.join(HISTORY, stamp + ".jsonl");

  let written = 0;
  let stale = 0;
  const lines = [];

  for (const source of SOURCES) {
    let records;
    try {
      records = await source.fetchAvailability();
    } catch (e) {
      // One failing source must never lose the others' data for this tick.
      console.error("source " + source.SOURCE + " failed:", e.message);
      continue;
    }
    stale += records.filter((r) => {
      if (!r.at) return false;
      return (now.getTime() - new Date(r.at + "+08:00").getTime()) / 60000 > 15;
    }).length;

    const line = encodeSnapshot(now, records);
    if (line) {
      lines.push(line);
      written += records.filter((r) => r.lots.some((l) => l.total !== null)).length;
    }
  }

  if (lines.length) fs.appendFileSync(file, lines.join("\n") + "\n");
  return { file, written, stale };
}

async function rebuildCarparks() {
  fs.mkdirSync(DATA, { recursive: true });
  const all = [];
  let dropped = 0;
  for (const source of SOURCES) {
    const r = await source.fetchCarparks();
    all.push(...r.carparks);
    dropped += r.dropped;
  }
  const out = path.join(DATA, "carparks.json");
  fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), carparks: all }, null, 0) + "\n");
  return { out, count: all.length, dropped };
}

(async () => {
  const now = new Date();
  if (process.argv.includes("--carparks")) {
    const r = await rebuildCarparks();
    console.log("carparks written:", r.count, r.dropped ? "(dropped " + r.dropped + " with unusable coordinates)" : "");
  }
  const a = await collectAvailability(now);
  console.log("availability rows:", a.written, "->", path.basename(a.file), a.stale ? "(" + a.stale + " stale >15min)" : "");
})();
