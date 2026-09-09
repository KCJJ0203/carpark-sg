// URA carparks, via the URA Data Service. Free AccessKey, registered 9 Sep 2026.
//
// Two services:
//   - Car_Park_Details      756 carparks, 658 of them with car rates
//   - Car_Park_Availability 89 carparks reporting car lots
//
// The gap between those two numbers is the important one, and it is not a bug:
// only URA's gantry carparks report live availability, so roughly 87% of URA
// carparks will have a price and no lot count. The UI has to say "no live
// count" rather than let an absent number read as "full" or as "empty".
//
// WHAT MAKES THIS SOURCE DIFFERENT FROM HDB: it publishes its own rates. HDB's
// schedule had to be transcribed off a web page and watchdogged; URA's arrives
// as data with every carpark, so src/ura-rates.js prices from the record itself
// and hard-codes nothing. That is why the spec called for a feeFor per adapter.
//
// Auth is two steps: a permanent AccessKey buys a Token that lasts the day.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { svy21ToWgs84 } = require("../svy21");
const { parseRateTable } = require("../ura-rates");

const SOURCE = "ura";
const BASE = "https://eservice.ura.gov.sg/uraDataService";
const KEY_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || "", ".claude", ".secrets", "ura-access-key.txt");

// URA rejects a request with no User-Agent. This one says truthfully what the
// client is; it does not pretend to be a browser.
const UA = "carpark-sg/1.0 (+https://kcjj0203.github.io/carpark-sg/)";

function accessKey() {
  if (process.env.URA_ACCESS_KEY) return process.env.URA_ACCESS_KEY.trim();
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error("No URA AccessKey. Set URA_ACCESS_KEY, or put the key in " + KEY_FILE);
  }
  const key = fs.readFileSync(KEY_FILE, "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))[0];
  if (!key) throw new Error("URA AccessKey file has no key in it: " + KEY_FILE);
  return key;
}

function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "user-agent": UA, ...headers } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        // The token endpoint answers with padding around the JSON, so find the
        // object rather than assuming the body is exactly one.
        const i = d.indexOf("{");
        const j = d.lastIndexOf("}");
        if (i === -1 || j <= i) return reject(new Error("no JSON from " + url));
        try { resolve(JSON.parse(d.slice(i, j + 1))); }
        catch (e) { reject(new Error("bad JSON from " + url)); }
      });
    }).on("error", reject);
  });
}

// The token lasts a day; a collector run needs one. Cached against the date so
// a long-lived process rolls over rather than serving yesterday's.
let cached = { day: null, token: null };

async function token() {
  const today = new Date().toISOString().slice(0, 10);
  if (cached.day === today && cached.token) return cached.token;
  const key = accessKey();
  const j = await getJson(BASE + "/insertNewToken/v1", { AccessKey: key });
  if (j.Status !== "Success" || !j.Result) {
    throw new Error("URA refused the AccessKey: " + (j.Message || j.Status));
  }
  cached = { day: today, token: j.Result };
  return cached.token;
}

async function service(name) {
  const key = accessKey();
  const j = await getJson(BASE + "/invokeUraDS/v1?service=" + name,
    { AccessKey: key, Token: await token() });
  if (j.Status !== "Success") throw new Error("URA " + name + " failed: " + (j.Message || j.Status));
  return j.Result || [];
}

// URA says "C" for coupon and "B" for its gantry carparks. Translated into the
// wording HDB uses so one vocabulary reaches the page and both rate engines
// test the same string.
const SYSTEMS = { C: "COUPON PARKING", B: "ELECTRONIC PARKING" };

// URA's own naming is the only signal for this, and it is a real one: 88 of the
// 658 car carparks end in "OFF ST" and none of the rest do. It matters to a
// driver - an off-street lot and a row of parallel bays on a main road are not
// the same offer - and it is what the type filter shows.
const isOffStreet = (name) => /\bOFF\s*ST\.?$/i.test(String(name || "").trim());

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// URA's free hours live inside the rate table as explicit "$0.00 / 0 mins"
// windows. Re-expressing them as parsed windows lets the existing "free right
// now" display work for URA carparks without knowing anything about URA.
//
// A window may wrap past midnight, which src/windows.js deliberately does not
// represent, so a wrapping window becomes two.
const DAY_SETS = { wd: ["MON", "TUE", "WED", "THU", "FRI"], sat: ["SAT"], sun: ["SUN", "PH"] };

function freeWindowsFrom(rates) {
  const out = [];
  for (const w of rates) {
    const freeKeys = ["wd", "sat", "sun"].filter((k) => w[k] && w[k].rate === 0);
    if (!freeKeys.length) continue;
    const days = freeKeys.length === 3 ? ["ALL"] : freeKeys.flatMap((k) => DAY_SETS[k]);
    for (const [from, to] of split(w)) out.push({ days, from, to });
  }
  return out;
}

// The hours a non-season driver may park at all. URA's windows tile the whole
// day, so this is every window that has a published rate - and a window with no
// rate published is left out, because it may mean free and may equally mean no
// parking, and only one of those two guesses costs the driver a fine.
function shortTermWindowsFrom(rates) {
  const out = [];
  for (const w of rates) {
    const keys = ["wd", "sat", "sun"].filter((k) => w[k]);
    if (!keys.length) continue;
    const days = keys.length === 3 ? ["ALL"] : keys.flatMap((k) => DAY_SETS[k]);
    for (const [from, to] of split(w)) out.push({ days, from, to });
  }
  return out;
}

function split(w) {
  if (w.to > w.from) return [[w.from, w.to]];
  const parts = [];
  if (w.from < 1440) parts.push([w.from, 1440]);
  if (w.to > 0) parts.push([0, w.to]);
  return parts;
}

// rows: every Car_Park_Details row sharing one ppCode.
function toCarpark(rows) {
  const first = rows[0];
  const coord = ((first.geometries || [])[0] || {}).coordinates;
  const [x, y] = String(coord || "").split(",");
  const point = svy21ToWgs84(x, y);
  // A carpark we cannot place on a map is useless. Better to drop and count it
  // than to give it a default position that looks authoritative.
  if (!point) return null;

  const cars = rows.filter((r) => r.vehCat === "Car");
  if (!cars.length) return null;

  const name = clean(first.ppName);
  const rates = parseRateTable(cars);
  // URA prices motorcycles and heavy vehicles too, in the same rows we already
  // download - 842 motorcycle and 664 heavy-vehicle rows that were being thrown
  // away. HDB publishes no short-term rate for either on the page this project
  // transcribes, so those stay unpriced there rather than guessed at.
  const vehicleRates = { car: rates };
  for (const [key, cat] of [["motorcycle", "Motorcycle"], ["heavy", "Heavy Vehicle"]]) {
    const set = rows.filter((r) => r.vehCat === cat);
    if (set.length) vehicleRates[key] = parseRateTable(set);
  }

  return {
    id: SOURCE + ":" + clean(first.ppCode).toUpperCase(),
    source: SOURCE,
    name,
    address: name,
    lat: point.lat,
    lng: point.lng,
    type: isOffStreet(name) ? "OFF-STREET CAR PARK" : "ON-STREET PARKING",
    parkingSystem: SYSTEMS[first.parkingSystem] || null,
    decks: null,
    // URA publishes no gantry heights. null, not a guess.
    gantryHeight: null,
    freeParking: freeWindowsFrom(rates),
    shortTermParking: shortTermWindowsFrom(rates),
    // The Night Parking Scheme is an HDB scheme and does not exist here, so
    // this is "not applicable" rather than "no". Whether an overnight stay is
    // allowed and what it costs both come from the rate table instead.
    nightParking: null,
    capacity: Number(first.parkCapacity) || null,
    // What makes this source worth having: its own prices, per carpark.
    rates,
    vehicleRates,
  };
}

// URA labels motorcycle lots "M"; the rest of this project uses HDB's "Y" for
// the same thing, and one vocabulary is worth more than fidelity to either.
const LOT_TYPES = { C: "C", M: "Y", H: "H" };

function toAvailability(rows, at) {
  const first = rows[0];
  return {
    id: SOURCE + ":" + clean(first.carparkNo).toUpperCase(),
    source: SOURCE,
    at,
    lots: rows.map((r) => {
      // Number(null) and Number("") are both 0, and 0 lots free is a claim that
      // the carpark is FULL. An absent count has to stay absent rather than be
      // parsed into the most alarming number there is.
      const raw = r.lotsAvailable;
      const blank = raw === null || raw === undefined || String(raw).trim() === "";
      const available = blank ? NaN : Number(raw);
      return {
        type: LOT_TYPES[r.lotType] || r.lotType,
        // URA reports what is free and never how many lots exist, so there is
        // no fullness to compute. null means unknown, and the page must not
        // render an unknown total as a full bar or an empty one.
        total: null,
        available: isFinite(available) ? available : null,
      };
    }),
  };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = clean(r[key]).toUpperCase();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

async function fetchCarparks() {
  const rows = await service("Car_Park_Details");
  const out = [];
  let dropped = 0;
  for (const group of groupBy(rows, "ppCode").values()) {
    const c = toCarpark(group);
    if (c) out.push(c); else dropped++;
  }
  return { carparks: out, dropped };
}

async function fetchAvailability() {
  const rows = await service("Car_Park_Availability");
  // URA stamps no time on this, so the time of collection is the honest
  // timestamp - and it is the one the staleness display needs anyway.
  const at = new Date().toISOString();
  return [...groupBy(rows, "carparkNo").values()].map((g) => toAvailability(g, at));
}

module.exports = {
  SOURCE, toCarpark, toAvailability, fetchCarparks, fetchAvailability,
  freeWindowsFrom, shortTermWindowsFrom, isOffStreet,
};
