// Parses HDB's prose parking windows into something a computer can answer
// "is it free right now?" with.
//
// The dataset writes these as English: "SUN & PH FR 7AM-10.30PM", "WHOLE DAY",
// "NO". Times are minutes from midnight so comparisons are plain integers.
//
// DESIGN RULE: wording we do not recognise returns NO windows, i.e. "not free".
// Guessing in the other direction tells someone parking is free when it is not,
// and they get a fine. Being wrong in the safe direction costs them nothing.

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// "7AM" -> 420, "10.30PM" -> 1350, "12AM" -> 0, "12PM" -> 720.
// 12AM/12PM is the classic off-by-twelve bug: 12 means 0 in the morning and
// stays 12 in the afternoon, unlike every other hour.
function parseTime(raw) {
  const m = String(raw).trim().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const pm = m[3].toUpperCase() === "PM";
  if (h < 1 || h > 12 || mins > 59) return null;
  if (h === 12) h = 0;
  if (pm) h += 12;
  return h * 60 + mins;
}

function parseWindow(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s || s === "NO") return [];
  if (s === "WHOLE DAY") return [{ days: ["ALL"], from: 0, to: 1440 }];

  // Optional day prefix, then a time range: "SUN & PH FR 7AM-10.30PM".
  // "FR" is HDB's abbreviation for FROM, not Friday.
  const m = s.match(/^(?:(.+?)\s+FR\s+)?(\d{1,2}(?:[.:]\d{2})?\s*[AP]M)\s*-\s*(\d{1,2}(?:[.:]\d{2})?\s*[AP]M)$/);
  if (!m) return [];

  const from = parseTime(m[2]);
  const to = parseTime(m[3]);
  if (from === null || to === null || to <= from) return [];

  let days = ["ALL"];
  if (m[1]) {
    const tokens = m[1].split(/\s*&\s*|\s*,\s*/).map((t) => t.trim());
    const known = tokens.map((t) => (t === "PH" || DAY_NAMES.includes(t) ? t : null));
    // One unrecognised day token invalidates the whole window rather than
    // silently dropping it - a partial reading is worse than none.
    if (known.some((k) => k === null)) return [];
    days = known;
  }
  return [{ days, from, to }];
}

// The predicate itself, in the terms the windows are stored in: a day name and
// minutes past midnight. src/rates.js walks a stay a minute at a time and needs
// to ask this thousands of times without building a Date for each one, so the
// comparison lives here once rather than being reimplemented there.
function matchesWindow(windows, dayName, minutes, isPublicHoliday) {
  if (!Array.isArray(windows) || !windows.length) return false;
  return windows.some((w) => {
    const dayMatches =
      w.days.includes("ALL") ||
      w.days.includes(dayName) ||
      (isPublicHoliday && w.days.includes("PH"));
    return dayMatches && minutes >= w.from && minutes < w.to;
  });
}

// `isPublicHoliday` is passed in rather than looked up here: a public holiday
// falling on a weekday is exactly the case a day-of-week check gets wrong, and
// the holiday calendar is a separate concern with its own update schedule.
function isFreeAt(windows, when, isPublicHoliday) {
  // Singapore is UTC+8 with no daylight saving, so local time is deterministic.
  const sg = new Date(when.getTime() + 8 * 3600 * 1000);
  return matchesWindow(
    windows,
    DAY_NAMES[sg.getUTCDay()],
    sg.getUTCHours() * 60 + sg.getUTCMinutes(),
    isPublicHoliday
  );
}

module.exports = { parseWindow, isFreeAt, matchesWindow, parseTime, DAY_NAMES };
