// What did the URA adapter actually produce?
//
//   node scripts/audit-ura.js
//
// WHY THIS EXISTS: this project has twice been caught believing a green tick.
// The collector reported success while dropping to 3 snapshots a day, and the
// rate watchdog reported twelve confident findings off an empty error page.
// "It fetched without throwing" says nothing about whether the data is usable,
// so this prints the shape and flags the things that would be wrong quietly.
//
// It reads live and writes nothing.

const ura = require("../src/sources/ura");
const { feeFor } = require("../src/ura-rates");

const pct = (n, of) => (of ? Math.round((n / of) * 100) + "%" : "-");

async function main() {
  const { carparks, dropped } = await ura.fetchCarparks();
  console.log("carparks with car rates:", carparks.length, "| dropped (no position/no car lots):", dropped);

  const off = carparks.filter((c) => c.type === "OFF-STREET CAR PARK").length;
  console.log("  off-street:", off, "| on-street:", carparks.length - off);
  const coupon = carparks.filter((c) => /COUPON/i.test(c.parkingSystem || "")).length;
  console.log("  coupon:", coupon, "| electronic:", carparks.length - coupon);
  console.log("  free at some hour:", carparks.filter((c) => c.freeParking.length).length);

  // Every carpark must land in Singapore. A bad projection is the one error
  // that looks fine in a table and absurd on a map.
  const offshore = carparks.filter((c) =>
    !(c.lat > 1.15 && c.lat < 1.48 && c.lng > 103.6 && c.lng < 104.1));
  console.log("  outside Singapore's bounding box:", offshore.length,
    offshore.length ? JSON.stringify(offshore.slice(0, 3).map((c) => [c.id, c.lat, c.lng])) : "");

  // Price a two-hour stay starting now at every carpark, and a whole night, and
  // see what comes back. A rate engine that silently returns $0 or something
  // absurd shows up here and nowhere else.
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(23, 0, 0, 0);

  for (const [label, start, mins] of [
    ["2 hours from now", now, 120],
    ["23:00 tonight, 8 hours", tonight, 480],
  ]) {
    const priced = [];
    const reasons = {};
    for (const c of carparks) {
      const f = feeFor(c, start, mins, () => false);
      if (f.total === null) reasons[f.unavailable || "unknown"] = (reasons[f.unavailable || "unknown"] || 0) + 1;
      else priced.push({ id: c.id, name: c.name, total: f.total, capped: f.capApplied });
    }
    priced.sort((a, b) => a.total - b.total);

    console.log("\n--- " + label + " (" + start.toString().slice(0, 24) + ") ---");
    console.log("priced:", priced.length, "(" + pct(priced.length, carparks.length) + ")",
      "| not priced:", JSON.stringify(reasons));
    if (priced.length) {
      const free = priced.filter((p) => p.total === 0).length;
      console.log("free:", free, "| cheapest paid:",
        JSON.stringify(priced.filter((p) => p.total > 0).slice(0, 3).map((p) => p.name + " $" + p.total)));
      console.log("dearest:", JSON.stringify(priced.slice(-3).reverse().map((p) => p.name + " $" + p.total)));
      console.log("capped by a whole-period rate:", priced.filter((p) => p.capped).length);
      const absurd = priced.filter((p) => p.total > 60);
      if (absurd.length) {
        console.log("!! OVER $60 FOR THIS STAY:", JSON.stringify(absurd.slice(0, 5)));
        process.exitCode = 1;
      }
    }
  }

  const avail = await ura.fetchAvailability();
  const carLots = avail.filter((a) => a.lots.some((l) => l.type === "C"));
  console.log("\nlive availability: " + avail.length + " carparks reporting,",
    carLots.length, "with car lots");
  const joined = carLots.filter((a) => carparks.some((c) => c.id === a.id));
  console.log("of those, joining to a carpark record:", joined.length,
    "(" + pct(joined.length, carLots.length) + ")");
  console.log("carparks with a price and NO live count:",
    carparks.length - joined.length,
    "(" + pct(carparks.length - joined.length, carparks.length) + ") - the UI must say so");

  // The join is the check that killed the previous project when it was skipped.
  if (carLots.length && joined.length / carLots.length < 0.9) {
    console.log("\n!! Most live readings do not match a carpark record. Something is wrong");
    console.log("   with the ppCode/carparkNo join, not with the weather.");
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
