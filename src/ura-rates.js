// What a stay costs at a URA carpark, from URA's own published rate table.
//
// WHY THIS IS NOT src/rates.js: HDB's schedule is one national table that had
// to be transcribed off a web page. URA's arrives as data - every carpark
// carries its own windows and prices in Car_Park_Details - so this engine is
// driven entirely by the carpark record and hard-codes no price at all. That
// is a strictly better position, and the reason the spec said to give each
// adapter its own feeFor rather than grow one global table.
//
// It returns the SAME shape as rates.js#feeFor so the page can price a mixed
// list of HDB and URA carparks without knowing which is which.
//
// DESIGN RULE, inherited from the rest of this project: where the data does
// not say, do not invent. A stay we cannot price returns null and a reason,
// never $0.

// URA writes times as "07.00 AM" / "10.30 PM", and a window whose end is at or
// before its start wraps past midnight ("10.30 PM" - "07.00 AM").
function parseTime(s) {
  const m = /^(\d{1,2})\.(\d{2})\s*(AM|PM)$/i.exec(String(s || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 12 || mm > 59) return null;
  const h = (hh % 12) + (/PM/i.test(m[3]) ? 12 : 0);
  return h * 60 + mm;
}

const money = (s) => {
  if (s === undefined || s === null) return null;
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return isFinite(n) ? n : null;
};

const unitMinutes = (s) => {
  if (s === undefined || s === null) return null;
  const n = Number(String(s).replace(/\s*mins?\s*$/i, ""));
  return isFinite(n) ? n : null;
};

const DAY_KEYS = ["wd", "sat", "sun"];

// Which of URA's three rate columns applies. Public holidays are priced as
// Sunday because that is the column URA labels "sunPH".
function dayKey(dayOfWeek, isPublicHoliday) {
  if (isPublicHoliday || dayOfWeek === 0) return "sun";
  return dayOfWeek === 6 ? "sat" : "wd";
}

const COLUMNS = {
  wd: ["weekdayRate", "weekdayMin"],
  sat: ["satdayRate", "satdayMin"],
  sun: ["sunPHRate", "sunPHMin"],
};

// Turn the rows Car_Park_Details gives for ONE carpark into a table this
// engine can walk. Rows are grouped by their time window; a window may carry
// two rows, and the second is not a second rate:
//
//   ANGULLIA PARK OFF ST, 10.30 PM - 07.00 AM
//     $0.70 / 30 mins     <- what it accrues at
//     $5.60 / 510 mins    <- 510 min IS the window, so this is the whole night
//
// Charging 17 half hours would bill $11.90 for a night URA sells at $5.60.
// The rule below - a row whose charging unit equals the window length is a
// flat price for that window - was checked against every such pair in the
// live data: 146 of 146, and in all 146 the flat price is the cheaper one.
function parseRateTable(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const from = parseTime(r.startTime);
    const to = parseTime(r.endTime);
    if (from === null || to === null) continue;
    const key = from + "-" + to;
    if (!groups.has(key)) groups.set(key, { from, to, rows: [] });
    groups.get(key).rows.push(r);
  }

  const windows = [];
  for (const g of groups.values()) {
    const span = g.to > g.from ? g.to - g.from : g.to + 1440 - g.from;
    const w = { from: g.from, to: g.to, span, wd: null, sat: null, sun: null };

    for (const key of DAY_KEYS) {
      const [rateField, minField] = COLUMNS[key];
      let unitRate = null;
      let flat = null;
      for (const r of g.rows) {
        const price = money(r[rateField]);
        const unit = unitMinutes(r[minField]);
        // Absent, not zero. URA writes an explicit "$0.00 / 0 mins" where
        // parking really is free, so a row with no rate fields at all means
        // something else - and both candidate meanings (free, or no parking
        // allowed) cannot be told apart from here. Neither is assumed.
        if (price === null || unit === null) continue;
        if (unit === 0 || price === 0) { unitRate = { rate: 0, unit: 30 }; continue; }
        if (unit === span) flat = price;
        else unitRate = { rate: price, unit };
      }
      if (unitRate) w[key] = { rate: unitRate.rate, unit: unitRate.unit, flat };
    }
    windows.push(w);
  }

  windows.sort((a, b) => a.from - b.from);
  return windows;
}

function covers(w, minuteOfDay) {
  if (w.to > w.from) return minuteOfDay >= w.from && minuteOfDay < w.to;
  return minuteOfDay >= w.from || minuteOfDay < w.to;   // wraps past midnight
}

function windowAt(windows, minuteOfDay) {
  for (let i = 0; i < windows.length; i++) if (covers(windows[i], minuteOfDay)) return i;
  return -1;
}

// Minutes since the Unix epoch in Singapore local time. Singapore is UTC+8
// with no daylight saving, so this is exact and needs no timezone library.
function sgMinutes(when) {
  return Math.floor((when.getTime() + 8 * 3600 * 1000) / 60000);
}

// 1 January 1970 was a Thursday, so day 0 is weekday 4.
const dayOfWeekOf = (dayNumber) => (((dayNumber + 4) % 7) + 7) % 7;
const isoDateOf = (dayNumber) => new Date(dayNumber * 86400000).toISOString().slice(0, 10);
const cents = (n) => Math.round(n * 100) / 100;

// carpark needs: id, parkingSystem ("C" coupon / "B" electronic), rates
//   (the windows produced by parseRateTable)
// start:   a Date, the moment the car enters
// minutes: how long it stays
// isHoliday: (isoDate) => boolean
function feeFor(carpark, start, minutes, isHoliday) {
  const holiday = typeof isHoliday === "function" ? isHoliday : () => false;
  const total = Math.max(0, Math.round(minutes));
  const windows = (carpark && carpark.rates) || [];
  // The adapter normalises URA's "C"/"B" into the same wording HDB uses, so
  // both rate engines test one vocabulary.
  const coupon = /COUPON/i.test(String((carpark && carpark.parkingSystem) || ""));

  const blank = {
    total: null, free: false, grace: false, capApplied: null,
    lines: [], couponTotal: null, minutes: total, metered: null,
    method: coupon ? "coupon" : "electronic",
    central: false, peak: false, unavailable: null,
  };

  if (!windows.length) return { ...blank, unavailable: "no-rates" };
  if (!total) return { ...blank, total: 0 };

  const startMin = sgMinutes(start);
  const isoCache = new Map();
  const isoFor = (day) => {
    if (!isoCache.has(day)) isoCache.set(day, isoDateOf(day));
    return isoCache.get(day);
  };

  // One pass over the stay, kept at two levels.
  //
  // An OCCURRENCE is one contiguous stay inside a single window, and it is what
  // the flat price caps: staying a whole night buys the night, staying an hour
  // of it does not. Every one of the 152 flat rows in the live data covers a
  // window that crosses midnight, so grouping by calendar day instead would
  // break the cap on every stay beginning on a Saturday or a holiday eve and
  // silently overcharge for it.
  //
  // A RUN is a stretch within an occurrence that shares one rate. Runs exist
  // because the rate column changes at midnight (Saturday's rate is not
  // Sunday's), so they keep the accrual honest and give the breakdown its
  // line items - but they never carry the cap.
  const occurrences = [];
  let anyChargeable = false;

  for (let m = 0; m < total; m++) {
    const tm = startMin + m;
    const day = Math.floor(tm / 1440);
    const mod = tm - day * 1440;
    const key = dayKey(dayOfWeekOf(day), holiday(isoFor(day)));

    const wi = windowAt(windows, mod);
    // The windows tile all 1,440 minutes for every carpark in the live data,
    // so a miss means this carpark's table is malformed rather than that the
    // driver has found a gap. Either way it cannot be priced.
    if (wi === -1) return { ...blank, unavailable: "rate-not-published" };

    const spec = windows[wi][key];
    // No rate published for this window on this kind of day. In the live data
    // this is always an on-street carpark overnight or in the morning peak -
    // it may mean free, it may mean no parking at all, and guessing "free" is
    // the guess that earns a fine.
    if (!spec) return { ...blank, unavailable: "rate-not-published" };
    if (spec.rate > 0) anyChargeable = true;

    let occ = occurrences[occurrences.length - 1];
    if (!occ || occ.wi !== wi) {
      // The flat price is read at the moment the car arrives, the way a driver
      // would understand buying the night. The live data shows no flat that
      // differs between weekday, Saturday and Sunday, so this choice is not
      // currently load-bearing - but it has to be made explicitly.
      occ = { wi, flat: spec.flat, runs: [] };
      occurrences.push(occ);
    }
    const last = occ.runs[occ.runs.length - 1];
    if (last && last.spec === spec) last.minutes++;
    else occ.runs.push({ spec, minutes: 1, startMinute: tm });
  }

  let metered = 0;
  let charged = 0;
  let capApplied = null;
  for (const occ of occurrences) {
    occ.accrued = occ.runs.reduce((a, r) => a + (r.spec.rate / r.spec.unit) * r.minutes, 0);
    metered += occ.accrued;
    if (occ.flat !== null && occ.flat !== undefined && occ.accrued > occ.flat) {
      occ.charged = occ.flat;
      capApplied = "window";
    } else {
      occ.charged = occ.accrued;
    }
    charged += occ.charged;
  }

  // Line items are the runs at what they accrued, and a capped occurrence adds
  // the cap as the discount it is - so the breakdown adds up to the total
  // rather than asking the reader to take the total on trust.
  const lines = [];
  for (const occ of occurrences) {
    for (const r of occ.runs) {
      lines.push({
        rate: r.spec.rate,
        minutes: r.minutes,
        from: new Date((r.startMinute - 8 * 60) * 60000),
        to: new Date((r.startMinute + r.minutes - 8 * 60) * 60000),
        amount: cents((r.spec.rate / r.spec.unit) * r.minutes),
        label: r.spec.rate === 0
          ? "Free parking"
          : "$" + r.spec.rate.toFixed(2) + " per " + r.spec.unit + " min",
      });
    }
    if (occ.charged !== occ.accrued) {
      lines.push({
        rate: null, minutes: 0, from: null, to: null,
        amount: cents(occ.charged - occ.accrued),
        label: capLabel(windows[occ.wi], occ.flat),
      });
    }
  }

  return {
    ...blank,
    total: cents(charged),
    metered: cents(metered),
    free: !anyChargeable,
    capApplied,
    lines,
    couponTotal: coupon ? couponPrice(occurrences) : null,
  };
}

const clock = (m) => {
  const h = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  const ampm = h < 12 ? "am" : "pm";
  return ((h % 12) || 12) + "." + mm + ampm;
};

function capLabel(w, flat) {
  const whole = w.to <= w.from ? "night" : "period";
  return "Whole-" + whole + " rate, " + clock(w.from) + "-" + clock(w.to) +
    " ($" + flat.toFixed(2) + ")";
}

// A paper coupon buys a whole charging block however little of it you use, so
// an occupied block is a whole coupon. Shown alongside the by-the-minute figure
// rather than one being quietly chosen for the driver. The flat price caps a
// coupon stay too - you would simply not display more coupons than that.
function couponPrice(occurrences) {
  let sum = 0;
  for (const occ of occurrences) {
    let blocks = 0;
    for (const r of occ.runs) {
      if (!r.spec.rate) continue;
      blocks += Math.ceil(r.minutes / r.spec.unit) * r.spec.rate;
    }
    sum += occ.flat !== null && occ.flat !== undefined ? Math.min(blocks, occ.flat) : blocks;
  }
  return cents(sum);
}

module.exports = { parseRateTable, feeFor, parseTime, dayKey, windowAt, covers };
