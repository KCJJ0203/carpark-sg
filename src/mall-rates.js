// What a stay costs at a mall or private carpark, from the rates the carpark
// posts on its own website, transcribed by hand into src/mall-tariffs.js.
//
// WHY A THIRD ENGINE: LTA DataMall publishes the malls' lot counts and nothing
// about price, and private carparks (Keppel Bay Tower, HarbourFront Centre)
// publish nothing to any feed at all. Their rates exist only on their own
// pages, in a shape neither HDB's schedule nor URA's table can express:
//
//   Mon-Fri 7am-5.59pm   $2.14 first hour, $0.54 per subsequent 15 min
//   Mon-Fri 6pm-6.59am   $3.21 per entry
//
// It returns the SAME shape as rates.js#feeFor and ura-rates.js#feeFor so the
// page prices a mixed list without knowing which engine answered.
//
// A TARIFF (one per carpark, see src/mall-tariffs.js):
//   {
//     source: "https://...", read: "2026-11-01",   where and when it was read
//     grace: 10,           a stay this short or shorter is free (null: none posted)
//     cap: 20,             most one stay can cost (optional)
//     dayCap: 15,          most one calendar day of a stay can cost (optional)
//     days: {              bands per kind of day; a string value aliases another
//       wd: [band...],     Mon-Fri
//       fri: [band...],    optional, overrides wd on Fridays
//       sat: [band...], sun: [band...],
//       ph: "sun",         public holidays
//       eve: [band...],    optional, the eve of a public holiday
//     }
//   }
// A BAND: { from: "07:00", to: "18:00", ...one rule }   (to is exclusive and
// may be at or before from, meaning it runs past midnight and the morning part
// belongs to the day it started; "00:00"-"00:00" is one whole calendar day).
// Bands are matched IN ORDER, so a free window listed before a rate overrides
// it; until: "2026-12-31" ends a promotional band after that date.
//   { first: { min: 60, price: 2.14 }, then: { min: 15, price: 0.54 } }
//   { first: [{ min: 60, price: 0 }, { min: 60, price: 1.2 }], then: {...} }
//   { then: { min: 30, price: 1.20 } }        per started unit, no first block
//   { entry: 3.21 }                           flat, once per stay in the band
//   { free: true }
//   { closed: true }                          no parking then: not priceable
// Any rule may add cap: N, the most one stay in that band can cost, and
// dayCap: N, the most one calendar day in that band can cost (Resorts World's
// weekday and weekend caps differ, so a tariff-wide dayCap cannot express it).
//
// TARIFF EXTRAS:
//   firstEachBand: true   the first block restarts in every band the stay
//                         enters (Orchard Gateway: "double charge if your
//                         vehicle is parked across two time slots")
//   surcharges: [{ from, to, price, when: "entry" | "overlap", days }]
//                         a flat add-on (Wisma Atria's lunch surcharge on cars
//                         ENTERING 12-2pm; Paragon's peak surcharge for a stay
//                         that overlaps 11am-3pm). days lists calendar kinds
//                         ("wd" = Mon-Fri, "sat", "sun", "ph"); absent = every day.
//
// DESIGN RULE, inherited from the rest of this project: where the posted rates
// do not say, do not invent. No tariff, a day type with no bands, or a minute
// no band covers all return null and a reason, never $0.
//
// THE ONE THING THE POSTED RATES NEVER SAY: what happens when a stay crosses
// from one band into the next. Malls differ and none of them write it down.
// This engine bills each band for the time spent in it, with the "first hour"
// block only where the car ARRIVED, and every later band from its per-unit
// rate (or its entry charge). The result carries crossed: true so the page can
// call that figure an estimate instead of passing it off as exact.

const DAY_KINDS = ["wd", "fri", "sat", "sun", "ph", "eve"];

function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm)) return null;
  return h * 60 + mm;
}

// Minutes since the epoch in Singapore local time (UTC+8, no DST).
const sgMinutes = (when) => Math.floor((when.getTime() + 8 * 3600 * 1000) / 60000);
const dayOfWeekOf = (dayNumber) => (((dayNumber + 4) % 7) + 7) % 7;   // 1 Jan 1970 was a Thursday
const isoDateOf = (dayNumber) => new Date(dayNumber * 86400000).toISOString().slice(0, 10);
const cents = (n) => Math.round(n * 100) / 100;

function bandsFor(tariff, kind, seen) {
  let v = tariff.days && tariff.days[kind];
  seen = seen || new Set();
  if (typeof v === "string") {
    if (seen.has(v)) return null;   // an alias loop is a broken tariff, not a price
    seen.add(kind);
    return bandsFor(tariff, v, seen);
  }
  return Array.isArray(v) && v.length ? v : null;
}

// Which bands apply on a calendar day. A public holiday beats everything; the
// eve of one beats the weekday; Friday beats Mon-Fri only if it is posted.
function bandsOn(tariff, dayNumber, holiday) {
  const iso = isoDateOf(dayNumber);
  const dow = dayOfWeekOf(dayNumber);
  const order = [];
  if (holiday(iso)) order.push("ph");
  if (holiday(isoDateOf(dayNumber + 1))) order.push("eve");
  if (dow === 0) order.push("sun");
  else if (dow === 6) order.push("sat");
  else { if (dow === 5) order.push("fri"); order.push("wd"); }
  for (const k of order) {
    const b = bandsFor(tariff, k);
    if (b) return b;
  }
  return null;
}

const fromOf = (band) => parseClock(band.from);
const toOf = (band) => parseClock(band.to) % 1440;
// "00:00"-"00:00" (or "24:00") is one calendar day. Any other band whose end is
// at or before its start runs past midnight, and the part after midnight still
// belongs to the day it started on: "Sat 7am-6.59am (next morning)" prices
// Sunday 3am at Saturday's rate.
const wraps = (band) => toOf(band) <= fromOf(band) && !(fromOf(band) === 0 && toOf(band) === 0);

function covers(band, mod) {
  const from = fromOf(band), to = toOf(band);
  if (from === null || to === null) return false;
  if (from === to) return true;                     // all day
  if (to > from) return mod >= from && mod < to;
  return mod >= from || mod < to;                   // runs past midnight
}

// A band with until: "2026-12-31" is a promotion that stops applying after
// that date. Bands are matched in order, so a free window listed first
// overrides the rate it sits inside, and when it expires the rate shows through.
const live = (bands, iso) => bands.filter((b) => !b.until || iso <= b.until);

// Which band prices minute mod of calendar day day, and which day "owns" that
// band occurrence. The previous day's overnight band wins first, then today's
// bands in order (an overnight band of today's only from its start onwards).
function resolve(tariff, day, mod, holiday, cache) {
  const get = (d) => {
    if (!cache.has(d)) {
      const b = bandsOn(tariff, d, holiday);
      cache.set(d, b ? live(b, isoDateOf(d)) : null);
    }
    return cache.get(d);
  };
  const prev = get(day - 1);
  if (prev) {
    for (const b of prev) {
      if (wraps(b) && mod < toOf(b)) return { band: b, owner: day - 1 };
      // An earlier band that covers this minute shadows the overnight one.
      if (!wraps(b) && covers(b, mod)) break;
    }
  }
  const today = get(day);
  if (!today) return null;
  for (const b of today) {
    if (wraps(b) ? mod >= fromOf(b) : covers(b, mod)) return { band: b, owner: day };
  }
  return { band: null, owner: day };
}

// The plain calendar kind of a day, for surcharge rules: no aliases, no eve.
function calendarKind(dayNumber, holiday) {
  if (holiday(isoDateOf(dayNumber))) return "ph";
  const dow = dayOfWeekOf(dayNumber);
  return dow === 0 ? "sun" : dow === 6 ? "sat" : "wd";
}

const blank = (total) => ({
  total: null, free: false, grace: false, capApplied: null, lines: [], couponTotal: null,
  minutes: total, metered: null, method: "electronic", central: false, peak: false,
  unavailable: null, crossed: false, source: null, read: null,
});

const clock = (m) => {
  const h = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, "0");
  return ((h % 12) || 12) + "." + mm + (h < 12 ? "am" : "pm");
};

function bandCost(band, minutes, arrived) {
  if (band.free) return { amount: 0, label: "Free parking" };
  if (band.entry !== undefined) {
    return { amount: band.entry, label: "$" + band.entry.toFixed(2) + " per entry" };
  }
  let amount = 0;
  const parts = [];
  let rest = minutes;
  // first is one block or a list of them (IMM: first hour free, second $1.20).
  const steps = band.first ? [].concat(band.first) : [];
  if (steps.length && arrived) {
    for (const st of steps) {
      if (rest <= 0) break;
      amount += st.price;
      rest = Math.max(0, rest - st.min);
      parts.push((st.price ? "$" + st.price.toFixed(2) : "free") + " for " + st.min + " min");
    }
  }
  if (rest > 0) {
    // Parking is billed per STARTED unit: 16 minutes at "per 15 min" is two.
    const unit = band.then || steps[steps.length - 1];
    const n = Math.ceil(rest / unit.min);
    amount += n * unit.price;
    parts.push(n + " x $" + unit.price.toFixed(2) + " per " + unit.min + " min");
  }
  let label = parts.join(" + ");
  if (band.cap !== undefined && amount > band.cap) {
    amount = band.cap;
    label += ", capped at $" + band.cap.toFixed(2);
  }
  return { amount, label };
}

// tariff: an entry from src/mall-tariffs.js
// start: Date the car enters; minutes: how long it stays
// isHoliday: (isoDate) => boolean
function feeFor(tariff, start, minutes, isHoliday) {
  const holiday = typeof isHoliday === "function" ? isHoliday : () => false;
  const total = Math.max(0, Math.round(minutes));
  const out = blank(total);
  if (!tariff) return { ...out, unavailable: "source-has-no-rates" };
  out.source = tariff.source || null;
  out.read = tariff.read || null;
  if (!total) return { ...out, total: 0, free: true };
  if (tariff.grace && total <= tariff.grace) {
    return { ...out, total: 0, free: true, grace: true,
      lines: [{ rate: 0, minutes: total, from: start, to: new Date(start.getTime() + total * 60000),
        amount: 0, label: "Free within the " + tariff.grace + "-minute grace period" }] };
  }

  // Walk the stay a minute at a time and cut it into RUNS, one per stretch in
  // one band. A band that runs past midnight stays one run across it (one
  // night, one entry charge) even though the calendar day changes underneath.
  const startMin = sgMinutes(start);
  const runs = [];
  let cur = null;
  const cache = new Map();
  for (let m = 0; m < total; m++) {
    const tm = startMin + m;
    const day = Math.floor(tm / 1440);
    const mod = tm - day * 1440;
    const r = resolve(tariff, day, mod, holiday, cache);
    if (!r) return { ...out, unavailable: "rate-not-published" };
    if (!r.band) return { ...out, unavailable: "rate-not-published" };
    if (r.band.closed) return { ...out, unavailable: "closed" };
    // Hours the carpark's own rates do not cover. Not closed, not free: we do
    // not know, so a stay that touches them is not priced at all.
    if (r.band.unknown) return { ...out, unavailable: "rate-not-published" };
    if (cur && cur.band === r.band && cur.owner === r.owner) { cur.minutes++; continue; }
    cur = { band: r.band, owner: r.owner, minutes: 1, startMinute: tm, day };
    runs.push(cur);
  }

  let charged = 0;
  const lines = [];
  const perDay = new Map();
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const c = bandCost(r.band, r.minutes, i === 0 || !!tariff.firstEachBand);
    charged += c.amount;
    const pd = perDay.get(r.day) || { amount: 0, cap: undefined };
    pd.amount += c.amount;
    if (pd.cap === undefined && r.band.dayCap !== undefined) pd.cap = r.band.dayCap;
    perDay.set(r.day, pd);
    lines.push({
      rate: r.band.free ? 0 : null,
      minutes: r.minutes,
      from: new Date((r.startMinute - 8 * 60) * 60000),
      to: new Date((r.startMinute + r.minutes - 8 * 60) * 60000),
      amount: cents(c.amount),
      label: c.label + " (" + clock(parseClock(r.band.from)) + "-" + clock(parseClock(r.band.to) % 1440) + ")",
    });
  }

  const metered = charged;
  let capApplied = null;
  {
    let capped = 0, capLabel = null;
    for (const v of perDay.values()) {
      const cap = v.cap !== undefined ? v.cap : tariff.dayCap;
      if (cap !== undefined && v.amount > cap) { capped += cap; capLabel = capLabel || cap; }
      else capped += v.amount;
    }
    if (capped < charged) {
      lines.push({ rate: null, minutes: 0, from: null, to: null, amount: cents(capped - charged),
        label: "Daily cap, $" + capLabel.toFixed(2) + " a day" });
      charged = capped;
      capApplied = "day";
    }
  }

  // Surcharges are added after the caps: both malls that post one describe it
  // as "in addition to" the parking charge.
  for (const sc of tariff.surcharges || []) {
    const from = parseClock(sc.from), to = parseClock(sc.to);
    const hits = new Set();
    for (let m = 0; m < (sc.when === "entry" ? 1 : total); m++) {
      const tm = startMin + m;
      const day = Math.floor(tm / 1440);
      const mod = tm - day * 1440;
      if (mod < from || mod >= to) continue;
      if (sc.days && !sc.days.includes(calendarKind(day, holiday))) continue;
      hits.add(day);
    }
    for (const day of hits) {
      charged += sc.price;
      lines.push({ rate: null, minutes: 0, from: null, to: null, amount: cents(sc.price),
        label: (sc.label || "Surcharge") + ", $" + sc.price.toFixed(2) });
    }
  }
  if (tariff.cap !== undefined && charged > tariff.cap) {
    lines.push({ rate: null, minutes: 0, from: null, to: null, amount: cents(tariff.cap - charged),
      label: "Capped at $" + tariff.cap.toFixed(2) + " per entry" });
    charged = tariff.cap;
    capApplied = "entry";
  }

  // A carpark that posts its rates before GST ("subject to prevailing GST").
  // What the driver pays includes it, so it is added once, to the total; how
  // the machine rounds each charge is not posted, so the result can differ by
  // a cent or two, and the page says so.
  if (tariff.gst && charged > 0) {
    const tax = charged * tariff.gst;
    lines.push({ rate: null, minutes: 0, from: null, to: null, amount: cents(tax),
      label: "GST at " + Math.round(tariff.gst * 100) + "%, added to the posted rates" });
    charged += tax;
  }

  return {
    ...out,
    total: cents(charged),
    metered: cents(metered),
    free: charged === 0,
    capApplied,
    lines,
    crossed: runs.length > 1,
  };
}

// Checks a tariff is something this engine can read, so a typo in
// mall-tariffs.js fails the build instead of quietly mispricing one mall.
function validate(id, t) {
  const bad = (why) => { throw new Error("tariff " + id + ": " + why); };
  if (!t || typeof t !== "object") bad("not an object");
  if (!/^https?:\/\//.test(t.source || "")) bad("no source URL");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.read || "")) bad("no read date");
  if (!t.days || !Object.keys(t.days).length) bad("no days");
  for (const [k, v] of Object.entries(t.days)) {
    if (!DAY_KINDS.includes(k)) bad("unknown day kind " + k);
    if (typeof v === "string") { if (!DAY_KINDS.includes(v)) bad(k + " aliases unknown " + v); continue; }
    if (!Array.isArray(v) || !v.length) bad(k + " has no bands");
    for (const b of v) {
      if (parseClock(b.from) === null || parseClock(b.to) === null) bad(k + " band has a bad time");
      const kinds = ["first", "then", "entry", "free", "closed", "unknown"].filter((x) => b[x] !== undefined);
      if (!kinds.length) bad(k + " " + b.from + " band has no rule");
      if (b.entry !== undefined && (b.first || b.then)) bad(k + " " + b.from + " mixes entry and per-unit");
      if (b.until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(b.until)) bad(k + " " + b.from + " until is not a date");
      for (const u of [].concat(b.first || [], b.then || [])) {
        if (u && !(u.min > 0 && u.price >= 0)) bad(k + " " + b.from + " unit needs min > 0 and a price");
      }
    }
    // Every minute of the day has to be covered, or a stay will hit a gap.
    for (let mod = 0; mod < 1440; mod++) {
      if (!v.filter((b) => !b.until).some((b) => covers(b, mod))) bad(k + " leaves " + clock(mod) + " uncovered");
    }
  }
  if (t.gst !== undefined && !(t.gst > 0 && t.gst < 0.2)) bad("gst must be a fraction such as 0.09");
  for (const sc of t.surcharges || []) {
    if (parseClock(sc.from) === null || parseClock(sc.to) === null) bad("surcharge has a bad time");
    if (!(sc.price > 0)) bad("surcharge needs a price");
    if (sc.when !== "entry" && sc.when !== "overlap") bad("surcharge when must be entry or overlap");
    for (const d of sc.days || []) if (!["wd", "sat", "sun", "ph"].includes(d)) bad("surcharge day " + d);
  }
  return true;
}

module.exports = { feeFor, validate, parseClock, bandsOn, covers, resolve };
