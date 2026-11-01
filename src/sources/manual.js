// Carparks that are in no public feed, added by hand.
//
// HDB, URA and LTA between them miss every privately run carpark that is not
// one of LTA's 40 malls. Most are not worth a hand entry; these are, because
// someone driving here asked for them and the nearest feed carparks are a
// walk away. Coordinates are OneMap's for the building (OneMap search, read
// 1 Nov 2026); rates, where posted, are in src/mall-tariffs.js under the same
// id, and a carpark with no entry there is shown unpriced.
//
// No live counts: none of these publishes one. fetchAvailability returns none
// so the history never records a guess.
//
// Removed: HarbourFront Centre (1 Maritime Square) closed for redevelopment on
// 27 Jul 2026, carpark included; the cruise terminal moved to 5 HarbourFront
// Avenue, which is the entry below.

const SOURCE = "manual";

const CARPARKS = [
  {
    id: "manual:scc",
    name: "Singapore Cruise Centre (HarbourFront)",
    address: "5 HarbourFront Avenue",
    lat: 1.263798, lng: 103.818506,
  },
  {
    id: "manual:kbt",
    name: "Keppel Bay Tower",
    address: "1 HarbourFront Avenue",
    lat: 1.264843, lng: 103.818291,
  },
];

function toCarpark(c) {
  return {
    id: c.id,
    source: SOURCE,
    name: c.name,
    address: c.name,
    lat: c.lat,
    lng: c.lng,
    type: "OFF-STREET CAR PARK",
    parkingSystem: null,
    decks: null,
    gantryHeight: null,
    freeParking: [],
    shortTermParking: [],
    nightParking: null,
    capacity: null,
    rates: null,
  };
}

async function fetchCarparks() {
  return { carparks: CARPARKS.map(toCarpark), dropped: 0 };
}

async function fetchAvailability() {
  return [];
}

module.exports = { SOURCE, CARPARKS, toCarpark, fetchCarparks, fetchAvailability };
