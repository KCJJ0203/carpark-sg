// Car parking rates for malls and private carparks, TRANSCRIBED by hand from
// each carpark's own website. No feed publishes these: LTA DataMall gives the
// malls' lot counts and no price, and private carparks are in no feed at all.
//
// Every entry names the page it was read from and the date it was read, and
// scripts/check-mall-rates.js re-reads those pages and fails loudly when a
// figure in here no longer appears there. Never edit a price without reading
// the page; never add a mall from memory.
//
// secondary: true  = no rate on the operator's own site; read from LTA
//                     OneMotoring's guide, which says it may exclude GST.
// note              = a caveat the page shows beside the price.
// checks            = strings that must appear on the source page; what the
//                     watchdog looks for. Keep them to the figures.
//
// Engine and band format: see src/mall-rates.js.

const D = "2026-11-01";
const block = (from, to, firstMin, firstPrice, unit, unitPrice) =>
  ({ from, to, first: { min: firstMin, price: firstPrice }, then: { min: unit, price: unitPrice } });
const per = (from, to, unit, price) => ({ from, to, then: { min: unit, price } });
const entry = (from, to, price) => ({ from, to, entry: price });
const free = (from, to, until) => (until ? { from, to, free: true, until } : { from, to, free: true });

const CAPITALAND = (slug) => "https://www.capitaland.com/sg/malls/" + slug + "/en/concierge.html";
const ONEMOTORING_ORCHARD =
  "https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.1.html";

// Plaza Singapura's table, which The Atrium@Orchard's basement also follows.
const PLAZA_SING_DAYS = {
  wd: [block("00:00", "18:00", 60, 1.95, 15, 0.55), entry("18:00", "24:00", 3.25)],
  eve: "wd",
  sat: [per("00:00", "03:00", 15, 0.55), block("03:00", "18:00", 120, 3.25, 15, 0.55), entry("18:00", "24:00", 3.25)],
  sun: "sat",
  ph: "sat",
};

const TARIFFS = {
  "lta:9": {
    name: "Plaza Singapura", source: CAPITALAND("plazasingapura"), read: D, grace: 10,
    days: PLAZA_SING_DAYS,
    checks: ["$1.95", "$0.55", "$3.25"],
  },
  "lta:57": {
    name: "The Atrium@Orchard", source: ONEMOTORING_ORCHARD, read: D, grace: 10, secondary: true,
    note: "The Atrium posts no rates of its own; these are LTA OneMotoring's, the same as Plaza Singapura's",
    days: PLAZA_SING_DAYS,
    checks: ["Atrium", "$1.95", "$3.25"],
  },
  "lta:10": {
    name: "The Cathay", source: "https://thecathay.com.sg/parking/", read: D, grace: null,
    days: {
      wd: [per("08:00", "18:00", 60, 1.80), entry("18:00", "08:00", 2.95)],
      sat: [per("08:00", "18:00", 60, 1.60), entry("18:00", "08:00", 3.10)],
      sun: "sat",
      ph: "sat",
    },
    checks: ["1.80", "2.95", "1.60", "3.10"],
  },
  "lta:61": {
    name: "Bugis+", source: CAPITALAND("bugisplus"), read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 2.20, 15, 0.55), entry("18:00", "24:00", 3.30)],
      fri: [block("00:00", "18:00", 60, 2.20, 15, 0.55), block("18:00", "24:00", 120, 3.30, 15, 0.55)],
      eve: "fri",
      sat: [block("00:00", "24:00", 120, 3.30, 15, 0.55)],
      sun: "sat",
      ph: "sat",
    },
    checks: ["$2.20", "$0.55", "$3.30"],
  },
  "lta:59": {
    name: "CQ @ Clarke Quay", source: CAPITALAND("clarkequay"), read: D, grace: 10,
    note: "Free 12pm-2pm Mon-Fri, and 6pm-9pm Mon-Thu until 31 Dec 2026, except on the eve of a public holiday",
    days: {
      wd: [free("12:00", "14:00"), free("18:00", "21:00", "2026-12-31"), block("07:00", "07:00", 60, 1.60, 15, 0.55)],
      fri: [free("12:00", "14:00"), block("07:00", "07:00", 60, 1.60, 15, 0.55)],
      sat: [block("07:00", "07:00", 60, 1.60, 15, 0.55)],
      eve: "sat",
      sun: [entry("07:00", "07:00", 3.00)],
      ph: "sun",
    },
    checks: ["$1.60", "$0.55", "$3.00"],
  },
  "lta:43": {
    name: "Westgate", source: CAPITALAND("westgate"), read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 1.60, 15, 0.55), entry("18:00", "24:00", 3.25)],
      sat: "wd", sun: "wd", ph: "wd",
    },
    checks: ["$1.60", "$0.55", "$3.25"],
  },
  "lta:53": {
    name: "IMM", source: CAPITALAND("imm"), read: D, grace: 10,
    note: "The free first hour is for your first entry of the day on a weekday. Levels 2-6 close at 10pm; level 1 is open 24 hours",
    days: {
      wd: [{ from: "00:00", to: "24:00", first: [{ min: 60, price: 0 }, { min: 60, price: 1.20 }], then: { min: 15, price: 0.40 } }],
      sat: [block("00:00", "24:00", 60, 1.20, 15, 0.40)],
      sun: "sat", ph: "sat",
    },
    checks: ["$1.20", "$0.40"],
  },
  "lta:58": {
    name: "Bukit Panjang Plaza", source: "https://www.bukitpanjangplaza.com/faqs/", read: D, grace: 10,
    note: "LTA's guide lists a different weekday rate; these are the mall's own figures (with effect from 1 Aug 2022)",
    days: {
      wd: [block("00:00", "18:00", 60, 1.40, 15, 0.45), entry("18:00", "24:00", 2.75)],
      sat: [block("00:00", "18:00", 120, 2.75, 15, 0.45), entry("18:00", "24:00", 2.75)],
      sun: "sat", ph: "sat",
    },
    checks: ["$1.40", "$0.45", "$2.75"],
  },
  "lta:62": {
    name: "Lot One", source: CAPITALAND("lotone"), read: D, grace: 10,
    note: "The mall's page gives two start times for the weekend 2-hour block (12am and 3am); this uses 3am, as LTA's guide does",
    days: {
      wd: [block("00:00", "18:00", 60, 1.35, 15, 0.45), entry("18:00", "24:00", 2.65)],
      sat: [per("00:00", "03:00", 15, 0.45), block("03:00", "18:00", 120, 2.65, 15, 0.45), entry("18:00", "24:00", 2.65)],
      sun: "sat", ph: "sat",
    },
    checks: ["$1.35", "$0.45", "$2.65"],
  },
  "lta:63": {
    name: "Tampines Mall", source: CAPITALAND("tampinesmall"), read: D, grace: 10,
    note: "The mall's page gives the weekend first block as both one hour and two; this uses two hours, as LTA's guide does",
    days: {
      wd: [block("00:00", "18:00", 60, 1.35, 15, 0.45), entry("18:00", "24:00", 2.65)],
      eve: "wd",
      sat: [per("00:00", "03:00", 15, 0.45), block("03:00", "18:00", 120, 2.65, 15, 0.45), entry("18:00", "24:00", 2.65)],
      sun: "sat", ph: "sat",
    },
    checks: ["$1.35", "$0.45", "$2.65"],
  },
  "lta:64": {
    name: "Junction 8", source: CAPITALAND("junction8"), read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 1.35, 15, 0.45), entry("18:00", "24:00", 2.65)],
      sat: [block("00:00", "18:00", 120, 2.65, 15, 0.45), entry("18:00", "24:00", 2.65)],
      sun: "sat", ph: "sat",
    },
    checks: ["$1.35", "$0.45", "$2.65"],
  },
  "lta:65": {
    name: "Bedok Mall", source: CAPITALAND("bedokmall"), read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 1.55, 15, 0.40), entry("18:00", "24:00", 2.60)],
      sat: "wd", sun: "wd", ph: "wd",
    },
    checks: ["$1.55", "$0.40", "$2.60"],
  },

  // ---- Marina / CBD ---------------------------------------------------------
  "lta:1": {
    name: "Suntec City", source: "https://www.sunteccity.com.sg/getting_here", read: D, grace: null,
    // The mall's page renders its rates with script; LTA's guide carries the
    // same text word for word, so the watchdog reads that instead.
    checkSource: "https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.4.html",
    note: "Weekdays only. The weekend rate reads \"$1.30 for the next 3 hours\", which could be per hour or once, so weekends are not priced",
    days: {
      wd: [block("07:00", "17:00", 60, 2.60, 30, 1.30), entry("17:00", "04:00", 3.00), block("04:00", "07:00", 60, 2.60, 30, 1.30)],
    },
    checks: ["Suntec", "$2.60", "$1.30", "$3.00"],
  },
  "lta:2": {
    name: "Marina Square", source: "https://www.marinasquare.com.sg/directions?categories=ParkingRate-Web", read: D, grace: null,
    days: {
      wd: [block("07:00", "17:00", 120, 3.27, 30, 1.64), entry("17:00", "23:00", 2.25), per("23:00", "07:00", 30, 1.12)],
      fri: [{ from: "07:00", to: "02:00", first: [{ min: 120, price: 2.44 }, { min: 60, price: 1.22 }, { min: 60, price: 1.22 }],
        then: { min: 30, price: 1.43 } }, per("02:00", "07:00", 30, 1.12)],
      sat: "fri", sun: "fri", ph: "fri",
    },
    checks: ["3.27", "1.64", "2.25", "1.12", "2.44", "1.22", "1.43"],
  },
  "lta:3": {
    name: "Raffles City", source: CAPITALAND("rafflescity"), read: D, grace: 10,
    days: {
      wd: [block("08:00", "18:00", 60, 2.60, 15, 0.65), entry("18:00", "08:00", 3.25)],
      sat: [block("08:00", "08:00", 120, 2.60, 15, 0.65)],
      sun: "sat", ph: "sat",
    },
    checks: ["$2.60", "$0.65", "$3.25"],
  },
  "lta:4": {
    name: "Esplanade", source: "https://esplanade.com/visit-esplanade/visitor-guide/getting-here-and-parking", read: D, grace: null,
    days: { wd: [per("00:00", "24:00", 60, 2.30)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$2.30"],
  },
  "lta:6": {
    name: "Singapore Flyer", source: "https://www.singaporeflyer.com/en/amenity/getting-to-singapore-flyer", read: D, grace: null,
    days: { wd: [per("09:00", "23:00", 60, 2.50), entry("23:00", "09:00", 2.50)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$2.50"],
  },
  "lta:56": {
    name: "National Gallery", source: "https://www.nationalgallery.sg/visit", read: D, grace: null,
    note: "The gantry opens at 7am and closes overnight (1am-4am for entry, depending on the day)",
    days: { wd: [per("02:30", "18:00", 30, 1.40), entry("18:00", "02:30", 3.30)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$1.40", "$3.30"],
  },
  "lta:66": {
    name: "Funan", source: CAPITALAND("funan"), read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 2.40, 15, 0.65), entry("18:00", "24:00", 3.30)],
      eve: "wd",
      sat: [per("00:00", "03:00", 15, 0.65), block("03:00", "18:00", 120, 2.60, 15, 0.65), entry("18:00", "24:00", 3.30)],
      sun: "sat", ph: "sat",
    },
    checks: ["$2.40", "$0.65", "$3.30", "$2.60"],
  },

  // ---- HarbourFront / Sentosa -----------------------------------------------
  // VivoCity posts one table for "our basement and 8-storey multi-storey
  // carparks", which is both of LTA's records (P2 and P3).
  "lta:50": VIVOCITY("VivoCity P2"),
  "lta:16": VIVOCITY("VivoCity P3"),
  "lta:17": {
    name: "Sentosa", source: "https://www.sentosa.com.sg/en/getting-to-sentosa/", read: D, grace: null, dayCap: 10,
    note: "LTA's Sentosa record is the whole island's public carparks (Beach Station, Imbiah, Tanjong, Palawan, " +
      "Sentosa Cove Village), not one carpark. Driving in also costs island admission at the gantry: $6, " +
      "or $2 from 11.30am-1.30pm and after 5pm, which is not included here",
    days: { wd: [per("07:00", "17:00", 15, 0.55), entry("17:00", "07:00", 4.00)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$2.20", "$4.00", "$10.00"],
  },
  "lta:26": {
    name: "Resorts World Sentosa", source: "https://www.rwsentosa.com/en/about/getting-here", read: D, grace: 10,
    note: "Driving onto Sentosa also costs island admission at the gantry, which is not included here",
    days: {
      wd: [{ ...block("00:00", "24:00", 60, 6.50, 30, 1.10), dayCap: 13.10 }],
      fri: [{ ...block("00:00", "24:00", 60, 9.70, 30, 1.10), dayCap: 16.30 }],
      sat: "fri", sun: "fri", ph: "fri",
    },
    checks: ["6.50", "1.10", "13.10", "9.70", "16.30"],
  },
  "manual:scc": {
    name: "Singapore Cruise Centre", source: "https://singaporecruise.com.sg/parking/", read: D, grace: 15,
    note: "Lots are limited, and the terminal asks passengers to come by public transport",
    days: { wd: [per("07:00", "07:00", 60, 2.80)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$2.80", "15 minutes"],
  },

  // ---- Orchard ----------------------------------------------------------------
  "lta:23": {
    name: "ION Orchard", source: "https://www.ionorchard.com/en/visitor-information.html", read: D, grace: null,
    days: {
      wd: [per("00:00", "08:00", 60, 1.09), block("08:00", "17:00", 60, 2.73, 30, 1.31), entry("17:00", "24:00", 3.05)],
      fri: [per("00:00", "08:00", 60, 1.09), block("08:00", "18:00", 60, 2.62, 30, 1.91), entry("18:00", "24:00", 3.82)],
      sat: "fri", sun: "fri", ph: "fri",
    },
    checks: ["$2.73", "$1.31", "$3.05", "$1.09", "$2.62", "$1.91", "$3.82"],
  },
  "lta:14": {
    name: "Wisma Atria", source: "https://www.wismaonline.com/parking-infomation/", read: D, grace: null,
    days: {
      wd: [block("00:00", "17:00", 60, 2.60, 30, 1.70), entry("17:00", "24:00", 5.00)],
      sat: [block("00:00", "17:00", 60, 2.70, 30, 1.70), entry("17:00", "24:00", 5.00)],
      sun: "sat", ph: "sat",
    },
    surcharges: [{ from: "12:00", to: "14:00", price: 1.10, when: "entry", label: "Lunch-hour surcharge (entering 12-2pm)" }],
    checks: ["S$2.60", "S$1.70", "S$5.00", "S$2.70", "S$1.10"],
  },
  "lta:55": {
    name: "Paragon", source: "https://www.paragon.com.sg/getting-here", read: D, grace: null,
    note: "Paragon does not say whether its 11am-3pm peak surcharge is for cars entering then or any stay that " +
      "overlaps it; this charges it for any overlap, so the figure may be $2.10 high",
    days: { wd: [block("03:00", "17:00", 60, 3.00, 30, 1.60), entry("17:00", "03:00", 4.60)], sat: "wd", sun: "wd", ph: "wd" },
    surcharges: [{ from: "11:00", to: "15:00", price: 2.10, when: "overlap", days: ["wd", "sat"], label: "Peak-hour surcharge (11am-3pm, Mon-Sat)" }],
    checks: ["$3.00", "$1.60", "$4.60", "$2.10"],
  },
  "lta:8": {
    name: "The Heeren", source: "https://www.heeren.com.sg/getting-here/", read: D, grace: null,
    note: "The Heeren lists its operating hours as 8am-10pm daily",
    days: {
      wd: [block("03:00", "17:00", 60, 4.00, 30, 2.00), entry("17:00", "03:00", 4.50)],
      sat: [block("00:00", "24:00", 120, 6.00, 30, 2.00)],
      sun: "sat", ph: "sat",
    },
    checks: ["$4.00", "$2.00", "$4.50", "$6.00"],
  },
  "lta:12": {
    name: "Hilton Orchard", source: "https://mandaringallery.com.sg/getting-here", read: D, grace: null,
    note: "Posted by Mandarin Gallery, which shares the building and its carparks with the Hilton",
    days: { wd: [block("06:00", "18:00", 60, 3.80, 30, 2.50), entry("18:00", "06:00", 7.00)], sat: "wd", sun: "wd", ph: "wd" },
    checks: ["$3.80", "$2.50", "$7.00"],
  },
  "lta:11": {
    name: "Cineleisure", source: "https://cineleisure.com.sg/parking/", read: D, grace: null,
    days: {
      wd: [block("07:00", "17:00", 60, 2.40, 30, 1.40), per("17:00", "07:00", 1, 0.04)],
      sat: [entry("07:00", "11:00", 4.80), per("11:00", "20:00", 60, 2.50), per("20:00", "07:00", 1, 0.05)],
      sun: "sat", ph: "sat",
    },
    checks: ["$2.40", "$1.40", "$0.04", "$4.80", "$2.50", "$0.05"],
  },
  "lta:21": {
    name: "The Centrepoint", source: "https://www.thecentrepoint.com.sg/visit", read: D, grace: 10,
    // The mall's page renders its rates with script; LTA's guide matches it.
    checkSource: ONEMOTORING_ORCHARD,
    days: {
      wd: [block("06:00", "06:00", 60, 2.80, 30, 1.20)],
      sat: [block("06:00", "06:00", 60, 3.00, 30, 1.20)],
      sun: "sat", ph: "sat",
    },
    checks: ["Centrepoint", "$2.80", "$1.20", "$3.00"],
  },
  "lta:24": {
    name: "313@Somerset", source: "https://www.313somerset.com.sg/concierge/parking/", read: D, grace: null,
    days: {
      wd: [block("00:00", "24:00", 60, 3.05, 30, 1.31)],
      fri: [block("00:00", "24:00", 60, 3.27, 30, 1.64)],
      sat: "fri", sun: "fri", ph: "fri",
    },
    checks: ["$3.05", "$1.31", "$3.27", "$1.64"],
  },
  "lta:27": {
    name: "Orchard Central", source: "https://fareastmalls.com.sg/orchard-central/Getting-there", read: D, grace: 10,
    days: {
      wd: [block("00:00", "18:00", 60, 2.73, 15, 0.68), entry("18:00", "24:00", 4.09)],
      sat: [block("00:00", "18:00", 60, 2.94, 15, 0.74), entry("18:00", "24:00", 4.41)],
      sun: "sat", ph: "sat",
    },
    checks: ["$4.09", "$2.73", "$0.68", "$4.41", "$2.94", "$0.74"],
  },
  "lta:52": {
    name: "Orchard Gateway", source: "https://orchardgateway.sg/about-us?scrollTo=direction&section=carpark", read: D,
    grace: null, firstEachBand: true,
    // The mall posts its rates as an image; LTA's guide carries the same figures.
    checkSource: ONEMOTORING_ORCHARD,
    note: "Orchard Gateway charges a stay that spans two time slots twice, first hour included",
    days: {
      wd: [block("00:00", "18:00", 60, 2.40, 30, 1.53), block("18:00", "24:00", 60, 2.51, 30, 1.64)],
      sat: [block("00:00", "24:00", 60, 2.51, 30, 1.64)],
      sun: "sat", ph: "sat",
    },
    checks: ["orchardgateway", "2.40", "1.53", "2.51", "1.64"],
  },
};

function VIVOCITY(name) {
  return {
    name, source: "https://www.vivocity.com.sg/about-us?getting-here", read: D, grace: null,
    note: "Rates with effect from 1 Feb 2026",
    days: {
      wd: [entry("00:00", "04:00", 3.20), block("04:00", "24:00", 60, 1.60, 30, 0.80)],
      sat: [entry("00:00", "04:00", 4.80), block("04:00", "24:00", 60, 2.20, 30, 1.10)],
      sun: "sat", eve: "sat", ph: "sat",
    },
    checks: ["$1.60", "$0.80", "$3.20", "$2.20", "$1.10", "$4.80"],
  };
}

module.exports = { TARIFFS };
