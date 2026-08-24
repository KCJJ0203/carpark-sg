// Reads every history file and writes the "usually this full" patterns the page
// downloads. Runs offline against data we already hold - no network.
//
//   node scripts/build-patterns.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { accumulate, encode, typical, BUCKETS, MIN_SAMPLES } = require("../src/patterns");
const { decodeSnapshot } = require("../src/history");

const HISTORY = path.join(__dirname, "..", "data", "history");
const WEB = path.join(__dirname, "..", "web");
const HOLIDAYS = path.join(WEB, "holidays.json");

function readSnapshots() {
  if (!fs.existsSync(HISTORY)) return [];
  const out = [];
  for (const name of fs.readdirSync(HISTORY).sort()) {
    const file = path.join(HISTORY, name);
    let text;
    // Finished days are gzipped by the collector to keep the repo from growing
    // by a gigabyte a year.
    if (name.endsWith(".gz")) text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    else if (name.endsWith(".jsonl")) text = fs.readFileSync(file, "utf8");
    else continue;

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* a torn final line, skip it */ }
    }
  }
  return out;
}

function main() {
  const snapshots = readSnapshots();
  const holidays = fs.existsSync(HOLIDAYS) ? new Set(JSON.parse(fs.readFileSync(HOLIDAYS, "utf8"))) : new Set();
  const acc = accumulate(snapshots, (iso) => holidays.has(iso));

  const data = {};
  let published = 0;
  let carparksWithAny = 0;
  for (const [id, buckets] of Object.entries(acc)) {
    const s = encode(buckets);
    const known = [...s].filter((c) => c !== "-").length;
    if (!known) continue;
    data[id] = s;
    published += known;
    carparksWithAny++;
  }

  fs.mkdirSync(WEB, { recursive: true });
  fs.writeFileSync(path.join(WEB, "patterns.json"),
    JSON.stringify({ built: new Date().toISOString(), buckets: BUCKETS, minSamples: MIN_SAMPLES, data }));

  const totalPossible = Object.keys(acc).length * BUCKETS;
  console.log("snapshots read        :", snapshots.length);
  console.log("carparks seen         :", Object.keys(acc).length);
  console.log("carparks with a pattern:", carparksWithAny);
  console.log("buckets published     :", published, "of", totalPossible,
    "(" + (totalPossible ? (published / totalPossible * 100).toFixed(1) : "0") + "%)");
  if (published === 0) {
    console.log("\nNothing publishable yet. Each bucket needs " + MIN_SAMPLES +
      " readings at the same hour and day type, so this stays empty for the first couple of weeks.");
  }
}

main();
