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
  // Two sites are both at once. Left unmapped these showed as "?", which reads
  // as a data problem rather than as the honest answer that the carpark has
  // both kinds.
  "MECHANISED AND SURFACE CAR PARK": "X",
  "SURFACE/MULTI-STOREY CAR PARK": "U",
  // URA's two, and the distinction a driver actually cares about there: a lot
  // you drive into, versus a row of parallel bays on a public road.
  "ON-STREET PARKING": "T",
  "OFF-STREET CAR PARK": "O",
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

  // URA carparks each carry their own rate table, and 657 of them share just
  // 27 distinct tables between them - so storing the table once and pointing at
  // it turns 331KB into 14KB. Same trick as the windows above, same reason.
  const rateTables = [];
  const rateIndexOf = (rates) => {
    const key = JSON.stringify(rates);
    let i = rateTables.findIndex((t) => JSON.stringify(t) === key);
    if (i === -1) i = rateTables.push(JSON.parse(key)) - 1;
    return i;
  };

  const c = carparks.map((p) => {
    const rec = {
      i: p.id,
      a: p.address,
      y: round5(p.lat),
      x: round5(p.lng),
      t: TYPE_CODES[p.type] || "?",
      g: p.gantryHeight,
      f: indexOf(p.freeParking),
      s: indexOf(p.shortTermParking),
    };
    // Night Parking Scheme: decides whether an overnight stay is allowed at all
    // and whether it is capped at $5. It is an HDB scheme, so it is written
    // only for HDB records - absent means "does not apply here", which is a
    // different claim from "not allowed overnight".
    if (p.nightParking !== null && p.nightParking !== undefined) rec.n = p.nightParking ? 1 : 0;
    // Only 137 of 2,270 HDB carparks take coupons, so the flag is worth 6 bytes
    // on those rather than 6 bytes on every record. Most URA streets do.
    if (/COUPON/i.test(p.parkingSystem || "")) rec.c = 1;
    // A source that publishes its own prices points at them here. Its absence
    // is what tells the page to use HDB's transcribed schedule instead.
    if (p.rates && p.rates.length) rec.r = rateIndexOf(p.rates);
    // How many lots exist. URA publishes it; HDB does not. It is NOT a live
    // count and must never be rendered as one.
    if (p.capacity) rec.k = p.capacity;
    return rec;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    built: new Date().toISOString(), windows: table, rateTables,
    types: TYPE_CODES, carparks: c,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  bundleRates();

  const before = fs.statSync(IN).size;
  const after = fs.statSync(OUT).size;
  const bySource = {};
  for (const p of carparks) bySource[p.source] = (bySource[p.source] || 0) + 1;
  console.log("carparks       :", c.length,
    "(" + Object.entries(bySource).map(([k, v]) => k + " " + v).join(", ") + ")");
  console.log("window variants:", table.length, "(instead of", c.length, "copies)");
  console.log("rate tables    :", rateTables.length, "(instead of",
    c.filter((r) => r.r !== undefined).length, "copies)");
  console.log("size           :", Math.round(before / 1024) + "KB ->", Math.round(after / 1024) + "KB",
    "(" + Math.round((1 - after / before) * 100) + "% smaller)");
}


// The page has to price a stay, and pricing is 200 lines of rate windows, caps
// and boundary crossings. Re-typing that into the HTML - the way the page
// already mirrors looksUnreported and isFreeNow - would put money logic in two
// places and guarantee they drift. So the real modules are bundled verbatim
// instead. The output is committed, so any change to it shows up in a diff.
function bundleRates() {
  const SRC = path.join(__dirname, "..", "src");
  const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

  const wrap = (name, source, requires) => {
    let body = source;
    for (const [spec, ref] of Object.entries(requires || {})) {
      const before = body;
      body = body.split('require("' + spec + '")').join(ref);
      if (body === before) throw new Error("expected " + name + " to require " + spec);
    }
    if (/require\s*\(/.test(body)) throw new Error(name + " still has an unbundled require()");
    return [
      "  var " + name + " = (function () {",
      "    var module = { exports: {} };",
      body.replace(/^(?=.)/gm, "    "),
      "    return module.exports;",
      "  })();",
      "",
    ].join("\n");
  };

  const bundle = [
    "// GENERATED by scripts/build-web.js from src/windows.js, src/rates.js and",
    "// src/ura-rates.js. Do not edit: change the source modules and rebuild.",
    "window.CarparkRates = (function () {",
    wrap("windows", read("windows.js"), {}),
    wrap("rates", read("rates.js"), { "./windows": "windows" }),
    // URA publishes its own prices, so its engine reads them off the carpark
    // record rather than out of a transcribed table. Two engines, one shape.
    wrap("uraRates", read("ura-rates.js"), {}),
    "  return { rates: rates, windows: windows, ura: uraRates };",
    "})();",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "rates.js"), bundle);

  // Fail the build rather than ship a bundle that does not evaluate.
  const sandbox = { window: {} };
  require("vm").runInNewContext(bundle, sandbox);
  const api = sandbox.window.CarparkRates;
  if (typeof api.rates.feeFor !== "function") throw new Error("bundled rates has no feeFor");
  if (typeof api.ura.feeFor !== "function") throw new Error("bundled ura rates has no feeFor");
  const probe = api.rates.feeFor(
    {
      id: "hdb:ACB", parkingSystem: "ELECTRONIC PARKING", nightParking: true,
      shortTermParking: api.windows.parseWindow("WHOLE DAY"),
      freeParking: api.windows.parseWindow("NO"),
    },
    new Date("2026-08-24T14:00+08:00"), 120, () => false
  );
  if (probe.total !== 5.6) throw new Error("bundled rates mispriced the probe: " + probe.total);

  // A whole night at Angullia Park. Seventeen half hours at $0.70 accrues
  // $11.90, but URA sells that night at $5.60 - so this is the check that the
  // bundle still knows the difference, rather than someone discovering a
  // doubled price on their phone.
  const uraProbe = api.ura.feeFor(
    {
      id: "ura:A0007", parkingSystem: "ELECTRONIC PARKING",
      rates: api.ura.parseRateTable([
        { startTime: "10.30 PM", endTime: "07.00 AM", weekdayRate: "$0.70", weekdayMin: "30 mins", satdayRate: "$0.70", satdayMin: "30 mins", sunPHRate: "$0.70", sunPHMin: "30 mins" },
        { startTime: "10.30 PM", endTime: "07.00 AM", weekdayRate: "$5.60", weekdayMin: "510 mins", satdayRate: "$5.60", satdayMin: "510 mins", sunPHRate: "$5.60", sunPHMin: "510 mins" },
        { startTime: "07.00 AM", endTime: "10.30 PM", weekdayRate: "$0.80", weekdayMin: "30 mins", satdayRate: "$0.80", satdayMin: "30 mins", sunPHRate: "$0.80", sunPHMin: "30 mins" },
      ]),
    },
    new Date("2026-08-24T22:30+08:00"), 510, () => false
  );
  if (uraProbe.total !== 5.6) throw new Error("bundled ura rates mispriced the night: " + uraProbe.total);

  console.log("rates bundle   :", Math.round(bundle.length / 1024) + "KB, HDB probe $" +
    probe.total + ", URA night probe $" + uraProbe.total);
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
