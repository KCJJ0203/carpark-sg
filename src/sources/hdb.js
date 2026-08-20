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

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "carpark-sg/0.1 (personal project)" } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
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

async function fetchCarparks() {
  const out = [];
  let dropped = 0;
  let offset = 0;
  for (;;) {
    const url =
      "https://data.gov.sg/api/action/datastore_search?resource_id=" +
      INFO_RESOURCE + "&limit=1000&offset=" + offset;
    const j = await getJson(url);
    const records = (j.result && j.result.records) || [];
    for (const r of records) {
      const c = toCarpark(r);
      if (c) out.push(c); else dropped++;
    }
    if (records.length < 1000) break;
    offset += 1000;
  }
  return { carparks: out, dropped };
}

async function fetchAvailability() {
  const j = await getJson(AVAILABILITY_URL);
  const item = (j.items || [])[0] || {};
  return (item.carpark_data || []).map(toAvailability);
}

module.exports = { SOURCE, toCarpark, toAvailability, fetchCarparks, fetchAvailability };
