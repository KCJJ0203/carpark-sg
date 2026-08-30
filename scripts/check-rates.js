// Re-reads HDB's published rate schedule and fails if it no longer matches
// what src/rates.js has pinned.
//
//   node scripts/check-rates.js
//
// WHY: there is no parking-rate dataset anywhere, so the rates in this repo are
// transcribed from a web page. Transcribed numbers rot silently - a rate rises,
// a carpark joins the peak-hour list, and the app keeps confidently quoting
// last year's price. This is the alarm. It does not update anything by itself,
// because a rate change deserves a human reading the page.
//
// HDB's server returns 403 to plain HTTP clients and the page is rendered by
// JavaScript, so this drives a real browser. It runs monthly, not on every
// build: it is a watchdog on someone else's website, and hammering it would be
// rude as well as pointless.

const { chromium } = require("playwright");
const { RATES } = require("../src/rates");

const CHARGES = RATES.source;
const EPS = "https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/electronic-parking";

// What the page said when these rates were transcribed. Compared verbatim
// rather than re-parsed: the point is to notice ANY change and send a human to
// look, not to be clever about which changes matter.
const EXPECTED_PEAK_PERIODS = {
  ACB: "weekdays, 10:00am to 6:00pm; weekends, 8:00am to 7:00pm",
  CY: "weekdays, 10:00am to 6:00pm; weekends, 8:00am to 7:00pm",
  SE21: "monday to saturday, 10:00am to 10:00pm",
  SE22: "monday to saturday, 10:00am to 10:00pm",
  SE24: "daily, 10:00am to 10:00pm",
  MP14: "daily, 8:00am to 8:00pm",
  MP15: "daily, 8:00am to 8:00pm",
  MP16: "daily, 8:00am to 8:00pm",
  HG9: "weekdays, 11:00am to 8:00pm weekends, 9:00am to 8:00pm",
  HG9T: "weekdays, 11:00am to 8:00pm weekends, 9:00am to 8:00pm",
  HG15: "weekdays, 11:00am to 8:00pm weekends, 9:00am to 8:00pm",
  HG16: "weekdays, 11:00am to 8:00pm weekends, 9:00am to 8:00pm",
};

// Sentences the rate engine depends on being true. Written out in HDB's own
// words so a diff against the page is a diff a person can read.
const EXPECTED_PHRASES = [
  ["standard rate", "$0.60 per half-hour"],
  ["Central Area rate", "$1.20 per half-hour"],
  ["peak rate outside Central", "$0.80 per half-hour"],
  ["peak rate within Central", "$1.40 per half-hour"],
  ["Central Area window", "(7:00am to 5:00pm, Monday to Saturday)"],
  ["night cap", "capped at $5 per night from 10:30pm to 7:00am"],
  ["daily caps", "capped at $12 in non-Central Areas, and $20 in Central Areas"],
  ["caps excluded at peak carparks",
    "these caps do not apply to car parks with peak hour parking charges"],
];

function scrape() {
  const norm = (s) => String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const out = { central: [], peak: [], peakPeriods: {} };

  for (const t of document.querySelectorAll("table")) {
    const rows = [...t.querySelectorAll("tr")].map((r) =>
      [...r.querySelectorAll("th,td")].map((c) => norm(c.innerText)));
    if (!rows.length) continue;
    const head = rows[0].join(" | ").toLowerCase();
    if (!head.includes("car park number")) continue;
    // Loading/unloading bays are priced separately and are not carparks.
    if (head.includes("loading")) continue;

    const body = rows.slice(1).filter((r) => r.length && /^[A-Z0-9]{2,6}$/.test(r[0]));
    if (head.includes("peak period")) {
      out.peak = body.map((r) => r[0]);
      for (const r of body) if (r.length >= 3) out.peakPeriods[r[0]] = r[2].toLowerCase();
    } else {
      out.central = body.map((r) => r[0]);
    }
  }

  out.text = norm(document.body.innerText);
  out.updated = (out.text.match(/Last updated (\d{1,2} \w+ \d{4})/) || [])[1] || null;
  return out;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Opens a page and refuses to report on it unless it is demonstrably the page
// we meant to read.
//
// WHY: without this the script cannot tell "HDB blocked me" from "HDB changed
// the rates". An empty page fails every single check at once and reports twelve
// confident findings, all false. That is worse than no check - it is a monthly
// alarm that means nothing, which is an alarm nobody reads. A landmark that has
// to be present turns a blocked page into "could not read" (exit 2, a warning)
// instead of "everything changed" (exit 1, an alarm).
async function open(page, url, landmark) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  const seen = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    length: document.body.innerText.length,
    sample: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 200),
  }));
  if (!seen.sample.includes(landmark) &&
      !(await page.evaluate((l) => document.body.innerText.includes(l), landmark))) {
    throw new Error(
      "the page did not contain " + JSON.stringify(landmark) + ", so it is not the " +
      "rate schedule and nothing can be concluded from it.\n" +
      "    url    : " + seen.href + "\n" +
      "    title  : " + JSON.stringify(seen.title) + "\n" +
      "    length : " + seen.length + " characters\n" +
      "    starts : " + JSON.stringify(seen.sample)
    );
  }
}

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  try {
    const page = await browser.newPage();

    await open(page, CHARGES, "Short-term parking charges for motor cars");
    const got = await page.evaluate(scrape);

    for (const [what, phrase] of EXPECTED_PHRASES) {
      if (!got.text.includes(phrase)) problems.push(what + ': HDB no longer says "' + phrase + '"');
    }

    const central = [...RATES.centralArea].sort();
    if (!same([...got.central].sort(), central)) {
      problems.push("Central Area list changed.\n    pinned: " + central.join(", ") +
        "\n    page  : " + [...got.central].sort().join(", "));
    }

    const peak = Object.keys(RATES.peakHour).sort();
    if (!same([...got.peak].sort(), peak)) {
      problems.push("Peak-hour list changed.\n    pinned: " + peak.join(", ") +
        "\n    page  : " + [...got.peak].sort().join(", "));
    }

    for (const id of Object.keys(EXPECTED_PEAK_PERIODS)) {
      const seen = got.peakPeriods[id];
      if (seen === undefined) continue; // already reported by the list check
      if (seen !== EXPECTED_PEAK_PERIODS[id]) {
        problems.push("Peak period for " + id + " changed.\n    pinned: " +
          EXPECTED_PEAK_PERIODS[id] + "\n    page  : " + seen);
      }
    }

    await open(page, EPS, "Calculation of parking charges");
    const eps = await page.evaluate(() =>
      document.body.innerText.replace(/ /g, " ").replace(/\s+/g, " ").trim());
    if (!eps.includes("15-minute grace period")) {
      problems.push("grace period: the electronic parking page no longer says 15 minutes");
    }
    if (!eps.includes("calculated on a per-minute basis")) {
      problems.push("per-minute charging: the electronic parking page no longer says so");
    }

    console.log("HDB page last updated :", got.updated || "(not stated)");
    console.log("rates pinned on       :", RATES.checkedOn, "(page said " + RATES.publishedOn + ")");
    console.log("Central Area carparks :", got.central.length);
    console.log("peak-hour carparks    :", got.peak.length);
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.error("\nHDB's published rates no longer match what this repo has pinned:\n");
    problems.forEach((p, i) => console.error("  " + (i + 1) + ". " + p));
    console.error("\nRead " + CHARGES + ", update src/rates.js and the expectations in this\n" +
      "script, then move RATES.checkedOn to today. Do not guess at the new numbers.");
    process.exit(1);
  }
  console.log("\nEverything still matches.");
})().catch((e) => {
  // A site being down is not a rate change. Say which happened.
  console.error("Could not check the rates: " + e.message);
  process.exit(2);
});
