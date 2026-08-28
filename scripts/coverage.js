// How much history did we actually collect, and when?
//
//   node scripts/coverage.js
//
// WHY THIS EXISTS: the collector reported "success" on every run while quietly
// dropping from 26 snapshots a day to 3, because GitHub's scheduler stopped
// dispatching it on time. Every check that had been run - the task exits 0, the
// workflow is green, the last five runs succeeded - was true and useless. This
// is the check that would have caught it: not "did collection happen" but
// "what shape is the data we ended up with".
//
// It is the same lesson the README already records about the sleeping PC,
// learned a second time, so this time it is a script rather than a paragraph.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const HISTORY = path.join(__dirname, "..", "data", "history");

// A day of even half-hourly sampling. Anything near this is healthy.
const IDEAL_PER_DAY = 48;
// Below this the day is too thin to be worth much, and worth saying so about.
const THIN_PER_DAY = 24;
// Hours of the day that must be represented before a day counts as unbiased.
const GOOD_HOURS = 20;

function readDay(file) {
  const text = file.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")
    : fs.readFileSync(file, "utf8");
  const times = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const t = new Date(JSON.parse(line).t);
      if (!isNaN(t)) times.push(t);
    } catch (e) { /* a torn final line, skip it */ }
  }
  return times;
}

function main() {
  if (!fs.existsSync(HISTORY)) {
    console.log("No history collected yet.");
    return;
  }
  const files = fs.readdirSync(HISTORY)
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".jsonl.gz")).sort();

  const days = [];
  for (const name of files) {
    const times = readDay(path.join(HISTORY, name));
    // Singapore hours: the buckets the patterns are keyed on.
    const hours = new Set(times.map((t) => new Date(t.getTime() + 8 * 3600 * 1000).getUTCHours()));
    // The longest stretch with no sample at all is what actually hurts: it is a
    // time of day the app will never learn anything about.
    let worstGap = 0;
    const sorted = times.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      worstGap = Math.max(worstGap, (sorted[i] - sorted[i - 1]) / 3600000);
    }
    days.push({ date: name.replace(/\.jsonl(\.gz)?$/, ""), n: times.length, hours: hours.size, worstGap });
  }

  console.log("date         snapshots  hours  longest gap");
  console.log("-----------  ---------  -----  -----------");
  for (const d of days) {
    const flag = d.n < THIN_PER_DAY || d.hours < GOOD_HOURS ? "  <-- thin" : "";
    console.log(
      d.date.padEnd(13) +
      String(d.n).padStart(6) + "     " +
      (d.hours + "/24").padStart(5) + "  " +
      (d.worstGap ? d.worstGap.toFixed(1) + " h" : "-").padStart(9) + flag
    );
  }

  // Judge on the finished days only; today is partial by definition.
  const finished = days.slice(0, -1);
  const recent = finished.slice(-3);
  if (!recent.length) return;

  const avg = recent.reduce((a, d) => a + d.n, 0) / recent.length;
  console.log("\nlast " + recent.length + " finished days: " + avg.toFixed(1) +
    " snapshots/day (ideal " + IDEAL_PER_DAY + ")");

  if (avg < THIN_PER_DAY) {
    console.log(
      "\nCollection is running far below schedule. The runs that happen still\n" +
      "succeed, so nothing looks broken - check whether the scheduler is\n" +
      "dispatching at all:  gh run list --workflow=collect.yml --limit 40\n" +
      "Sparse sampling does not make the predictions wrong, only slow to\n" +
      "arrive and uneven about which hours they cover."
    );
    process.exitCode = 1;
  }
}

main();
