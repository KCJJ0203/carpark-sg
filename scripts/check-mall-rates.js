// Re-reads every mall/private carpark's rate page and checks each figure
// transcribed in src/mall-tariffs.js still appears there.
//
//   node scripts/check-mall-rates.js
//
// Exit 0: every page still shows every figure.
// Exit 1: a figure is gone from its page - the rate probably changed. Fix the
//         tariff from the page; do not just delete the check.
// Exit 2: a page could not be read (blocked, down, moved). Nothing is known.
//
// Same contract as scripts/check-rates.js does for HDB's schedule.

const https = require("https");
const { TARIFFS } = require("../src/mall-tariffs");
const { validate } = require("../src/mall-rates");

// Some of these sites refuse a request with no browser-like User-Agent.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0 Safari/537.36 carpark-sg-rate-check";

function get(url, hops) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "user-agent": UA, accept: "text/html" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), (hops || 0) + 1));
      }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (d += c));
      res.on("end", () => (res.statusCode === 200 ? resolve(d) : reject(new Error("HTTP " + res.statusCode))));
    }).on("error", reject);
  });
}

// Pages write "$1.95", "$ 1.95" and "&#36;1.95"; compare on plain text.
const plain = (html) => html
  .replace(/&#36;|&dollar;/g, "$").replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/\$\s+/g, "$").replace(/\s+/g, " ");

(async () => {
  let moved = 0, unread = 0;
  const pages = new Map();
  for (const [id, t] of Object.entries(TARIFFS)) {
    try { validate(id, t); } catch (e) { console.log("BAD  " + e.message); moved++; continue; }
    const url = t.checkSource || t.source;
    if (!pages.has(url)) pages.set(url, get(url).then(plain));
    let text;
    try { text = await pages.get(url); } catch (e) {
      console.log("???  " + id + " " + t.name + ": could not read " + url + " (" + e.message + ")");
      unread++;
      continue;
    }
    const missing = (t.checks || []).filter((c) => !text.includes(c));
    if (missing.length) {
      console.log("MOVED " + id + " " + t.name + ": not on the page any more: " + missing.join(", "));
      moved++;
    } else {
      console.log("ok   " + id + " " + t.name);
    }
  }
  if (moved) process.exit(1);
  if (unread) process.exit(2);
})();
