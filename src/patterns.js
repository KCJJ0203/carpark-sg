// Turns collected history into "how full is this carpark usually, at this hour?"
//
// Pure and offline. The collector gathers; this only ever reads.

// Three day types, 24 hours each.
//
// Carparks behave completely differently by day type. An HDB residential
// carpark is packed overnight and empty at 10am on a WEEKDAY, and still packed
// at 10am on a Sunday. Averaging those together describes neither. Public
// holidays go with Sunday: people are at home and most HDB parking is free,
// so a holiday looks nothing like the Tuesday it happens to fall on.
const DAY_TYPES = 3;
const HOURS = 24;
const BUCKETS = DAY_TYPES * HOURS;

// Below this many readings a bucket stays unpublished. Three points is a
// coincidence, not a pattern, and a confident-looking chart drawn from two
// samples is worse than an honest blank.
const MIN_SAMPLES = 5;

function bucketFor(when, isPublicHoliday) {
  // Singapore is UTC+8 with no daylight saving.
  const sg = new Date(when.getTime() + 8 * 3600 * 1000);
  const dow = sg.getUTCDay();
  const hour = sg.getUTCHours();
  const type = isPublicHoliday || dow === 0 ? 2 : dow === 6 ? 1 : 0;
  return type * HOURS + hour;
}

// snapshots: decoded lines from the history files.
// isHoliday: (isoDate) => boolean, injected so the calendar stays a separate
// concern with its own refresh schedule.
function accumulate(snapshots, isHoliday) {
  const out = {};
  for (const snap of snapshots) {
    const when = new Date(snap.t);
    if (isNaN(when)) continue;
    const sgDate = new Date(when.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const bucket = bucketFor(when, isHoliday(sgDate));

    for (const [id, type, total, available] of snap.r || []) {
      // Car lots only: motorcycle bays being empty says nothing about whether a
      // driver will find a space.
      if (type !== "C") continue;
      // A total of 0 means the carpark was not reporting, not that it was full.
      if (!total || available === null || available === undefined) continue;

      if (!out[id]) out[id] = Array.from({ length: BUCKETS }, () => ({ sum: 0, count: 0 }));
      out[id][bucket].sum += available / total;
      out[id][bucket].count += 1;
    }
  }
  return out;
}

// One character per bucket: "0".."9" for the proportion of lots typically free,
// in deciles, or "-" for not enough data. 72 characters per carpark keeps the
// whole country's patterns small enough to ship to a phone.
function encode(buckets) {
  let s = "";
  for (const b of buckets) {
    if (!b || b.count < MIN_SAMPLES) { s += "-"; continue; }
    const mean = b.sum / b.count;
    s += String(Math.max(0, Math.min(9, Math.round(mean * 9))));
  }
  return s;
}

function typical(pattern, bucket) {
  const ch = pattern && pattern[bucket];
  if (!ch || ch === "-") return { known: false, available: null };
  return { known: true, available: Number(ch) / 9 };
}

module.exports = { bucketFor, accumulate, encode, typical, BUCKETS, HOURS, MIN_SAMPLES };
