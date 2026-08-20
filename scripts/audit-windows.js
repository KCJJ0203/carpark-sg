// Does the window parser handle every value the real dataset contains?
// Anything it returns [] for is treated as "never free" - safe, but if that
// silently covers a common wording we are under-reporting free parking.
const https = require("https");
const { parseWindow } = require("../src/windows");

const get = (u) => new Promise((res, rej) => https.get(u, (r) => {
  let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
}).on("error", rej));

(async () => {
  let recs = [], offset = 0;
  while (true) {
    const j = await get(`https://data.gov.sg/api/action/datastore_search?resource_id=d_23f946fa557947f93a8043bbef41dd09&limit=1000&offset=${offset}`);
    recs = recs.concat(j.result.records);
    if (j.result.records.length < 1000) break;
    offset += 1000;
  }
  console.log("carparks:", recs.length);

  for (const field of ["free_parking", "short_term_parking"]) {
    const counts = {};
    recs.forEach((r) => { counts[r[field]] = (counts[r[field]] || 0) + 1; });
    console.log(`\n--- ${field}: ${Object.keys(counts).length} distinct values`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([v, n]) => {
      const parsed = parseWindow(v);
      const verdict = v.toUpperCase() === "NO" ? "n/a (never)" : parsed.length ? "PARSED" : "*** UNRECOGNISED ***";
      console.log("  " + String(n).padStart(5), JSON.stringify(v).padEnd(30), verdict, parsed.length ? JSON.stringify(parsed[0]) : "");
    });
  }
})();
