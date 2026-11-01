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
const lta = require("../src/sources/lta");
const manual = require("../src/sources/manual");
const ev = require("../src/sources/ev");
const { encodeSnapshot } = require("../src/history");

const DATA = path.join(__dirname, "..", "data");
const HISTORY = path.join(DATA, "history");

// Registering a source here is all it should ever take to add one.
const SOURCES = [hdb, ura, lta, manual];

function sgDateStamp(d) {
  // Files are named by SINGAPORE date, not UTC: a run at 08:00 SGT belongs to
  // today, not to yesterday's UTC file.
  const sg = new Date(d.getTime() + 8 * 3600 * 1000);
  return sg.toISOString().slice(0, 10);
}

// The malls' latest lot counts, for the page.
//
// The page reads HDB's counts straight from data.gov.sg, but LTA DataMall
// needs an AccountKey, and a static page cannot hold one. So the collector
// that already holds the key writes the one reading the page needs into a
// small file, and the page reads it from raw.githubusercontent.com, which
// serves the repo's main branch with CORS open. It is overwritten every tick:
// it is a "now", not history (history is the .jsonl beside it).
//
// Written only when LTA answered. A failed tick leaves the last file in place
// with its own timestamp, and the page judges the age, so a stale count is
// shown as old or not at all - never as fresh.
const MALL_LIVE = path.join(DATA, "live-lta.json");

// ONE writer for the live files, and it is the server. On 1 Nov 2026 the
// daily publish workflow (which stages all of data/) committed its own
// live-lta.json, and every server push after it died on a rebase conflict in
// that file until someone looked. So inside GitHub Actions they are not
// written at all.
const LIVE_ELSEWHERE = !!process.env.GITHUB_ACTIONS;

function writeMallLive(now, records) {
  const lots = {};
  for (const r of records) {
    const car = (r.lots || []).find((l) => l.type === "C");
    if (!car) continue;
    lots[r.id] = car.available;   // null stays null: unknown, never "full"
  }
  if (!Object.keys(lots).length) return;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(MALL_LIVE, JSON.stringify({ at: now.toISOString(), lots }) + "\n");
}

// EV chargers, for the page, the same way and for the same reason as the mall
// counts above: the feed needs the LTA key. Best effort and separate from the
// snapshot - a charger feed having a bad day must never cost a tick of lot
// history - and a run that returns implausibly few sites keeps the last file.
const EV_LIVE = path.join(DATA, "live-ev.json");

async function writeEvLive(now) {
  const carparksFile = path.join(DATA, "carparks.json");
  const carparks = fs.existsSync(carparksFile)
    ? JSON.parse(fs.readFileSync(carparksFile, "utf8")).carparks || [] : [];
  const data = ev.compact(await ev.fetchBatch(), carparks);
  if (data.sites.length < ev.MIN_SITES) {
    throw new Error("only " + data.sites.length + " charger sites; keeping the last file");
  }
  fs.writeFileSync(EV_LIVE, ev.serialise(now, data));
  return data.sites.length;
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
    if (source.SOURCE === lta.SOURCE && !LIVE_ELSEWHERE) writeMallLive(now, records);
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
  if (!LIVE_ELSEWHERE) try {
    console.log("ev charger sites:", await writeEvLive(now));
  } catch (e) {
    console.error("ev chargers failed:", e.message);
  }
})();
