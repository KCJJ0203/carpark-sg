// EV chargers, from LTA DataMall's "EV Charging Points Batch" (EVCBatch).
//
// One call returns a link to a single JSON file holding every public charger
// in Singapore and its status; LTA rebuilds it every 5 minutes and the link
// expires after 15. Field meanings are from the DataMall API User Guide
// (v6.11, 30 Oct 2026, sections 2.28-2.29):
//   evIds[].status  "1" available, "0" occupied (charging, reserved, blocked),
//                   ""  not available (out of order, inoperative, unknown...)
//   price           includes GST; priceType is "kWh" or "h" ("free" also seen)
// In the batch file the plug's power in kW is `powerRating` and AC/DC is
// `current`. (The per-postcode API calls them chargingSpeed and powerRating
// instead, so the two are not interchangeable.)
//
// This is not a carpark source: it adds nothing to carparks.json. The
// collector writes what the page needs to data/live-ev.json, attaching each
// charger site to the carpark it sits in where there is one.

const https = require("https");
const lta = require("./lta");

const BATCH = "https://datamall2.mytransport.sg/ltaodataservice/EVCBatch";

// A site this close to a carpark is in it: HDB blocks are tens of metres
// apart, and 60 m caught 1,972 of 2,815 sites on 1 Nov 2026 with no false
// matches in a spot check. Out to 150 m only when the names share a block
// number, because two multi-storey carparks can stand 80 m apart.
const NEAR_M = 60;
const NAMED_M = 150;

// Fewer than this and the feed is having a bad day, not the island losing
// four-fifths of its chargers. The writer keeps the last good file instead.
const MIN_SITES = 1000;

function getText(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("EV batch answered " + res.statusCode));
      }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

async function fetchBatch() {
  const key = lta.accountKey();
  const meta = JSON.parse(await getText(BATCH, { AccountKey: key, accept: "application/json" }));
  const link = meta && meta.value && meta.value[0] && meta.value[0].Link;
  if (!link) throw new Error("EVCBatch returned no download link");
  // The link is a signed S3 URL. It must NOT carry the AccountKey.
  return JSON.parse(await getText(link, {}));
}

function haversine(aLat, aLng, bLat, bLng) {
  const E = 6371000, r = (d) => d * Math.PI / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * E * Math.asin(Math.sqrt(h));
}

const OPERATORS = {
  "SP MOBILITY": "SP Mobility",
  "COMFORTDELGRO ENGIE": "ComfortDelGro ENGIE",
  "SHELL SINGAPORE": "Shell Recharge",
  "CHARGE+": "Charge+",
  "STRIDES YTL": "Strides YTL",
  "VOLT SINGAPORE": "Volt",
  "MNL SOLUTIONS": "MNL Solutions",
  "FASTPARKNCHARGE": "FastParkNCharge",
  "NOVOWATT": "Novowatt",
  "GREAT CHARGE": "Great Charge",
  "EV MOBILITY": "EV Mobility",
  "EIGEN ENERGY": "Eigen Energy",
};

function operatorName(raw) {
  const s = String(raw || "").toUpperCase()
    .replace(/\(S\)/g, "").replace(/\b(PTE\.?|PRIVATE)\s*(LTD\.?|LIMITED)/g, "").replace(/\b(LTD\.?|LIMITED)$/g, "")
    .replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (OPERATORS[s]) return OPERATORS[s];
  // Short words are usually initials (SP, YTL, EV); longer ones get title case.
  return s.split(" ").map((w) => w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()).join(" ");
}

// "L4 49" -> "L4", "B2 10 & 11" -> "B2". Only a leading level is kept; a bare
// lot number tells a driver nothing before they arrive.
function levelOf(position) {
  const m = String(position || "").trim().match(/^(B\d+|L\d+|\d+F|RF|GF|Level \d+)\b/i);
  // "L01" and "L1" are the same floor; say it the short way.
  return m ? m[1].toUpperCase().replace(/^([LB])0+(\d)/, "$1$2").replace(/^LEVEL /, "L") : null;
}

const blockNumbers = (name) =>
  new Set((String(name).toUpperCase().match(/\b\d{1,4}[A-Z]?\b/g) || []));

// A grid of carparks so matching 2,800 sites is not 8 million distance sums.
function indexCarparks(carparks) {
  const cell = (v) => Math.floor(v / 0.002);
  const grid = new Map();
  for (const c of carparks) {
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    const k = cell(c.lat) + ":" + cell(c.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  return (lat, lng) => {
    const out = [];
    const a = cell(lat), b = cell(lng);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const g = grid.get((a + i) + ":" + (b + j));
      if (g) out.push(...g);
    }
    return out;
  };
}

function matchCarpark(site, near) {
  let best = null, bestD = Infinity;
  for (const c of near(site.lat, site.lng)) {
    const d = haversine(site.lat, site.lng, c.lat, c.lng);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best) return null;
  if (bestD <= NEAR_M) return best.id;
  if (bestD <= NAMED_M) {
    const mine = blockNumbers(site.name);
    for (const n of blockNumbers(best.name || "")) if (mine.has(n)) return best.id;
  }
  return null;
}

// "2026-11-01 23:45:00" is Singapore time.
function batchTime(s) {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  return m ? new Date(m[1] + "T" + m[2] + "+08:00").toISOString() : null;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

// One site per row:
//   [carparkId | null, name, lat, lng, groups]
// and one group per kind of charger there:
//   [plug, kW, dc (1|0), price | null, unit, total, free, out, operator, levels]
// "free" counts connectors reporting available, "out" those not available;
// the rest are in use. Grouping keeps the file small and is also how a driver
// reads it: "2 of 4 22 kW Type 2 free" rather than four separate lines.
function compact(batch, carparks) {
  const near = indexCarparks(carparks);
  const sites = [];
  for (const l of (batch && batch.evLocationsData) || []) {
    const lat = Number(l.latitude), lng = Number(l.longtitude !== undefined ? l.longtitude : l.longitude);
    if (!isFinite(lat) || !isFinite(lng) || lat < 1.1 || lat > 1.5 || lng < 103.5 || lng > 104.1) continue;
    const name = String(l.name || "").replace(/\s+/g, " ").trim() ||
      String(l.address || "").replace(/\s+SINGAPORE\s+\d{6}\s*$/i, "").trim();
    const groups = new Map();
    for (const cp of l.chargingPoints || []) {
      const lev = levelOf(cp.position);
      for (const p of cp.plugTypes || []) {
        const kW = Number(p.powerRating) || Number(p.chargingSpeed) || null;
        const dc = /DC/i.test(p.current || p.powerRating || "") ? 1 : 0;
        const unit = String(p.priceType || "");
        const price = unit === "free" ? 0 : (p.price === "" || p.price === undefined ? null : Number(p.price));
        const op = operatorName(cp.operator);
        const key = [p.plugType, kW, dc, price, unit, op].join("|");
        if (!groups.has(key)) groups.set(key, [String(p.plugType || ""), kW, dc,
          isFinite(price) ? price : null, unit, 0, 0, 0, op, new Set()]);
        const g = groups.get(key);
        for (const e of p.evIds || []) {
          g[5]++;
          if (e.status === "1") g[6]++;
          else if (e.status !== "0") g[7]++;
        }
        if (lev) g[9].add(lev);
      }
    }
    const gs = [...groups.values()].filter((g) => g[5] > 0)
      .map((g) => { g[9] = [...g[9]].sort().join(" "); return g; })
      // Fastest first: a DC charger is the reason to drive somewhere.
      .sort((a, b) => b[2] - a[2] || (b[1] || 0) - (a[1] || 0));
    if (!gs.length) continue;
    sites.push([matchCarpark({ lat, lng, name }, near), name, round5(lat), round5(lng), gs]);
  }
  return { at: batchTime(batch && batch.LastUpdatedTime), sites };
}

// One site per line, so a tick that changes three chargers is a three-line
// diff in git rather than a rewrite of one enormous line.
function serialise(now, data) {
  return '{"at":' + JSON.stringify(data.at || now.toISOString()) +
    ',"fetched":' + JSON.stringify(now.toISOString()) + ',"sites":[\n' +
    data.sites.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";
}

module.exports = {
  fetchBatch, compact, serialise, operatorName, levelOf, matchCarpark, indexCarparks,
  batchTime, MIN_SITES,
};
