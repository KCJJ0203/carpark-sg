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
const ura = require("../src/sources/ura");
const { encodeSnapshot } = require("../src/history");

const DATA = path.join(__dirname, "..", "data");
const HISTORY = path.join(DATA, "history");

// Registering a source here is all it should ever take to add URA or LTA.
const SOURCES = [hdb, ura];

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

  let stale = 0;
  // ONE line per snapshot, however many sources it took to fill. A line per
  // source would double the apparent collection rate the moment URA joined,
  // and scripts/coverage.js - the health check that exists precisely because
  // this project has twice believed a lying one - counts lines.
  const all = [];

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
    all.push(...records);
  }

  const line = encodeSnapshot(now, all);
  if (line) fs.appendFileSync(file, line + "\n");
  // Count what was actually stored. Counting carparks with a TOTAL would
  // report zero for URA, which reports free lots and never a total.
  return { file, written: line ? JSON.parse(line).r.length : 0, stale };
}

// A source that fails here must not quietly delete itself from the site.
// URA needs an AccessKey, so a runner without one would otherwise rebuild the
// list as HDB-only and wipe 657 carparks off the map while reporting success -
// the same silent-shrink failure this project has already been bitten by twice.
// So each source replaces only its own records, and a source that could not be
// reached keeps whatever it had last time, loudly.
async function rebuildCarparks() {
  fs.mkdirSync(DATA, { recursive: true });
  const out = path.join(DATA, "carparks.json");

  let previous = [];
  if (fs.existsSync(out)) {
    try { previous = JSON.parse(fs.readFileSync(out, "utf8")).carparks || []; }
    catch (e) { console.error("existing carparks.json unreadable, starting fresh:", e.message); }
  }

  const all = [];
  const failed = [];
  let dropped = 0;
  for (const source of SOURCES) {
    let r;
    try {
      r = await source.fetchCarparks();
    } catch (e) {
      const kept = previous.filter((c) => c.source === source.SOURCE);
      console.error("source " + source.SOURCE + " failed: " + e.message +
        " - keeping " + kept.length + " existing records");
      failed.push(source.SOURCE);
      all.push(...kept);
      continue;
    }
    all.push(...r.carparks);
    dropped += r.dropped;
  }

  fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), carparks: all }, null, 0) + "\n");
  const perSource = SOURCES.map((s) => s.SOURCE + ": " + all.filter((c) => c.source === s.SOURCE).length);
  return { out, count: all.length, dropped, failed, perSource };
}

(async () => {
  const now = new Date();
  if (process.argv.includes("--carparks")) {
    const r = await rebuildCarparks();
    console.log("carparks written:", r.count, r.dropped ? "(dropped " + r.dropped + " with unusable coordinates)" : "");
    // Loud, but not fatal: the previous records are still there, and failing
    // the run would also throw away the availability snapshot below.
    console.log("  " + r.perSource.join(", "));
    if (r.failed.length) console.log("  ! stale sources (kept last known):", r.failed.join(", "));
  }
  const a = await collectAvailability(now);
  console.log("availability rows:", a.written, "->", path.basename(a.file), a.stale ? "(" + a.stale + " stale >15min)" : "");
})();
