// Static pages a search engine can read, one per priced mall plus an index:
//
//   web/malls/index.html          every priced mall, side by side
//   web/malls/<slug>/index.html   what 1, 2 and 3 hours cost there
//   web/sitemap.xml
//
// The map is a single page that draws everything in the browser, so to a
// search engine it is one page about nothing in particular. These pages answer
// the question people actually type ("vivocity parking rates") in plain HTML.
//
// Every figure here comes from the same engine and the same transcribed rates
// as the map (src/mall-rates.js, src/mall-tariffs.js), worked out for real
// dates, so a page can never disagree with the map. Nothing is described in
// words that the engine did not compute.
//
// Output is deterministic: no build date is printed, so a daily publish with
// unchanged rates changes no files.
//
//   node scripts/build-pages.js

const fs = require("fs");
const path = require("path");
const mall = require("../src/mall-rates");
const { TARIFFS } = require("../src/mall-tariffs");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const SITE = "https://kcjj0203.github.io/carpark-sg/";

const read = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; }
};
const carparks = new Map((read(path.join(ROOT, "data", "carparks.json"), { carparks: [] }).carparks || [])
  .map((c) => [c.id, c]));
const holidays = new Set(read(path.join(WEB, "holidays.json"), []));
const evFile = read(path.join(ROOT, "data", "live-ev.json"), { sites: [] });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugOf = (name) => name.toLowerCase().replace(/&/g, " and ").replace(/@/g, " at ")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- reference dates ------------------------------------------------------
//
// A Tuesday, Friday, Saturday and Sunday in a week with no public holiday and
// no eve of one, so each column is that kind of day and nothing else. Chosen
// from a fixed anchor, not today, so the pages do not change week to week.

const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
function referenceWeek() {
  let mon = "2026-11-09";   // a Monday
  for (let i = 0; i < 52; i++, mon = addDays(mon, 7)) {
    const days = [...Array(8)].map((_, k) => addDays(mon, k));
    if (!days.some((d) => holidays.has(d))) {
      return { wd: addDays(mon, 1), fri: addDays(mon, 4), sat: addDays(mon, 5), sun: addDays(mon, 6) };
    }
  }
  throw new Error("no week without a public holiday in the next year");
}
const WEEK = referenceWeek();
const at = (iso, hhmm) => new Date(iso + "T" + hhmm + ":00+08:00");

const TIMES = [["09:00", "9am"], ["12:00", "12pm"], ["15:00", "3pm"], ["18:00", "6pm"], ["20:00", "8pm"]];
const STAYS = [[60, "1 hour"], [120, "2 hours"], [180, "3 hours"]];
const DAYS = [["wd", "Mon–Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun & PH"]];

function cost(tariff, day, hhmm, minutes) {
  const f = mall.feeFor(tariff, at(WEEK[day], hhmm), minutes, (d) => holidays.has(d));
  if (f.unavailable) return { text: f.unavailable === "closed" ? "Closed" : "No rate", n: null };
  if (f.total === 0) return { text: "Free", n: 0 };
  return { text: "$" + f.total.toFixed(2) + (f.crossed ? "*" : ""), n: f.total, crossed: f.crossed };
}

// One table per length of stay. Friday folds into Mon-Thu, and Sunday into
// Saturday, wherever every figure is the same, which for most malls it is.
function tables(tariff) {
  const grid = {};
  for (const [d] of DAYS) for (const [t] of TIMES) for (const [m] of STAYS) {
    grid[d + t + m] = cost(tariff, d, t, m);
  }
  const same = (a, b) => TIMES.every(([t]) => STAYS.every(([m]) => grid[a + t + m].text === grid[b + t + m].text));
  const cols = [["wd", same("wd", "fri") ? "Mon–Fri" : "Mon–Thu"]];
  if (!same("wd", "fri")) cols.push(["fri", "Fri"]);
  cols.push(["sat", same("sat", "sun") ? "Sat, Sun & PH" : "Sat"]);
  if (!same("sat", "sun")) cols.push(["sun", "Sun & PH"]);
  let crossed = false;
  const html = STAYS.map(([m, label]) =>
    "<h2>Parking for " + label + "</h2>\n<div class=\"tw\"><table>\n<thead><tr><th scope=\"col\">Arriving</th>" +
    cols.map(([, l]) => "<th scope=\"col\">" + l + "</th>").join("") + "</tr></thead>\n<tbody>\n" +
    TIMES.map(([t, tl]) => "<tr><th scope=\"row\">" + tl + "</th>" + cols.map(([d]) => {
      const c = grid[d + t + m];
      if (c.crossed) crossed = true;
      return "<td" + (c.n === 0 ? " class=\"free\"" : c.n === null ? " class=\"none\"" : "") + ">" + c.text + "</td>";
    }).join("") + "</tr>").join("\n") + "\n</tbody></table></div>").join("\n");
  return { html, crossed, grid };
}

// ---- EV chargers, from the collector's file (what is there, not what is free)

function chargersAt(id) {
  const groups = [];
  for (const s of evFile.sites || []) if (s[0] === id) groups.push(...s[4]);
  if (!groups.length) return null;
  let n = 0, kw = 0, dckw = 0;
  const prices = [];
  for (const g of groups) {
    n += g[5];
    if (g[2]) dckw = Math.max(dckw, g[1] || 0); else kw = Math.max(kw, g[1] || 0);
    if (g[3] !== null && g[4] === "kWh") prices.push(g[3]);
  }
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return n + (n === 1 ? " charger" : " chargers") +
    (dckw ? ", DC fast charging up to " + dckw + " kW" : "") +
    (kw ? (dckw ? " and" : ",") + " AC up to " + kw + " kW" : "") +
    (prices.length ? ". Charging costs " + (lo === hi ? "$" + lo.toFixed(2) : "$" + lo.toFixed(2) + "–$" + hi.toFixed(2)) +
      " per kWh including GST, on top of parking" : "") + ".";
}

// ---- page shell -----------------------------------------------------------

const CSS = `
:root { --bg:#f6f7f9; --card:#fff; --ink:#14181f; --muted:#5c6672; --line:#e3e7ec; --ok:#17794a; --link:#1f5fae; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1419; --card:#171d24; --ink:#e8edf2; --muted:#94a1ae; --line:#262f39; --ok:#4ac48a; --link:#74a9ee; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 20px 16px 48px; }
a { color: var(--link); }
.crumb { font-size: 14px; color: var(--muted); }
h1 { font-size: 28px; line-height: 1.2; margin: 8px 0 8px; }
h2 { font-size: 18px; margin: 28px 0 8px; }
.lead { color: var(--muted); margin: 0 0 16px; }
.cta { display:inline-block; background:var(--ink); color:var(--bg); text-decoration:none; padding:10px 16px; border-radius:999px; font-weight:600; }
.tw { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 10px; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
tbody th, thead th { white-space: normal; }
@media (max-width: 480px) { th, td { padding: 8px 6px; font-size: 15px; } thead th { font-size: 12px; } }
thead th { font-size: 13px; color: var(--muted); font-weight: 600; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
td.free { color: var(--ok); font-weight: 600; }
td.none { color: var(--muted); }
.note { font-size: 14px; color: var(--muted); }
ul.near { padding-left: 18px; }
footer { margin-top: 36px; font-size: 14px; color: var(--muted); }
`;

function page({ title, description, canonical, body, jsonld }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#0f1419">
<style>${CSS}</style>
${jsonld ? '<script type="application/ld+json">' + JSON.stringify(jsonld) + "</script>\n" : ""}</head>
<body>
<main>
${body}
<footer>Carpark SG works out what parking costs near any place in Singapore, hour by hour.
<a href="${SITE}">Open the live map</a> &middot; <a href="${SITE}malls/">All mall parking rates</a></footer>
</main>
</body>
</html>
`;
}

const haversine = (a, b) => {
  const r = (d) => d * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const longDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB",
  { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// ---- build ----------------------------------------------------------------

function build() {
  const entries = [];
  const slugs = new Set();
  for (const [id, t] of Object.entries(TARIFFS)) {
    const c = carparks.get(id);
    if (!c) { console.warn("skipped " + id + ": not in data/carparks.json"); continue; }
    let slug = slugOf(t.name);
    if (slugs.has(slug)) slug += "-" + id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    slugs.add(slug);
    entries.push({ id, t, c, slug });
  }
  entries.sort((a, b) => a.t.name.localeCompare(b.t.name));

  const outDir = path.join(WEB, "malls");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const e of entries) {
    const { id, t, c, slug } = e;
    const tb = tables(t);
    const two = (d, h) => tb.grid[d + h + 120];
    rows.push({ e, wd: two("wd", "15:00"), sat: two("sat", "15:00"), eve: two("wd", "20:00") });

    const near = entries.filter((o) => o !== e)
      .map((o) => ({ o, d: haversine({ lat: c.lat, lng: c.lng }, { lat: o.c.lat, lng: o.c.lng }) }))
      .filter((x) => x.d < 2000).sort((a, b) => a.d - b.d).slice(0, 6);
    const ev = chargersAt(id);
    const from = t.secondary ? "LTA OneMotoring's parking guide" : "the rates the carpark posts on its own website";
    const canonical = SITE + "malls/" + slug + "/";
    const body = `<p class="crumb"><a href="${SITE}">Carpark SG</a> &rsaquo; <a href="${SITE}malls/">Mall parking</a></p>
<h1>${esc(t.name)} parking rates</h1>
<p class="lead">What parking at ${esc(t.name)} costs for 1, 2 and 3 hours, by day and by the time you arrive. Worked out from ${from}, read on ${longDate(t.read)}.</p>
<p><a class="cta" href="${SITE}#c=${encodeURIComponent(id)}">See it on the live map</a></p>
${tb.html}
<p class="note">${[
  t.grace ? "The first " + t.grace + " minutes are free." : "",
  t.note ? esc(t.note) + "." : "",
  tb.crossed ? "* The stay crosses from one rate period into another, and the carpark does not say how it charges that, so this assumes each period charges for the time spent in it. Treat it as an estimate." : "",
  "“Sun &amp; PH” includes public holidays. Carparks change their rates without notice, so the signboard at the entrance has the final word.",
  '<a href="' + esc(t.source) + '" rel="nofollow noopener">Check the rates yourself</a>.',
].filter(Boolean).join(" ")}</p>
${ev ? "<h2>EV charging</h2>\n<p>" + ev + ' <a href="' + SITE + "#c=" + encodeURIComponent(id) + '">See which are free right now</a>.</p>' : ""}
${near.length ? "<h2>Other malls nearby</h2>\n<ul class=\"near\">" + near.map((x) =>
  '<li><a href="' + SITE + "malls/" + x.o.slug + '/">' + esc(x.o.t.name) + "</a> (" +
  (x.d < 1000 ? Math.round(x.d / 10) * 10 + " m" : (x.d / 1000).toFixed(1) + " km") + ")</li>").join("") + "</ul>" : ""}`;
    const w2 = two("wd", "15:00");
    const description = t.name + " parking rates: " +
      (w2.n !== null ? "2 hours on a weekday afternoon costs " + (w2.n === 0 ? "nothing" : w2.text.replace("*", "")) + ". " : "") +
      "See 1, 2 and 3 hours by day and arrival time, worked out from the carpark's posted rates.";
    const html = page({
      title: t.name + " parking rates – what 1 to 3 hours costs | Carpark SG",
      description, canonical, body,
      jsonld: {
        "@context": "https://schema.org", "@type": "ParkingFacility", name: t.name + " carpark",
        url: canonical, geo: { "@type": "GeoCoordinates", latitude: c.lat, longitude: c.lng },
      },
    });
    fs.mkdirSync(path.join(outDir, slug), { recursive: true });
    fs.writeFileSync(path.join(outDir, slug, "index.html"), html);
  }

  const cell = (x) => "<td" + (x.n === 0 ? ' class="free"' : x.n === null ? ' class="none"' : "") + ">" + x.text + "</td>";
  const indexBody = `<p class="crumb"><a href="${SITE}">Carpark SG</a></p>
<h1>Mall parking rates in Singapore</h1>
<p class="lead">What 2 hours of parking costs at ${entries.length} malls and attractions, worked out from the rates each one posts. Tap a mall for 1, 2 and 3 hours at any time of day.</p>
<p><a class="cta" href="${SITE}">Open the live map</a></p>
<div class="tw"><table>
<thead><tr><th scope="col">Mall</th><th scope="col">Weekday 3pm</th><th scope="col">Saturday 3pm</th><th scope="col">Weekday 8pm</th></tr></thead>
<tbody>
${rows.map((r) => '<tr><th scope="row"><a href="' + SITE + "malls/" + r.e.slug + '/">' + esc(r.e.t.name) + "</a></th>" +
  cell(r.wd) + cell(r.sat) + cell(r.eve) + "</tr>").join("\n")}
</tbody></table></div>
<p class="note">Each figure is a 2-hour stay arriving at that time. * The stay crosses from one rate period into another and is an estimate. Rates are read by hand from each carpark's own website, or LTA OneMotoring's guide where a carpark posts none, and checked weekly. A few malls post rates too unclear to quote and are left out rather than guessed.</p>`;
  fs.writeFileSync(path.join(outDir, "index.html"), page({
    title: "Mall parking rates in Singapore – 2 hours compared | Carpark SG",
    description: "Parking rates at " + entries.length + " Singapore malls side by side: what 2 hours costs on a weekday, a Saturday and a weekday evening, from each mall's own posted rates.",
    canonical: SITE + "malls/", body: indexBody,
  }));

  const lastmod = entries.reduce((m, e) => (e.t.read > m ? e.t.read : m), "2026-01-01");
  const urls = [SITE, SITE + "malls/", ...entries.map((e) => SITE + "malls/" + e.slug + "/")];
  fs.writeFileSync(path.join(WEB, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "  <url><loc>" + u + "</loc><lastmod>" + lastmod + "</lastmod></url>").join("\n") + "\n</urlset>\n");
  return entries.length;
}

if (require.main === module) {
  console.log("mall pages:", build(), "(reference week " + WEEK.wd + " .. " + WEEK.sun + ")");
}
module.exports = { build, slugOf, referenceWeek };
