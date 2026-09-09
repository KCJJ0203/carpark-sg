// Compact on-disk format for availability history.
//
// The obvious format - one JSON object per carpark per reading - costs about
// 300KB per snapshot, which is 14MB a day and 420MB a month for data whose
// whole purpose is to be aggregated into "usually full at 7pm". This stores one
// LINE per snapshot instead, with each carpark as a short tuple:
//
//   {"t":"<iso>","r":[["hdb:HE12","C",105,31,1], ...]}
//     id, lot type, total, available, minutes stale at capture
//
// `total` may be null: URA reports how many lots are free and never how many
// exist. `available` may be null too, for a carpark that is listed but silent.
// A row where both are null is not stored at all.
//
// Keys and the timestamp are written once per snapshot rather than 2,000 times.
// The staleness figure survives because it is what tells the UI whether a
// number can be trusted, and it becomes a small integer instead of a repeated
// ISO string.

// Singapore is UTC+8 with no daylight saving, so a bare local timestamp from
// the feed is unambiguous once the offset is stated.
function ageMinutes(at, now) {
  if (!at) return null;
  const t = new Date(at + "+08:00").getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}

function encodeSnapshot(now, records) {
  const rows = [];
  for (const r of records) {
    for (const lot of r.lots || []) {
      const noTotal = lot.total === null || lot.total === undefined;
      const noCount = lot.available === null || lot.available === undefined;
      // A row that says nothing at all is a row that can only ever be filtered
      // back out again.
      //
      // A null TOTAL on its own is different, and became so when URA arrived:
      // URA reports how many lots are free and never how many exist, so a
      // reading of "95 free, total unknown" is real information about a real
      // carpark. It cannot become "40% free" - and src/patterns.js still skips
      // it for exactly that reason - but a proportion is not the only thing
      // history is for, and readings are the one thing that cannot be
      // collected later. Storing it costs a few bytes; not storing it loses
      // the day for good. URA's own parkCapacity is NOT used to fill the gap:
      // three carparks in a live sample reported more lots free than their
      // stated capacity, so the two figures do not describe the same thing.
      if (noTotal && noCount) continue;
      rows.push([r.id, lot.type, noTotal ? null : lot.total, noCount ? null : lot.available,
        ageMinutes(r.at, now)]);
    }
  }
  if (!rows.length) return null;
  return JSON.stringify({ t: now.toISOString(), r: rows });
}

function decodeSnapshot(line) {
  const t = line.t;
  return (line.r || []).map(([id, type, total, available, age]) => ({
    id,
    type,
    total,
    available,
    ageMinutes: age,
    at: t,
  }));
}

module.exports = { encodeSnapshot, decodeSnapshot, ageMinutes };
