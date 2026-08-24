// Turns data/carparks.json into the slim file the page downloads.
//
// The full record set is 813KB, which is a rude thing to send to a phone on
// mobile data before it shows anything. Three things shrink it:
//
//   - Short keys, and `name` dropped because it duplicates `address`.
//   - Coordinates rounded to 5 decimal places, about 1 metre - far finer than
//     the carpark itself, and half the bytes.
//   - Parking windows replaced by an index into a lookup table. The whole
//     dataset uses only 3 distinct free-parking wordings and 4 short-term ones,
//     so storing the parsed windows 2,270 times over is pure waste.

const fs = require("fs");
const path = require("path");
const https = require("https");

const IN = path.join(__dirname, "..", "data", "carparks.json");
const OUT_DIR = path.join(__dirname, "..", "web");
const OUT = path.join(OUT_DIR, "carparks.min.json");

const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Carpark types compress to a single letter; the page expands them again.
const TYPE_CODES = {
  "SURFACE CAR PARK": "S",
  "MULTI-STOREY CAR PARK": "M",
  "BASEMENT CAR PARK": "B",
  "MECHANISED CAR PARK": "E",
  "COVERED CAR PARK": "C",
};

function build() {
  const { carparks } = JSON.parse(fs.readFileSync(IN, "utf8"));

  // One entry per distinct window set, referenced by index.
  const table = [];
  const indexOf = (windows) => {
    const key = JSON.stringify(windows || []);
    let i = table.findIndex((t) => JSON.stringify(t) === key);
    if (i === -1) i = table.push(JSON.parse(key)) - 1;
    return i;
  };

  const c = carparks.map((p) => ({
    i: p.id,
    a: p.address,
    y: round5(p.lat),
    x: round5(p.lng),
    t: TYPE_CODES[p.type] || "?",
    g: p.gantryHeight,
    f: indexOf(p.freeParking),
    s: indexOf(p.shortTermParking),
  }));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { built: new Date().toISOString(), windows: table, types: TYPE_CODES, carparks: c };
  fs.writeFileSync(OUT, JSON.stringify(out));

  const before = fs.statSync(IN).size;
  const after = fs.statSync(OUT).size;
  console.log("carparks       :", c.length);
  console.log("window variants:", table.length, "(instead of", c.length, "copies)");
  console.log("size           :", Math.round(before / 1024) + "KB ->", Math.round(after / 1024) + "KB",
    "(" + Math.round((1 - after / before) * 100) + "% smaller)");
}

// Public holidays change the answer to "is parking free right now?", because
// 1,682 carparks are free on "SUN & PH". They come from MOM via data.gov.sg
// rather than from anybody's memory of the calendar - one dataset covers 2020
// through 2027, so this stays correct without a yearly code change.
const HOLIDAY_RESOURCE = "d_8ef23381f9417e4d4254ee8b4dcdb176";

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function buildHolidays() {
  const j = await getJson(
    "https://data.gov.sg/api/action/datastore_search?resource_id=" + HOLIDAY_RESOURCE + "&limit=500"
  );
  const dates = (j.result.records || []).map((r) => r.date).filter(Boolean).sort();
  fs.writeFileSync(path.join(OUT_DIR, "holidays.json"), JSON.stringify(dates));
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
  console.log("holidays       :", dates.length, "dates covering", years[0], "-", years[years.length - 1]);
}

(async () => {
  build();
  try {
    await buildHolidays();
  } catch (e) {
    // A stale holiday list under-reports free parking, which is the safe
    // direction, so this must never fail the whole build.
    console.error("holiday refresh failed (keeping any existing file):", e.message);
  }
})();
