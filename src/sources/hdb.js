// HDB carparks, via data.gov.sg. Open data, no API key, robots.txt says Allow: /.
//
// Two datasets joined on car_park_no:
//   - carpark information (2,270 records): location, type, parking windows
//   - live availability (~2,015 reporting): lots free right now
// The join was verified at 2,007 of 2,015 before this was written.
//
// This adapter's ONLY job is to turn HDB's shapes into the common ones in
// docs/SPEC.md. Adding URA or LTA later means writing a sibling of this file.

const https = require("https");
const { svy21ToWgs84 } = require("../svy21");
const { parseWindow } = require("../windows");

const SOURCE = "hdb";
const INFO_RESOURCE = "d_23f946fa557947f93a8043bbef41dd09";
const AVAILABILITY_URL = "https://api.data.gov.sg/v1/transport/carpark-availability";

// Floors, not targets (same idea as MIN_EXPECTED in lta.js). The info dataset
// holds ~2,270 carparks and ~2,015 report live. A run that comes back well short
// of that is data.gov.sg having a bad day (rate limit, an error body, a page
// that failed mid-pagination), not hundreds of carparks closing. Throwing makes
// scripts/collect.js keep the records it already has instead of publishing a
// half-empty map.
const MIN_CARPARKS = 2000;
const MIN_AVAILABILITY = 1500;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "carpark-sg/0.1 (personal project)" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error("data.gov.sg answered " + res.statusCode + " for " + url));
          }
          try { resolve(JSON.parse(d)); } catch (e) { reject(new Error("bad JSON from " + url)); }
        });
      })
      .on("error", reject);
  });
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function toCarpark(raw) {
  const point = svy21ToWgs84(raw.x_coord, raw.y_coord);
  // A carpark we cannot place on a map is useless. Better to drop and count it
  // than to give it a default position that looks authoritative.
  if (!point) return null;

  const gantry = num(raw.gantry_height);
  return {
    id: SOURCE + ":" + String(raw.car_park_no).trim().toUpperCase(),
    source: SOURCE,
    name: raw.address,
    address: raw.address,
    lat: point.lat,
    lng: point.lng,
    type: raw.car_park_type,
    parkingSystem: raw.type_of_parking_system,
    decks: num(raw.car_park_decks),
    // 0.0 in this dataset means "not recorded", not a zero-metre gantry.
    gantryHeight: gantry && gantry > 0 ? gantry : null,
    freeParking: parseWindow(raw.free_parking),
    shortTermParking: parseWindow(raw.short_term_parking),
    // The Night Parking Scheme is what lets a non-season driver stay between
    // 10.30pm and 7am, and it is also what caps that night at $5. Without it
    // an overnight stay is not a cheap stay, it is not allowed at all.
    nightParking: /^Y/i.test(String(raw.night_parking || "")),
  };
}

function toAvailability(raw) {
  return {
    id: SOURCE + ":" + String(raw.carpark_number).trim().toUpperCase(),
    source: SOURCE,
    at: raw.update_datetime || null,
    lots: (raw.carpark_info || []).map((i) => {
      const total = num(i.total_lots);
      const available = num(i.lots_available);
      // A reported total of 0 means the carpark is not reporting, NOT that it
      // is full. Showing it as full would send people away from free spaces.
      if (!total) return { type: i.lot_type, total: null, available: null };
      return { type: i.lot_type, total, available };
    }),
  };
}

// `get` is injectable so the guards below can be tested without the network.
async function fetchCarparks(get = getJson) {
  const out = [];
  let dropped = 0;
  let offset = 0;
  for (;;) {
    const url =
      "https://data.gov.sg/api/action/datastore_search?resource_id=" +
      INFO_RESOURCE + "&limit=1000&offset=" + offset;
    const j = await get(url);
    // data.gov.sg reports errors (rate limits included) as success:false with no
    // records, which would otherwise read as "last page" and end the loop early.
    if (!j || j.success !== true || !j.result || !Array.isArray(j.result.records)) {
      throw new Error("HDB carpark info: bad response at offset " + offset +
        (j && j.error ? " (" + JSON.stringify(j.error).slice(0, 200) + ")" : ""));
    }
    const records = j.result.records;
    for (const r of records) {
      const c = toCarpark(r);
      if (c) out.push(c); else dropped++;
    }
    if (records.length < 1000) break;
    offset += 1000;
  }
  if (out.length < MIN_CARPARKS) {
    throw new Error("HDB carpark info carried only " + out.length + " usable carparks, expected at least " +
      MIN_CARPARKS + " - treating as a bad response rather than a shrinking dataset");
  }
  return { carparks: out, dropped };
}

async function fetchAvailability(get = getJson) {
  const j = await get(AVAILABILITY_URL);
  const item = ((j && j.items) || [])[0] || {};
  const rows = (item.carpark_data || []).map(toAvailability);
  if (rows.length < MIN_AVAILABILITY) {
    throw new Error("HDB availability carried only " + rows.length + " carparks, expected at least " +
      MIN_AVAILABILITY);
  }
  return rows;
}

module.exports = {
  SOURCE, MIN_CARPARKS, MIN_AVAILABILITY, toCarpark, toAvailability, fetchCarparks, fetchAvailability,
};
