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
      // A null total means the carpark is not reporting. Storing it would be a
      // row that can only ever be filtered back out.
      if (lot.total === null || lot.total === undefined) continue;
      rows.push([r.id, lot.type, lot.total, lot.available, ageMinutes(r.at, now)]);
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
