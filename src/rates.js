// What a stay actually costs, from HDB's published rate schedule.
//
// WHY THIS IS HAND-ENTERED: there is no parking-rate dataset. data.gov.sg
// publishes carpark locations and live availability but not a single price;
// every dataset was checked. HDB publishes the schedule as a web page only.
// So the numbers below are transcribed from that page, pinned with the date
// they were read, and scripts/check-rates.js re-reads the page and fails
// loudly if any of them moves. That is the honest version of hard-coding:
// say where it came from, and notice when it goes stale.
//
// Source: https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/shortterm-parking-charges
//         https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/electronic-parking
//
// DESIGN RULE, inherited from src/windows.js: where the schedule does not say,
// do not invent. A stay we cannot price returns null and a reason, never $0.
// A free-looking price that turns out to be wrong is the one failure that
// costs the user real money.

const { matchesWindow, DAY_NAMES } = require("./windows");

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const WEEKENDS = ["SAT", "SUN"];
const MON_SAT = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

const RATES = {
  source: "https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/shortterm-parking-charges",
  // What HDB's own page says it was last updated. Not when we read it.
  publishedOn: "2026-07-24",
  checkedOn: "2026-08-25",

  // Dollars per half hour, for motor cars.
  standard: 0.6,
  standardPeak: 0.8,
  central: 1.2,
  centralPeak: 1.4,

  // The Central Area premium applies only in this window; outside it a Central
  // Area carpark charges the ordinary rate.
  centralWindow: { days: MON_SAT, from: 7 * 60, to: 17 * 60 },

  // Night runs from 10.30pm to 7am the following morning.
  nightFrom: 22 * 60 + 30,
  nightTo: 7 * 60,

  caps: { night: 5, day: 12, dayCentral: 20 },

  // Electronic carparks only. "You will not be charged if you exit within 15
  // minutes of entry" - it is a threshold, not a discount off a longer stay.
  graceMinutes: 15,

  // The 16 carparks HDB lists as being in the Central Area.
  centralArea: [
    "ACB", "BBB", "BRB1", "CY", "DUXM", "HLM", "KAB", "KAM",
    "KAS", "PRM", "SLS", "SR1", "SR2", "TPM", "UCS", "WCB",
  ],

  // The 12 carparks with peak-hour surcharges, each with its own peak periods.
  // Caps do not apply at any of these.
  peakHour: {
    ACB: [{ days: WEEKDAYS, from: 10 * 60, to: 18 * 60 }, { days: WEEKENDS, from: 8 * 60, to: 19 * 60 }],
    CY: [{ days: WEEKDAYS, from: 10 * 60, to: 18 * 60 }, { days: WEEKENDS, from: 8 * 60, to: 19 * 60 }],
    SE21: [{ days: MON_SAT, from: 10 * 60, to: 22 * 60 }],
    SE22: [{ days: MON_SAT, from: 10 * 60, to: 22 * 60 }],
    SE24: [{ days: ["ALL"], from: 10 * 60, to: 22 * 60 }],
    MP14: [{ days: ["ALL"], from: 8 * 60, to: 20 * 60 }],
    MP15: [{ days: ["ALL"], from: 8 * 60, to: 20 * 60 }],
    MP16: [{ days: ["ALL"], from: 8 * 60, to: 20 * 60 }],
    HG9: [{ days: WEEKDAYS, from: 11 * 60, to: 20 * 60 }, { days: WEEKENDS, from: 9 * 60, to: 20 * 60 }],
    HG9T: [{ days: WEEKDAYS, from: 11 * 60, to: 20 * 60 }, { days: WEEKENDS, from: 9 * 60, to: 20 * 60 }],
    HG15: [{ days: WEEKDAYS, from: 11 * 60, to: 20 * 60 }, { days: WEEKENDS, from: 9 * 60, to: 20 * 60 }],
    HG16: [{ days: WEEKDAYS, from: 11 * 60, to: 20 * 60 }, { days: WEEKENDS, from: 9 * 60, to: 20 * 60 }],
  },
};

// "hdb:ACB" -> "ACB". Only HDB rates are known, so a carpark from a future
// URA or LTA adapter falls through as neither Central nor peak, and its own
// adapter will bring its own schedule.
function carparkNumber(id) {
  const s = String(id || "");
  const i = s.indexOf(":");
  return (i === -1 ? s : s.slice(i + 1)).toUpperCase();
}

function isHdb(id) {
  return String(id || "").startsWith("hdb:");
}

function isCentral(id) {
  return isHdb(id) && RATES.centralArea.includes(carparkNumber(id));
}

function hasPeakCharges(id) {
  return isHdb(id) && Object.prototype.hasOwnProperty.call(RATES.peakHour, carparkNumber(id));
}

// Minutes since the Unix epoch in Singapore local time. Singapore is UTC+8
// with no daylight saving, so this is exact and needs no timezone library.
function sgMinutes(when) {
  return Math.floor((when.getTime() + 8 * 3600 * 1000) / 60000);
}

// 1 January 1970 was a Thursday, which is index 4 in DAY_NAMES.
function dayNameOf(dayNumber) {
  return DAY_NAMES[(((dayNumber % 7) + 4) % 7 + 7) % 7];
}

function isoDateOf(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}

function isNightMinute(minuteOfDay) {
  return minuteOfDay >= RATES.nightFrom || minuteOfDay < RATES.nightTo;
}

// The posted rate at a moment, ignoring whether this particular carpark is
// giving the parking away under the free-parking scheme.
function rateHalfHourAt(id, when, isPublicHoliday) {
  const tm = sgMinutes(when);
  const day = Math.floor(tm / 1440);
  return rateAt(id, dayNameOf(day), tm - day * 1440, !!isPublicHoliday);
}

function rateAt(id, dayName, minuteOfDay, isPublicHoliday) {
  const peak = hasPeakCharges(id) &&
    matchesWindow(RATES.peakHour[carparkNumber(id)], dayName, minuteOfDay, isPublicHoliday);

  const centralPremium = isCentral(id) &&
    matchesWindow([RATES.centralWindow], dayName, minuteOfDay, isPublicHoliday);

  if (centralPremium) return peak ? RATES.centralPeak : RATES.central;
  return peak ? RATES.standardPeak : RATES.standard;
}

const cents = (n) => Math.round(n * 100) / 100;

// carpark needs: id, parkingSystem, nightParking, shortTermParking, freeParking
//   (shortTermParking / freeParking are parsed windows from src/windows.js)
// start:   a Date, the moment the car enters
// minutes: how long it stays
// isHoliday: (isoDate) => boolean
function feeFor(carpark, start, minutes, isHoliday) {
  const holiday = typeof isHoliday === "function" ? isHoliday : () => false;
  const total = Math.max(0, Math.round(minutes));
  const id = carpark.id;
  const coupon = /COUPON/i.test(carpark.parkingSystem || "");
  const nps = !!carpark.nightParking;
  const shortTerm = carpark.shortTermParking || [];
  const free = carpark.freeParking || [];
  const uncapped = hasPeakCharges(id);
  const dayCap = isCentral(id) ? RATES.caps.dayCentral : RATES.caps.day;

  const blank = {
    total: null, free: false, grace: false, capApplied: null,
    lines: [], couponTotal: null, minutes: total,
    method: coupon ? "coupon" : "electronic",
    central: isCentral(id), peak: uncapped,
  };

  if (!total) return { ...blank, total: 0, lines: [] };

  const startMin = sgMinutes(start);
  const isoCache = new Map();
  const isoFor = (day) => {
    if (!isoCache.has(day)) isoCache.set(day, isoDateOf(day));
    return isoCache.get(day);
  };

  // One pass over the stay. Every minute is classified, priced, and filed
  // under the parking day whose cap it counts against.
  const buckets = new Map(); // parkingDay -> { day, night }
  const runs = [];           // consecutive minutes at the same rate
  let anyChargeable = false;

  for (let m = 0; m < total; m++) {
    const tm = startMin + m;
    const day = Math.floor(tm / 1440);
    const mod = tm - day * 1440;
    const dayName = dayNameOf(day);
    const ph = holiday(isoFor(day));
    const night = isNightMinute(mod);

    // Can a non-season driver be here at all? Short-term hours cover the day;
    // the Night Parking Scheme covers 10.30pm-7am where the carpark has it.
    const parkable = matchesWindow(shortTerm, dayName, mod, ph) || (nps && night);
    if (!parkable) {
      const seasonOnly = !shortTerm.length && !nps;
      return { ...blank, unavailable: seasonOnly ? "season-only" : "outside-hours" };
    }

    const isFree = matchesWindow(free, dayName, mod, ph);
    const rate = isFree ? 0 : rateAt(id, dayName, mod, ph);
    if (rate > 0) anyChargeable = true;

    const last = runs[runs.length - 1];
    if (last && last.rate === rate) last.minutes++;
    else runs.push({ rate, minutes: 1, startMinute: tm });

    // A parking day runs 7am to 7am, so the small hours belong to the night
    // before - which is what makes "capped at $5 per night" mean one night.
    const parkingDay = mod >= RATES.nightTo ? day : day - 1;
    if (!buckets.has(parkingDay)) buckets.set(parkingDay, { day: 0, night: 0 });
    const b = buckets.get(parkingDay);
    b[night ? "night" : "day"] += rate / 30;
  }

  // Grace comes after the parkability check: a carpark you may not enter is
  // not free to enter for 15 minutes.
  if (!coupon && total <= RATES.graceMinutes) {
    return { ...blank, total: 0, grace: true, free: !anyChargeable, unavailable: null };
  }

  let metered = 0;
  let charged = 0;
  let capApplied = null;
  for (const b of buckets.values()) {
    metered += b.day + b.night;
    if (uncapped) { charged += b.day + b.night; continue; }

    let night = b.night;
    if (nps && night > RATES.caps.night) { night = RATES.caps.night; capApplied = "night"; }

    if (nps) {
      const whole = b.day + night;
      if (whole > dayCap) { charged += dayCap; capApplied = "day"; }
      else charged += whole;
    } else {
      if (b.day > dayCap) { charged += dayCap + night; capApplied = "day"; }
      else charged += b.day + night;
    }
  }

  const lines = runs.map((r) => ({
    rate: r.rate,
    minutes: r.minutes,
    from: new Date((r.startMinute - 8 * 60) * 60000),
    to: new Date((r.startMinute + r.minutes - 8 * 60) * 60000),
    amount: cents((r.rate / 30) * r.minutes),
    label: r.rate === 0 ? "Free parking" : "$" + r.rate.toFixed(2) + " per half hour",
  }));

  // Make the breakdown reconcile: if a cap bit, show it as the discount it is.
  const discount = cents(charged) - lines.reduce((a, l) => a + l.amount, 0);
  if (capApplied && Math.abs(discount) >= 0.01) {
    lines.push({
      rate: null, minutes: 0, from: null, to: null,
      amount: cents(discount),
      label: capApplied === "night"
        ? "Night cap ($" + RATES.caps.night + ")"
        : "Daily cap ($" + dayCap + ")",
    });
  }

  return {
    ...blank,
    total: cents(charged),
    metered: cents(metered),
    free: !anyChargeable,
    capApplied,
    lines,
    unavailable: null,
    couponTotal: coupon ? couponPrice(id, startMin, total, shortTerm, free, holiday, isoFor) : null,
  };
}

// Paper coupons come in half-hour denominations, so an occupied half hour is a
// whole coupon however little of it you use. Parking.sg prices the same stay by
// the minute, which is what `total` reports - both are shown rather than one
// quietly chosen for the driver.
function couponPrice(id, startMin, minutes, shortTerm, free, holiday, isoFor) {
  let sum = 0;
  for (let block = 0; block * 30 < minutes; block++) {
    const tm = startMin + block * 30;
    const day = Math.floor(tm / 1440);
    const mod = tm - day * 1440;
    const dayName = dayNameOf(day);
    const ph = holiday(isoFor(day));
    if (matchesWindow(free, dayName, mod, ph)) continue;
    sum += rateAt(id, dayName, mod, ph);
  }
  return cents(sum);
}

module.exports = {
  RATES, feeFor, rateHalfHourAt, isCentral, hasPeakCharges, carparkNumber,
};
