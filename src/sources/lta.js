// LTA carparks, via LTA DataMall. Free AccountKey, registered 9 Sep 2026.
//
// One service does both jobs here: CarParkAvailabilityv2 is the carpark list
// AND the live count, because LTA publishes no separate details service.
//
// WHAT THIS SOURCE IS FOR, and it is narrower than the endpoint suggests. The
// feed returns 2,605 rows, but they carry an Agency column:
//
//   HDB  1,995 carparks   already collected from HDB's own dataset
//   URA     89 carparks   already collected from the URA Data Service
//   LTA     37 carparks   NOT AVAILABLE ANYWHERE ELSE
//
// So this adapter keeps the LTA rows and drops the other 2,568. Passing them
// through would put two records with the same identity into one snapshot, from
// two feeds that disagree by a few minutes, and the later one would silently
// win. The sources that own those carparks stay the sources for them.
//
// The 37 are worth having on their own: they are the malls and attractions -
// ION, Ngee Ann City, VivoCity, Marina Square, Resorts World, Tampines Mall,
// Funan, Bedok Mall - which is exactly where a driver goes and exactly what
// HDB and URA between them do not cover.
//
// WHAT THIS SOURCE CANNOT DO: it publishes no prices. Not a rate, not a cap,
// not a free-parking window. So every carpark here is unpriced, and the page
// must say so rather than fall back to some other source's schedule. That is
// why the built record carries its source explicitly - see scripts/build-web.js.

const fs = require("fs");
const path = require("path");
const https = require("https");

const SOURCE = "lta";
const BASE = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2";
const KEY_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || "", ".claude", ".secrets", "lta-account-key.txt");

// Says truthfully what the client is. It does not pretend to be a browser.
const UA = "carpark-sg/1.0 (+https://kcjj0203.github.io/carpark-sg/)";

// DataMall pages at 500 records and gives no total, so the only way to know you
// have everything is to read until a short page. The ceiling exists so a feed
// that starts repeating itself cannot spin forever.
const PAGE = 500;
const MAX_PAGES = 20;

// A floor, not a target. On 9 Sep 2026 the feed carried 37 LTA carparks; a run
// that suddenly returns a handful is a feed having a bad day, not 30 malls
// closing. Throwing here makes scripts/collect.js keep the records it already
// has, which is the whole reason that keep-on-failure path exists.
const MIN_EXPECTED = 25;

function accountKey() {
  if (process.env.LTA_ACCOUNT_KEY) return process.env.LTA_ACCOUNT_KEY.trim();
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error("No LTA AccountKey. Set LTA_ACCOUNT_KEY, or put the key in " + KEY_FILE);
  }
  const key = fs.readFileSync(KEY_FILE, "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))[0];
  if (!key) throw new Error("LTA AccountKey file has no key in it: " + KEY_FILE);
  return key;
}

function getJson(url, key) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { AccountKey: key, accept: "application/json", "user-agent": UA } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error("LTA DataMall answered " + res.statusCode));
          }
          try { resolve(JSON.parse(d)); }
          catch (e) { reject(new Error("bad JSON from LTA DataMall")); }
        });
      }).on("error", reject);
  });
}

async function fetchRows() {
  const key = accountKey();
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await getJson(BASE + "?$skip=" + page * PAGE, key);
    const v = j.value;
    if (!Array.isArray(v)) throw new Error("LTA DataMall returned no value array");
    rows.push(...v);
    if (v.length < PAGE) return rows;
  }
  throw new Error("LTA DataMall did not stop paging after " + MAX_PAGES + " pages");
}

const clean = (s) =>
  String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();

const isLta = (r) => clean(r.Agency).toUpperCase() === "LTA";

// "1.29115 103.85728". Space separated, latitude first. An empty string is a
// real value in this feed - one URA row carries one - so it has to be rejected
// rather than parsed into NaN and plotted in the Gulf of Guinea.
function toPoint(location) {
  const parts = clean(location).split(" ");
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (parts[0] === "" || parts[1] === undefined) return null;
  // Singapore, generously bounded. A coordinate outside this is not a carpark
  // anyone reading this site can drive to.
  if (lat < 1.15 || lat > 1.5 || lng < 103.5 || lng > 104.15) return null;
  return { lat, lng };
}

// LTA labels its motorcycle lots "Y" and heavy-vehicle lots "H", which is
// already the vocabulary this project uses. "S" is undocumented and appears on
// exactly two HDB rows, both reporting zero - so it is passed through unchanged
// rather than mapped to something it might not be.
const LOT_TYPES = { C: "C", Y: "Y", H: "H" };

// rows: every row sharing one CarParkID.
function toCarpark(rows) {
  const first = rows[0];
  const point = toPoint(first.Location);
  // A carpark we cannot place on a map is useless, and a default position
  // would look authoritative. Drop it and count it.
  if (!point) return null;

  const name = clean(first.Development);
  if (!name) return null;

  return {
    id: SOURCE + ":" + clean(first.CarParkID).toUpperCase(),
    source: SOURCE,
    name,
    // DataMall publishes no street address, only the development's name. That
    // name is what a driver is navigating to anyway, so it stands in for the
    // address rather than a blank line or an invented one.
    address: name,
    lat: point.lat,
    lng: point.lng,
    // LTA publishes no structure type, so basement-versus-multi-storey stays
    // unknown rather than guessed. Off-street is the one thing the data does
    // support: every carpark here is a named development you drive into, not a
    // row of metered bays on a public road.
    type: "OFF-STREET CAR PARK",
    // Not published. Both of these are null rather than a default, because a
    // default here reads as a fact.
    parkingSystem: null,
    decks: null,
    gantryHeight: null,
    // DataMall publishes no rates, so it publishes no free-parking hours and no
    // permitted-parking hours either. Empty is the honest answer: the page
    // shows "no times published" for these, and an empty window set can never
    // be read as "free right now".
    freeParking: [],
    shortTermParking: [],
    // The Night Parking Scheme is an HDB scheme and does not reach here.
    nightParking: null,
    // The feed reports lots FREE and never how many exist. No capacity.
    capacity: null,
    // The point of the source marker: no rates at all, from anyone.
    rates: null,
  };
}

function toAvailability(rows, at) {
  const first = rows[0];
  return {
    id: SOURCE + ":" + clean(first.CarParkID).toUpperCase(),
    source: SOURCE,
    at,
    lots: rows.map((r) => {
      // Number(null) and Number("") are both 0, and 0 lots free is a claim that
      // the carpark is FULL. An absent count has to stay absent all the way to
      // the page, so the emptiness is tested before the number is parsed.
      const raw = r.AvailableLots;
      const blank = raw === null || raw === undefined || String(raw).trim() === "";
      const available = blank ? NaN : Number(raw);
      return {
        type: LOT_TYPES[clean(r.LotType).toUpperCase()] || clean(r.LotType),
        // No denominator is published, so there is no fullness to compute.
        // null means unknown, and an unknown total must never be rendered as a
        // full bar or an empty one.
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
  const rows = (await fetchRows()).filter(isLta);
  if (rows.length < MIN_EXPECTED) {
    throw new Error("LTA feed carried only " + rows.length + " LTA carparks, expected at least " +
      MIN_EXPECTED + " - treating as a bad response rather than a shrinking dataset");
  }
  const out = [];
  let dropped = 0;
  for (const group of groupBy(rows, "CarParkID").values()) {
    const c = toCarpark(group);
    if (c) out.push(c); else dropped++;
  }
  return { carparks: out, dropped };
}

async function fetchAvailability() {
  const rows = (await fetchRows()).filter(isLta);
  // DataMall stamps no time on this, so the time of collection is the honest
  // timestamp - and it is the one the staleness display needs anyway.
  const at = new Date().toISOString();
  return [...groupBy(rows, "CarParkID").values()].map((g) => toAvailability(g, at));
}

module.exports = {
  SOURCE, toCarpark, toAvailability, fetchCarparks, fetchAvailability, toPoint, isLta,
};
