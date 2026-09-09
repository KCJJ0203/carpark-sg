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
  const later = await page.evaluate(() => {
    const t = document.querySelector("#atTime");
    return {
      boxShown: !document.querySelector("#laterBox").hidden,
      label: document.querySelector("#startLabel").textContent,
      timeField: t ? t.type : null,
      step: t ? t.step : null,
      noSlider: !document.querySelector("#startTime"),
      quickChips: [...document.querySelectorAll("#laterBox .chip")].map((c) => c.textContent.trim()),
      start: state.stay.start,
    };
  });
  check("choosing Later reveals the arrival controls", later.boxShown);
  // An arrival time is an exact moment. A slider makes you hunt for 6.45pm.
  check("arrival is a real time field, not a slider", later.timeField === "time" && later.noSlider,
    String(later.timeField));
  check("the time field steps in quarter hours", later.step === "900", String(later.step));
  check("quick arrival chips are offered", later.quickChips.length >= 4, JSON.stringify(later.quickChips));
  check("the arrival readout says a day and a time", /\d/.test(later.label) && later.label.length > 6, later.label);
  check("a start time is actually set", !!later.start);

  // Setting an exact time must re-price everything.
  const p0 = await page.$$eval(".row[data-id] .price", (e) => e.map((x) => x.textContent).join("|"));
  await page.$eval("#atTime", (el) => {
    el.value = "23:00";                      // into the night rates
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const typed = await page.evaluate(() => ({
    label: document.querySelector("#startLabel").textContent,
    prices: [...document.querySelectorAll(".row[data-id] .price")].map((x) => x.textContent).join("|"),
  }));
  check("typing an arrival time re-prices the list", typed.prices !== p0, "was " + p0.slice(0, 40));
  check("the readout follows the time field",
    /11[:.]00\s*pm/i.test(typed.label.replace(/\u2009/g, "")), typed.label);

  // "in 1 h" is how a person answers this question.
  await page.click("#laterBox [data-in='60']");
  await page.waitForTimeout(350);
  const relative = await page.evaluate(() => {
    const ahead = (new Date(state.stay.start).getTime() - Date.now()) / 60000;
    return { ahead: ahead, label: document.querySelector("#startLabel").textContent };
  });
  check("\"in 1 h\" sets an arrival about an hour ahead",
    relative.ahead > 44 && relative.ahead < 76, Math.round(relative.ahead) + " min ahead");

  await page.click("#laterBox [data-at='1140']");
  await page.waitForTimeout(350);
  check("a 7pm chip sets 7pm exactly",
    await page.evaluate(() => new Date(state.stay.start.getTime() + 8 * 3600000).getUTCHours() === 19));

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
    const chips = [...document.querySelectorAll("#typeChips .chip")];
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

  // Nine identical pills wrapping into three rows said nothing about which are
  // "pick one" and which are "pick any".
  const groups = await page.evaluate(() => {
    const segButtons = [...document.querySelectorAll("#sortSeg button")];
    const typeChips = [...document.querySelectorAll("#typeChips .chip")];
    const segTops = new Set(segButtons.map((b) => Math.round(b.getBoundingClientRect().top)));
    return {
      sortCount: segButtons.length, typeCount: typeChips.length,
      sortOnOneRow: segTops.size === 1,
      labels: [...document.querySelectorAll(".ctl-lab")].map((l) => l.textContent.trim()),
      segLooksJoined: segButtons.length > 0 &&
        getComputedStyle(segButtons[0].parentElement).borderTopWidth !== "0px",
      pressedSorts: segButtons.filter((b) => b.getAttribute("aria-pressed") === "true").length,
    };
  });
  check("the three orders sit on one row as a segmented control",
    groups.sortOnOneRow && groups.segLooksJoined, groups.sortCount + " buttons");
  check("exactly one order is chosen at a time", groups.pressedSorts === 1, String(groups.pressedSorts));
  check("each control row is labelled", groups.labels.length === 2, JSON.stringify(groups.labels));
  check("the type filters are a separate group", groups.typeCount === 6, String(groups.typeCount));

  await ctx.close();
}

// The feature that makes this a different app from the ones that only show
// which carparks have space.
async function auditPriceChart(browser, errors) {
  console.log("\n== the price-through-the-day chart ==");
  const { ctx, page } = await open(browser, 1600, 1000, errors);

  // Somewhere with real rate changes during the day.
  await page.evaluate(() => goTo(1.3006, 103.8388, 16));
  await page.waitForTimeout(900);
  await page.click(".row[data-id]");
  await page.waitForTimeout(500);

  const chart = await page.evaluate(() => {
    const box = document.querySelector(".day-box");
    if (!box) return { present: false };
    const bars = [...box.querySelectorAll("[data-hour]")];
    const heights = bars.map((b) => b.querySelector("i").style.height);
    return {
      present: true,
      bars: bars.length,
      hours: bars.map((b) => +b.dataset.hour).join(","),
      distinctHeights: new Set(heights).size,
      note: box.querySelector(".day-note").textContent,
      titled: bars.every((b) => (b.getAttribute("title") || "").length > 3),
      marksBest: !!box.querySelector(".best, .free"),
    };
  });
  check("the carpark panel charts the day", chart.present);
  check("one bar per hour", chart.bars === 24, String(chart.bars));
  check("the hours run 0 to 23 in order", chart.hours === [...Array(24).keys()].join(","));
  check("the bars differ, so the chart says something", chart.distinctHeights > 2,
    chart.distinctHeights + " distinct heights");
  check("it names the cheapest hour in words", /Cheapest arriving|same/i.test(chart.note || ""),
    (chart.note || "").slice(0, 90));
  check("every bar says its hour and price on hover", chart.titled);
  check("the cheapest hour is marked", chart.marksBest);

  // Tapping a bar prices that arrival - the chart is a control, not a picture.
  const before = await page.evaluate(() => ({
    total: document.querySelector(".fee-n").textContent,
    start: state.stay.start,
  }));
  const target = await page.evaluate(() => {
    const bars = [...document.querySelectorAll(".day-bars [data-hour]")];
    const best = bars.find((b) => b.classList.contains("best")) || bars[20];
    return +best.dataset.hour;
  });
  await page.click(".day-bars [data-hour='" + target + "']");
  await page.waitForTimeout(450);
  const after = await page.evaluate(() => ({
    total: document.querySelector(".fee-n").textContent,
    hour: state.stay.start ? new Date(state.stay.start.getTime() + 8 * 3600000).getUTCHours() : null,
    laterOn: !document.querySelector("#laterBox").hidden,
  }));
  check("tapping an hour sets that arrival time", after.hour === target,
    "wanted " + target + ", got " + after.hour);
  check("tapping an hour switches to Later", after.laterOn);
  check("tapping an hour re-prices the carpark", after.total !== before.total || before.start !== null,
    before.total + " -> " + after.total);

  // The list should read as a comparison, not a directory.
  await page.click("#back");
  await page.waitForTimeout(400);
  const compare = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".row[data-id]")];
    const read = (row) => {
      const t = row.querySelector(".price").textContent.trim();
      return t === "Free" ? 0 : /^\$/.test(t) ? Number(t.slice(1)) : null;
    };
    const priced = rows.map(read).filter((v) => v !== null);
    const min = priced.length ? Math.min.apply(null, priced) : null;
    const marked = rows.filter((r) => /Cheapest nearby/.test(r.textContent));
    return {
      spread: new Set(priced).size > 1,
      marked: marked.length,
      allMarkedAreCheapest: marked.every((r) => read(r) === min),
      deltas: [...document.querySelectorAll(".row[data-id] .tag")]
        .filter((t) => /vs cheapest nearby/.test(t.textContent)).length,
    };
  });
  check("the cheapest-nearby mark only ever lands on the cheapest price",
    compare.allMarkedAreCheapest, compare.marked + " marked");
  check("when prices differ, the cheapest is marked and the rest are priced against it",
    !compare.spread || (compare.marked >= 1 && compare.deltas >= 1),
    "spread=" + compare.spread + " marked=" + compare.marked + " deltas=" + compare.deltas);

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
    return { dur: r("#dur"), q: r("#q"), chip: r("#typeChips .chip"), go: r("#go"),
             seg: r("#sortSeg button") };
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
    await auditPriceChart(browser, errors);
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
