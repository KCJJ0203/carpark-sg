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

async function open(browser, width, height, errors, opts) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    geolocation: (opts && opts.geolocation) || { latitude: 1.3521, longitude: 103.8198 },
    permissions: (opts && opts.permissions) || [],
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

// Two controls that have to behave, because when they misbehave they do it
// silently: a button that hides a panel it is nowhere near, and a button whose
// browser prompt only ever appears once.
async function auditChrome(browser, errors) {
  console.log("\n== find me, and the hide-list button ==");

  // 1. The hide-list button should sit beside the list, not in the far corner
  //    of the map.
  {
    const { ctx, page } = await open(browser, 1600, 900, errors);
    const geo = await page.evaluate(() => {
      const b = document.querySelector("#layoutBtn").getBoundingClientRect();
      const rail = document.querySelector("#sheet").getBoundingClientRect();
      const locate = document.querySelector("#locate").getBoundingClientRect();
      return { btnLeft: b.left, btnRight: b.right, railRight: rail.right,
               winW: innerWidth, locateRight: locate.right, overlap: b.top < rail.bottom };
    });
    check("the hide-list button sits at the edge of the list it hides",
      Math.abs(geo.btnLeft - geo.railRight) < 40,
      "button at " + Math.round(geo.btnLeft) + ", rail edge at " + Math.round(geo.railRight));
    check("it is no longer in the far corner of the map",
      geo.btnRight < geo.winW - 200, Math.round(geo.winW - geo.btnRight) + "px from the right edge");
    check("find-me stays in the map corner where it belongs",
      geo.locateRight > geo.winW - 60);

    // Hiding the rail must not strand the button off-screen.
    await page.click("#layoutBtn");
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => {
      const b = document.querySelector("#layoutBtn").getBoundingClientRect();
      return { left: b.left, visible: b.left >= 0 && b.right <= innerWidth };
    });
    check("with the list hidden the button is still reachable", hidden.visible,
      "left " + Math.round(hidden.left));
    await ctx.close();
  }

  // 2. Find me, with permission refused. The browser shows its prompt only the
  //    first time; after that a click looks like it does nothing at all, which
  //    is the one case a generic error message cannot help with.
  {
    const { ctx, page } = await open(browser, 1600, 900, errors, { permissions: [] });
    await page.click("#locate");
    await page.waitForTimeout(2500);
    const msg = await page.evaluate(() => {
      const el = document.querySelector("#notice");
      return { shown: !el.hidden, bad: el.className.indexOf("bad") !== -1, text: el.textContent };
    });
    check("refusing location says so instead of failing quietly", msg.shown && msg.bad,
      msg.text.slice(0, 80));
    check("and it says what to do about it",
      /address bar|allow|search for a place/i.test(msg.text), msg.text.slice(0, 110));

    // The original bug: the message was written into the list, and the next map
    // move rewrote the list and wiped it.
    await page.evaluate(() => state.map.panBy([120, 90]));
    await page.waitForTimeout(900);
    check("the message survives the map moving",
      await page.evaluate(() => !document.querySelector("#notice").hidden));

    await page.click("#notice button");
    await page.waitForTimeout(200);
    check("the message can be dismissed",
      await page.evaluate(() => document.querySelector("#notice").hidden));
    await ctx.close();
  }

  // 3. Find me, allowed.
  {
    const { ctx, page } = await open(browser, 1600, 900, errors,
      { permissions: ["geolocation"], geolocation: { latitude: 1.3006, longitude: 103.8388 } });
    await page.click("#locate");
    await page.waitForFunction(() => state.me, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    const found = await page.evaluate(() => ({
      me: state.me,
      dot: !!document.querySelector(".me-dot"),
      noticeGone: document.querySelector("#notice").hidden,
      centre: state.centre,
      where: document.querySelector("#where").textContent,
    }));
    check("allowing location finds you", !!found.me &&
      Math.abs(found.me.lat - 1.3006) < 0.01, JSON.stringify(found.me));
    check("your position is drawn on the map", found.dot);
    check("the list re-anchors to you", /\byou\b/.test(found.where), found.where.slice(0, 60));
    check("the busy message clears once you are found", found.noticeGone);
    await ctx.close();
  }

  // 4. On a phone, "you" must not land behind the sheet.
  {
    const { ctx, page } = await open(browser, 390, 844, errors,
      { permissions: ["geolocation"], geolocation: { latitude: 1.3006, longitude: 103.8388 } });
    await page.click("#locate");
    await page.waitForFunction(() => state.me, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    const onScreen = await page.evaluate(() => {
      const pt = state.map.latLngToContainerPoint([state.me.lat, state.me.lng]);
      const sheetTop = document.querySelector("#sheet").getBoundingClientRect().top;
      return { y: pt.y, sheetTop: sheetTop, visible: pt.y > 0 && pt.y < sheetTop };
    });
    check("on a phone you are placed above the sheet, not behind it", onScreen.visible,
      "y=" + Math.round(onScreen.y) + " sheet starts at " + Math.round(onScreen.sheetTop));
    await ctx.close();
  }
}

// A walking estimate that does not pretend to be a route.
async function auditWalk(browser, errors) {
  console.log("\n== how far it is on foot ==");
  const { ctx, page } = await open(browser, 1600, 1000, errors);
  await page.evaluate(() => goTo(1.3006, 103.8388, 16));
  await page.waitForTimeout(900);

  // The FIRST .meta of each row is the distance line; rows also carry a second
  // one for the live count, which has nothing to say about walking.
  // Read the spans separately: textContent runs them together, so "170 m" and
  // "On-street" arrive as "170 mOn-street" and no word boundary survives.
  const rows = await page.evaluate(() => [...document.querySelectorAll(".row[data-id]")]
    .slice(0, 6).map((r) => [...r.querySelector(".meta").children]
      .map((e) => e.textContent.trim()).filter(Boolean).join(" | ")));
  check("each row says how long the walk is", rows.every((t) => /min walk/.test(t)),
    JSON.stringify(rows.slice(0, 2)));
  check("it is marked as an estimate, not a promise",
    rows.every((t) => /~\s*\d+ min walk/.test(t)), rows[0]);
  check("the distance is still there beside it",
    rows.every((t) => /\d+\s*(m|km)\b/.test(t)), rows[0]);

  // Longer walks must read as longer, or the number is decoration.
  const scale = await page.evaluate(() => {
    const w = (m) => walkMins(m);
    return { near: w(100), mid: w(500), far: w(1200) };
  });
  check("the estimate grows with the distance",
    scale.near < scale.mid && scale.mid < scale.far, JSON.stringify(scale));
  check("a 500m walk lands in a believable range", scale.mid >= 5 && scale.mid <= 9,
    scale.mid + " min for 500 m");

  // And the carpark panel has to admit what it is.
  await page.click(".row[data-id]");
  await page.waitForTimeout(500);
  const note = await page.evaluate(() =>
    [...document.querySelectorAll(".detail .note")].map((n) => n.textContent).join(" "));
  check("the panel says the walk is not a route",
    /not a route|straight line/i.test(note), note.replace(/\s+/g, " ").slice(0, 110));

  await ctx.close();
}

// URA prices motorcycles and lorries; HDB's transcribed schedule is cars only.
// Quoting a car rate for a motorcycle would be wrong in the direction that
// costs money, so the app has to say it does not know.
async function auditVehicles(browser, errors) {
  console.log("\n== motorcycles and lorries ==");
  const { ctx, page } = await open(browser, 1600, 1000, errors);

  const chips = await page.$$eval("#vehChips .chip", (b) => b.map((x) => x.textContent.trim()));
  check("you can say what you are parking", chips.length === 3, JSON.stringify(chips));
  check("car is the default",
    await page.$eval("#vehChips [data-veh='car']", (b) => b.getAttribute("aria-pressed") === "true"));

  // Aliwal St is a URA street with a published motorcycle rate: $0.01 per 3 min
  // from 08.30 to 22.00, free either side. Two hours from 9am is $0.40.
  const priced = await page.evaluate(() => {
    const c = state.carparks.find((x) => x.i === "ura:A0004");
    state.vehicle = "motorcycle";
    const bike = feeForCarpark(c, new Date("2026-08-19T09:00:00+08:00"), 120);
    state.vehicle = "car";
    const car = feeForCarpark(c, new Date("2026-08-19T09:00:00+08:00"), 120);
    return { bike: bike.total, bikeWhy: bike.unavailable, car: car.total, has: c.rm !== undefined };
  });
  check("URA motorcycle rates are carried through to the page", priced.has);
  check("a motorcycle is priced at the motorcycle rate", priced.bike === 0.4,
    "bike $" + priced.bike + " vs car $" + priced.car);
  check("and it is not simply the car price", priced.bike !== priced.car);

  // HDB publishes no short-term motorcycle rate on the page this project reads.
  const hdb = await page.evaluate(() => {
    const c = state.carparks.find((x) => x.i.startsWith("hdb:") && x.r === undefined);
    state.vehicle = "motorcycle";
    const f = feeForCarpark(c, new Date("2026-08-19T09:00:00+08:00"), 120);
    state.vehicle = "car";
    return { total: f.total, why: f.unavailable, id: c.i };
  });
  check("an HDB carpark is NOT quoted a car rate for a motorcycle",
    hdb.total === null && hdb.why === "vehicle-not-priced", hdb.id + " -> " + hdb.why);

  // And it has to say so in words, not just show a blank.
  await page.click("#vehChips [data-veh='motorcycle']");
  await page.waitForTimeout(600);
  await page.evaluate(() => goTo(1.3343, 103.8563, 16));   // Toa Payoh, all HDB
  await page.waitForTimeout(900);
  const said = await page.evaluate(() => ({
    prices: [...document.querySelectorAll(".row[data-id] .price")].map((e) => e.textContent),
  }));
  check("the list says why rather than showing nothing",
    said.prices.length > 0 && said.prices.every((t) => /motorcycle rate/i.test(t)),
    JSON.stringify(said.prices.slice(0, 2)));

  await page.click(".row[data-id]");
  await page.waitForTimeout(500);
  const detail = await page.evaluate(() => document.querySelector(".fee-box").textContent);
  check("the carpark panel explains the gap",
    /motor cars only|signboard/i.test(detail), detail.replace(/\s+/g, " ").slice(0, 110));

  await ctx.close();
}

// The app's whole reason to exist: not "which carpark", but "what hour".
async function auditWhenPanel(browser, errors) {
  console.log("\n== when to go (the front page) ==");
  const { ctx, page } = await open(browser, 1600, 1000, errors);
  await page.evaluate(() => goTo(1.3006, 103.8388, 16));
  await page.waitForTimeout(900);

  const panel = await page.evaluate(() => {
    const el = document.querySelector("#when .when-panel");
    if (!el) return { present: false };
    const list = document.querySelector("#list");
    return {
      present: true,
      aboveTheList: el.getBoundingClientRect().top < list.getBoundingClientRect().top,
      verdict: document.querySelector(".verdict").textContent.trim(),
      sub: document.querySelector(".verdict-sub").textContent.trim(),
      bars: el.querySelectorAll("[data-hour]").length,
    };
  });
  check("the answer is on the page before any interaction", panel.present);
  check("it comes before the list of carparks", panel.aboveTheList);
  check("one bar per hour of the day", panel.bars === 24, String(panel.bars));
  // The verdict has to say a PRICE, not just gesture at one.
  check("the verdict quotes a price or says it is free",
    /\$\d|free/i.test(panel.verdict), panel.verdict);
  check("it names the carpark or explains the price",
    panel.sub.length > 15, panel.sub.slice(0, 90));

  // Tapping an hour has to move everything: the verdict, the list AND the map.
  const before = await page.evaluate(() => ({
    verdict: document.querySelector(".verdict").textContent.trim(),
    pins: [...document.querySelectorAll(".pin .lab span")].map((e) => e.textContent).join("|"),
    prices: [...document.querySelectorAll(".row[data-id] .price")].map((e) => e.textContent).join("|"),
  }));
  const cheapHour = await page.evaluate(() => {
    const best = document.querySelector("#when .day-bars .best");
    return best ? +best.dataset.hour : null;
  });
  check("the cheapest hours are marked on the strip", cheapHour !== null, String(cheapHour));
  await page.click("#when .day-bars [data-hour='" + cheapHour + "']");
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    verdict: document.querySelector(".verdict").textContent.trim(),
    pins: [...document.querySelectorAll(".pin .lab span")].map((e) => e.textContent).join("|"),
    prices: [...document.querySelectorAll(".row[data-id] .price")].map((e) => e.textContent).join("|"),
    hour: state.stay.start ? new Date(state.stay.start.getTime() + 8 * 3600000).getUTCHours() : null,
  }));
  check("tapping an hour sets that arrival", after.hour === cheapHour,
    "wanted " + cheapHour + ", got " + after.hour);
  check("the verdict updates with the hour", after.verdict !== before.verdict,
    before.verdict.slice(0, 50) + " -> " + after.verdict.slice(0, 50));
  check("the list re-prices with the hour", after.prices !== before.prices);
  check("the PRICES ON THE MAP move with the hour", after.pins !== before.pins,
    before.pins.slice(0, 40) + " -> " + after.pins.slice(0, 40));

  // It must not invent a saving where there is none.
  const flat = await page.evaluate(() => {
    const bars = [...document.querySelectorAll("#when .day-bars [data-hour]")];
    const titles = bars.map((b) => b.getAttribute("title"));
    const prices = titles.map((t) => t.split(": ")[1]);
    const distinct = new Set(prices).size;
    const verdict = document.querySelector(".verdict").textContent;
    return { distinct: distinct, saysSaving: /save/i.test(document.querySelector(".verdict-sub").textContent),
             verdict: verdict };
  });
  // "Cheapest at 2am" is true and useless, and on today's date already gone.
  const forward = await page.evaluate(() => {
    const bars = [...document.querySelectorAll("#when .day-bars [data-hour]")];
    const nowHour = new Date(Date.now() + 8 * 3600000).getUTCHours();
    const isToday = !state.stay.start ||
      new Date(state.stay.start.getTime() + 8 * 3600000).toISOString().slice(0, 10) ===
      new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    return {
      isToday: isToday,
      pastDisabled: bars.filter((b) => +b.dataset.hour < nowHour).every((b) => b.disabled),
      bestHours: bars.filter((b) => b.classList.contains("best")).map((b) => +b.dataset.hour),
      nowHour: nowHour,
      verdict: document.querySelector(".verdict").textContent,
    };
  });
  check("hours that have already gone cannot be chosen",
    !forward.isToday || forward.pastDisabled);
  check("the cheapest hour recommended is one you can still arrive at",
    forward.bestHours.every((h) => h >= forward.nowHour),
    "now " + forward.nowHour + ", marked " + JSON.stringify(forward.bestHours));

  check("a saving is only claimed when the day actually has one",
    flat.distinct > 1 || !flat.saysSaving,
    flat.distinct + " distinct prices, saving claimed: " + flat.saysSaving);

  // HDB charges the same all day, so in the heartlands the price question has
  // no answer and the panel has to ask the one our own history CAN answer.
  await page.evaluate(() => goTo(1.3343, 103.8563, 16));   // Toa Payoh
  await page.waitForTimeout(1200);
  const space = await page.evaluate(() => {
    const head = document.querySelector("#when .fee-h").textContent;
    const bars = [...document.querySelectorAll("#when .day-bars [data-hour]")];
    const titles = bars.map((b) => b.getAttribute("title") || "");
    const pctOf = (t) => { const m = /(\d+)%/.exec(t); return m ? +m[1] : null; };
    const values = titles.map(pctOf).filter((v) => v !== null);
    return {
      head: head,
      sub: document.querySelector(".verdict-sub").textContent,
      verdict: document.querySelector(".verdict").textContent,
      says: /usually free|lots usually free/.test(titles.join(" ")),
      spread: values.length ? Math.max.apply(null, values) - Math.min.apply(null, values) : 0,
      overnight: pctOf(titles[3] || ""),
      midday: pctOf(titles[12] || ""),
    };
  });
  check("where every price is the same, the panel asks about space instead",
    /how full/i.test(space.head), space.head);
  check("the heading says which question it is answering", /usually/i.test(space.head));
  check("the bars are labelled as lots free, not dollars", space.says);
  check("it explains that price cannot decide it here",
    /charges .* whenever you arrive/i.test(space.sub), space.sub.slice(0, 90));
  check("no saving is invented where every price is equal", !/save/i.test(space.sub));
  // Residential carparks fill overnight and empty in the day. If the numbers do
  // not show that, the history or the maths is wrong.
  check("the daily cycle is actually visible", space.spread >= 10,
    space.spread + " percentage points between the emptiest and fullest hour");
  check("it is fuller overnight than at midday, as a housing estate should be",
    space.overnight !== null && space.midday !== null && space.overnight < space.midday,
    "3am " + space.overnight + "% vs noon " + space.midday + "%");

  // And back in town, where rates really do change, it asks about money again.
  await page.evaluate(() => goTo(1.3006, 103.8388, 16));
  await page.waitForTimeout(1200);
  check("in town it goes back to asking about price",
    await page.evaluate(() => /cheapest/i.test(document.querySelector("#when .fee-h").textContent)));

  // This runs on every pan, so it cannot be slow.
  const ms = await page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) render();
    return (performance.now() - t0) / 5;
  });
  check("a full re-render stays under 150ms", ms < 150, Math.round(ms) + "ms");

  await ctx.close();
}

// Per carpark, the same question asked in the panel above.
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
    const seen = (el) => {
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return b.top >= sheet.top && b.bottom <= sheet.bottom + 1 && b.height > 0;
    };
    const q = document.querySelector("#q");
    const keep = q.value;
    q.value = q.placeholder;
    const placeholder = q.scrollWidth <= q.clientWidth + 1;
    q.value = keep;
    return {
      verdict: seen(document.querySelector(".verdict")),
      bars: seen(document.querySelector("#when .day-bars")),
      placeholder: placeholder,
      mapShare: (sheet.top / innerHeight),
    };
  });
  // The app opens with its answer, not with the controls that produce one.
  check("the verdict is on screen without dragging", room.verdict);
  check("the hour bars are on screen without dragging", room.bars);
  check("the map still gets a usable share of a phone screen",
    room.mapShare > 0.38, Math.round(room.mapShare * 100) + "%");
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
    await auditChrome(browser, errors);
    await auditVehicles(browser, errors);
    await auditWalk(browser, errors);
    await auditWhenPanel(browser, errors);
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
