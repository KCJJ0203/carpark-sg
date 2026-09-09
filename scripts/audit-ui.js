// Drive the real page like a user, at three window sizes, and check what it
// actually shows. Not "did it load" - that has never been the failure mode
// here. Every check below is something a person would notice and be misled by.
//
//   node scripts/audit-ui.js           the local web/ directory
//   node scripts/audit-ui.js --live    the deployed site
//
// Needs playwright, which is already the repo's one devDependency.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(path.join(__dirname, "..", "web"));
const LIVE = process.argv.includes("--live");
const PORT = 8742;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { failures.push(name + (detail ? " -> " + detail : "")); console.log("  FAIL " + name + (detail ? " -> " + detail : "")); }
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = path.resolve(path.join(ROOT, rel === "/" ? "index.html" : rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const ready = (page) => page.waitForFunction(
  () => typeof state !== "undefined" && state.carparks && document.querySelectorAll(".row[data-id]").length,
  null, { timeout: 30000 });

async function open(browser, width, height, errors) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
    permissions: [],
    locale: "en-SG",
    timezoneId: "Asia/Singapore",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(width + "px pageerror: " + e));
  page.on("console", (m) => { if (m.type() === "error") errors.push(width + "px console: " + m.text()); });
  await page.goto(LIVE ? "https://kcjj0203.github.io/carpark-sg/" : "http://127.0.0.1:" + PORT + "/",
    { waitUntil: "domcontentloaded" });
  await ready(page);
  return { ctx, page };
}

async function auditDesktop(browser, errors) {
  console.log("\n== desktop 1920x1080 ==");
  const { ctx, page } = await open(browser, 1920, 1080, errors);

  // LAYOUT: the map should be the page, not a letterbox above a drawer.
  const geo = await page.evaluate(() => {
    const m = document.querySelector("#map").getBoundingClientRect();
    const s = document.querySelector("#sheet").getBoundingClientRect();
    return { mapW: m.width, mapH: m.height, sheetW: s.width, sheetH: s.height,
             sheetLeft: s.left, mapLeft: m.left, winW: innerWidth, winH: innerHeight,
             gripShown: getComputedStyle(document.querySelector("#grip")).display !== "none" };
  });
  check("map takes most of the width", geo.mapW / geo.winW > 0.6, Math.round(geo.mapW / geo.winW * 100) + "%");
  check("map is full height", geo.mapH > geo.winH * 0.95, geo.mapH + "px of " + geo.winH);
  check("list is a side rail, not a drawer", geo.sheetH > geo.winH * 0.95 && geo.sheetLeft < geo.mapLeft,
    "h=" + Math.round(geo.sheetH) + " left=" + Math.round(geo.sheetLeft) + " mapLeft=" + Math.round(geo.mapLeft));
  check("no drag grip on desktop", !geo.gripShown);

  // The rail toggle should hand the whole window to the map.
  await page.click("#layoutBtn");
  await page.waitForTimeout(250);
  const hidden = await page.evaluate(() => ({
    railShown: getComputedStyle(document.querySelector("#sheet")).display !== "none",
    mapW: document.querySelector("#map").getBoundingClientRect().width,
  }));
  check("layout button hides the rail", !hidden.railShown && hidden.mapW > 1900, "mapW " + Math.round(hidden.mapW));
  await page.click("#layoutBtn");
  await page.waitForTimeout(250);
  check("layout button brings the rail back",
    await page.evaluate(() => getComputedStyle(document.querySelector("#sheet")).display !== "none"));

  // SEARCH SUGGESTIONS, and the "I just want to park around Orchard" case.
  await page.fill("#q", "orchard road");
  await page.waitForSelector("#sugg li[data-i]", { timeout: 15000 });
  const sugg = await page.$$eval("#sugg li[data-i]", (ls) => ls.map((l) => l.textContent));
  check("typing offers suggestions", sugg.length > 0, sugg.length + " shown");
  check("suggestions carry a road or postcode to tell them apart",
    sugg.some((t) => /·|S\d{6}|RD|ROAD/i.test(t)), JSON.stringify(sugg.slice(0, 2)));

  const before = await page.evaluate(() => ({ lat: state.centre.lat, lng: state.centre.lng }));
  await page.click("#sugg li[data-i='0']");
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    lat: state.centre.lat, lng: state.centre.lng, zoom: state.map.getZoom(),
    first: (document.querySelector(".row[data-id] h2") || {}).textContent,
    where: (document.querySelector("#where") || {}).textContent,
  }));
  const moved = Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng);
  check("picking a suggestion moves the map", moved > 0.002, "delta " + moved.toFixed(4));
  check("landing near Orchard", after.lat > 1.28 && after.lat < 1.32 && after.lng > 103.81 && after.lng < 103.85,
    after.lat.toFixed(4) + "," + after.lng.toFixed(4));
  check("a road search zooms out to show the area, not one shopfront", after.zoom <= 16, "zoom " + after.zoom);
  check("the list re-anchors to the new place", !!after.first, after.first);

  // Keyboard use of the suggestion list.
  await page.fill("#q", "bugis");
  await page.waitForSelector("#sugg li[data-i]");
  await page.keyboard.press("ArrowDown");
  const activeAfterDown = await page.$eval("#sugg li[data-i='0']", (l) => l.getAttribute("aria-selected"));
  check("arrow keys move through suggestions", activeAfterDown === "true");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  check("Enter picks the highlighted suggestion",
    await page.evaluate(() => document.querySelector("#sugg").hidden));

  // DURATION: the slider must change the price, and the label must agree.
  const d0 = await page.evaluate(() => ({
    label: document.querySelector("#durLabel").textContent,
    mins: state.stay.minutes,
    price: (document.querySelector(".row[data-id] .price") || {}).textContent,
  }));
  await page.$eval("#dur", (el) => {
    el.value = String(Number(el.max));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const d1 = await page.evaluate(() => ({
    label: document.querySelector("#durLabel").textContent,
    mins: state.stay.minutes,
    price: (document.querySelector(".row[data-id] .price") || {}).textContent,
  }));
  check("the duration slider changes the stay", d1.mins > d0.mins, d0.mins + " -> " + d1.mins);
  check("the label agrees with the stay", d1.label.indexOf("12") === 0, d1.label);
  check("a longer stay changes the prices shown", d1.price !== d0.price, d0.price + " -> " + d1.price);

  // Presets must not also drag the slider they sit inside.
  await page.click("#durPresets [data-mins='60']");
  await page.waitForTimeout(300);
  const preset = await page.evaluate(() => ({
    mins: state.stay.minutes, label: document.querySelector("#durLabel").textContent,
    pressed: document.querySelector("#durPresets [data-mins='60']").getAttribute("aria-pressed"),
  }));
  check("a preset sets the stay exactly", preset.mins === 60, String(preset.mins));
  check("the chosen preset is marked", preset.pressed === "true");
  check("the preset label reads naturally", preset.label === "1 hour", preset.label);

  // PARK LATER: the arrival control must actually be usable, which was the
  // complaint - a datetime-local that showed nothing but editable segments.
  await page.click("#whenLater");
  await page.waitForTimeout(350);
  const later = await page.evaluate(() => ({
    boxShown: !document.querySelector("#laterBox").hidden,
    label: document.querySelector("#startLabel").textContent,
    slider: !!document.querySelector("#startTime"),
    start: state.stay.start,
  }));
  check("choosing Later reveals the arrival controls", later.boxShown);
  check("there is a time slider, not a bare stepper", later.slider);
  check("the arrival readout says a day and a time", /\d/.test(later.label) && later.label.length > 6, later.label);
  check("a start time is actually set", !!later.start);

  // Scrub the arrival time and watch the prices move: the whole point.
  const p0 = await page.$$eval(".row[data-id] .price", (e) => e.map((x) => x.textContent).join("|"));
  await page.$eval("#startTime", (el) => {
    el.value = "1380";                       // 23:00, into the night rates
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const scrub = await page.evaluate(() => ({
    label: document.querySelector("#startLabel").textContent,
    prices: [...document.querySelectorAll(".row[data-id] .price")].map((x) => x.textContent).join("|"),
  }));
  check("scrubbing the arrival time re-prices the list", scrub.prices !== p0, "was " + p0.slice(0, 40));
  check("the readout follows the slider", /11[:.]00\s*pm/i.test(scrub.label.replace(/\u2009/g, "")), scrub.label);

  // Another day must be reachable, because weekday and Sunday rates differ.
  await page.click("#laterBox [data-day='1']");
  await page.waitForTimeout(300);
  check("Tomorrow is one tap away",
    await page.evaluate(() => document.querySelector("#laterBox [data-day='1']").getAttribute("aria-pressed") === "true"));

  // Back to now, then the detail sheet.
  await page.click("#whenNow");
  await page.waitForTimeout(300);
  check("Park now clears the arrival time", await page.evaluate(() => state.stay.start === null));

  await page.click(".row[data-id]");
  await page.waitForTimeout(400);
  const detail = await page.evaluate(() => ({
    open: !!document.querySelector(".detail"),
    heading: (document.querySelector(".detail h2") || {}).textContent,
    hasFee: !!document.querySelector(".fee-box"),
  }));
  check("a carpark opens its own panel", detail.open && !!detail.heading, detail.heading);
  check("the panel shows the cost breakdown", detail.hasFee);
  await page.click("#back");
  await page.waitForTimeout(300);
  check("back returns to the list", await page.evaluate(() => !document.querySelector(".detail")));

  // Nothing may overflow the window sideways.
  check("no horizontal overflow",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  // Text that does not fit is text the reader has to guess at.
  const fits = await page.evaluate(() => {
    const q = document.querySelector("#q");
    const chips = [...document.querySelectorAll("#controls .chip")];
    const head = document.querySelector("#sheetHead").getBoundingClientRect();
    return {
      placeholder: (() => {
        const keep = q.value;
        q.value = q.placeholder;
        const fits = q.scrollWidth <= q.clientWidth + 1;
        q.value = keep;
        return fits;
      })(),
      chipsClipped: chips.filter((c) => c.getBoundingClientRect().right > head.right + 1).length,
      chipCount: chips.length,
    };
  });
  check("the search placeholder fits its box", fits.placeholder);
  check("every filter chip is visible in the rail", fits.chipsClipped === 0,
    fits.chipsClipped + " of " + fits.chipCount + " clipped");

  await ctx.close();
}

async function auditPhone(browser, errors) {
  console.log("\n== phone 390x844 ==");
  const { ctx, page } = await open(browser, 390, 844, errors);

  const geo = await page.evaluate(() => {
    const s = document.querySelector("#sheet").getBoundingClientRect();
    return { sheetTop: s.top, winH: innerHeight, winW: innerWidth,
             gripShown: getComputedStyle(document.querySelector("#grip")).display !== "none" };
  });
  check("the sheet is a drawer over the map", geo.sheetTop > 0 && geo.sheetTop < geo.winH);
  check("the drag grip is available", geo.gripShown);

  // Drag the grip and check it comes to rest where it was left, rather than
  // snapping to one of three preset heights.
  const box = await page.$eval("#grip", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const targetY = box.y - 137;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x, targetY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.querySelector("#sheet").getBoundingClientRect().top);
  check("the sheet stays where it is dragged", Math.abs(after - targetY) < 26,
    "wanted ~" + Math.round(targetY) + ", got " + Math.round(after));

  // And the list must now describe the strip of map still visible, not the
  // centre of a map that is half covered.
  const anchored = await page.evaluate(() => {
    const size = state.map.getSize();
    const hiddenPx = document.querySelector("#sheet").getBoundingClientRect().height;
    const want = state.map.containerPointToLatLng([size.x / 2, (size.y - hiddenPx) / 2]);
    return Math.abs(want.lat - state.centre.lat) + Math.abs(want.lng - state.centre.lng);
  });
  check("the list re-anchors to the visible part of the map", anchored < 0.0006, "delta " + anchored.toFixed(5));

  // Controls have to be reachable and finger-sized on a phone.
  const sizes = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; };
    return { dur: r("#dur"), q: r("#q"), chip: r("#controls .chip"), go: r("#go") };
  });
  check("the duration slider is full width on a phone", sizes.dur && sizes.dur.w > 250, JSON.stringify(sizes.dur));
  check("the slider is tall enough to grab", sizes.dur && sizes.dur.h >= 20, JSON.stringify(sizes.dur));
  check("the search box is usable", sizes.q && sizes.q.w > 200 && sizes.q.h >= 38, JSON.stringify(sizes.q));

  check("no horizontal overflow on a phone",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  // The controls exist to filter a list. At the height the sheet opens at, some
  // of that list has to be on screen, or the app opens showing only its own
  // knobs and the user has to drag before it says anything.
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  const room = await page.evaluate(() => {
    const sheet = document.querySelector("#sheet").getBoundingClientRect();
    const cards = [...document.querySelectorAll(".row[data-id]")]
      .filter((c) => c.getBoundingClientRect().top < sheet.bottom - 30);
    const q = document.querySelector("#q");
    const keep = q.value;
    q.value = q.placeholder;
    const placeholder = q.scrollWidth <= q.clientWidth + 1;
    q.value = keep;
    return { visibleCards: cards.length, placeholder: placeholder };
  });
  check("a carpark is visible without dragging", room.visibleCards >= 1,
    room.visibleCards + " cards in view");
  check("the placeholder fits on a phone too", room.placeholder);

  await ctx.close();
}

async function auditTablet(browser, errors) {
  console.log("\n== tablet 1024x768 (just past the split) ==");
  const { ctx, page } = await open(browser, 1024, 768, errors);
  const geo = await page.evaluate(() => {
    const m = document.querySelector("#map").getBoundingClientRect();
    const s = document.querySelector("#sheet").getBoundingClientRect();
    return { mapW: m.width, sheetW: s.width, winW: innerWidth, winH: innerHeight, sheetH: s.height };
  });
  check("the rail stays readable at 1024px", geo.sheetW >= 330 && geo.sheetW <= 460, Math.round(geo.sheetW) + "px");
  check("the map still gets the larger half", geo.mapW > geo.winW * 0.5, Math.round(geo.mapW) + "px");
  check("the rail is full height", geo.sheetH > geo.winH * 0.95);

  // Crossing the breakpoint has to leave a working page, not a stuck one.
  await page.setViewportSize({ width: 900, height: 768 });
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => ({
    grip: getComputedStyle(document.querySelector("#grip")).display !== "none",
    rows: document.querySelectorAll(".row[data-id]").length,
  }));
  check("shrinking past the breakpoint restores the drawer", narrow.grip);
  check("the list survives the switch", narrow.rows > 0, narrow.rows + " rows");

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => ({
    grip: getComputedStyle(document.querySelector("#grip")).display !== "none",
    rows: document.querySelectorAll(".row[data-id]").length,
    overflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  check("growing back restores the rail", !wide.grip);
  check("the list survives that too", wide.rows > 0, wide.rows + " rows");
  check("still no horizontal overflow", wide.overflow);

  await ctx.close();
}

(async () => {
  if (!LIVE) await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  try {
    await auditDesktop(browser, errors);
    await auditPhone(browser, errors);
    await auditTablet(browser, errors);
  } finally {
    await browser.close();
    if (!LIVE) server.close();
  }

  console.log("\n" + "=".repeat(60));
  console.log("passed: " + pass + "   failed: " + failures.length);
  if (failures.length) console.log("\nFAILURES:\n  " + failures.join("\n  "));
  if (errors.length) console.log("\nPAGE ERRORS:\n  " + errors.join("\n  "));
  else console.log("no page errors");
  process.exitCode = failures.length || errors.length ? 1 : 0;
})();
