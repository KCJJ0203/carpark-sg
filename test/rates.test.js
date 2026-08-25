const test = require("node:test");
const assert = require("node:assert");
const { feeFor, rateHalfHourAt, isCentral, hasPeakCharges, RATES } = require("../src/rates");
const { parseWindow } = require("../src/windows");

// Every time in this file is Singapore local. The helper does the +8 so the
// tests read as wall-clock, which is how the rate schedule is written.
function sg(iso) {
  return new Date(iso + "+08:00");
}

const never = () => false;

// An ordinary heartland carpark: whole-day short-term, free on Sundays,
// night parking scheme, electronic gantry. 1,838 of the 2,270 look like this.
const ORDINARY = {
  id: "hdb:ACM",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: true,
  shortTermParking: parseWindow("WHOLE DAY"),
  freeParking: parseWindow("SUN & PH FR 7AM-10.30PM"),
};

// Central Area, not on the peak-hour list.
const CENTRAL = {
  id: "hdb:BBB",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: true,
  shortTermParking: parseWindow("WHOLE DAY"),
  freeParking: parseWindow("NO"),
};

// Central Area AND peak-hour: the most expensive combination in Singapore.
const CENTRAL_PEAK = {
  id: "hdb:ACB",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: true,
  shortTermParking: parseWindow("WHOLE DAY"),
  freeParking: parseWindow("NO"),
};

// Peak-hour, outside the Central Area.
const PEAK = {
  id: "hdb:HG9",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: true,
  shortTermParking: parseWindow("WHOLE DAY"),
  freeParking: parseWindow("NO"),
};

const COUPON = {
  id: "hdb:Y99",
  parkingSystem: "COUPON PARKING",
  nightParking: true,
  shortTermParking: parseWindow("WHOLE DAY"),
  freeParking: parseWindow("SUN & PH FR 7AM-10.30PM"),
};

// Season parking only - 111 carparks have neither short-term nor night parking.
const SEASON_ONLY = {
  id: "hdb:SR2",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: false,
  shortTermParking: parseWindow("NO"),
  freeParking: parseWindow("NO"),
};

// Short-term by day, and no night parking scheme: you cannot leave it overnight.
const DAY_ONLY = {
  id: "hdb:Z11",
  parkingSystem: "ELECTRONIC PARKING",
  nightParking: false,
  shortTermParking: parseWindow("7AM-10.30PM"),
  freeParking: parseWindow("NO"),
};

// 2026-08-24 is a Monday, 2026-08-30 a Sunday, 2026-08-29 a Saturday.

test("classifying carparks", async (t) => {
  await t.test("the 16 published Central Area carparks are recognised", () => {
    assert.equal(isCentral("hdb:ACB"), true);
    assert.equal(isCentral("hdb:WCB"), true);
    assert.equal(isCentral("hdb:BRB1"), true);
    assert.equal(isCentral("hdb:ACM"), false);
  });

  await t.test("the 12 published peak-hour carparks are recognised", () => {
    assert.equal(hasPeakCharges("hdb:HG9"), true);
    assert.equal(hasPeakCharges("hdb:MP16"), true);
    assert.equal(hasPeakCharges("hdb:ACM"), false);
  });

  await t.test("both lists match the counts HDB publishes", () => {
    assert.equal(RATES.centralArea.length, 16);
    assert.equal(Object.keys(RATES.peakHour).length, 12);
  });
});

test("the half-hour rate at a moment in time", async (t) => {
  await t.test("outside the Central Area it is 60 cents", () => {
    assert.equal(rateHalfHourAt("hdb:ACM", sg("2026-08-24T14:00"), false), 0.6);
  });

  await t.test("Central Area is $1.20 on a weekday afternoon", () => {
    assert.equal(rateHalfHourAt("hdb:BBB", sg("2026-08-24T14:00"), false), 1.2);
  });

  await t.test("Central Area drops back to 60 cents after 5pm", () => {
    assert.equal(rateHalfHourAt("hdb:BBB", sg("2026-08-24T17:00"), false), 0.6);
  });

  await t.test("Central Area is 60 cents before 7am", () => {
    assert.equal(rateHalfHourAt("hdb:BBB", sg("2026-08-24T06:59"), false), 0.6);
  });

  await t.test("the Central Area day rate covers Saturday but not Sunday", () => {
    assert.equal(rateHalfHourAt("hdb:BBB", sg("2026-08-29T14:00"), false), 1.2);
    assert.equal(rateHalfHourAt("hdb:BBB", sg("2026-08-30T14:00"), false), 0.6);
  });

  await t.test("peak hour outside the Central Area is 80 cents", () => {
    // HG9: weekdays 11am-8pm.
    assert.equal(rateHalfHourAt("hdb:HG9", sg("2026-08-24T12:00"), false), 0.8);
    assert.equal(rateHalfHourAt("hdb:HG9", sg("2026-08-24T10:00"), false), 0.6);
  });

  await t.test("peak hour uses the weekend window at weekends", () => {
    // HG9 weekends start at 9am rather than 11am.
    assert.equal(rateHalfHourAt("hdb:HG9", sg("2026-08-30T09:30"), false), 0.8);
    assert.equal(rateHalfHourAt("hdb:HG9", sg("2026-08-24T09:30"), false), 0.6);
  });

  await t.test("Central Area and peak hour together are $1.40", () => {
    // ACB: weekdays 10am-6pm, and Central 7am-5pm Mon-Sat.
    assert.equal(rateHalfHourAt("hdb:ACB", sg("2026-08-24T14:00"), false), 1.4);
  });

  await t.test("peak hour outside the Central Area day window is 80 cents", () => {
    // ACB at 5:30pm: still peak (until 6pm), no longer the Central day rate.
    assert.equal(rateHalfHourAt("hdb:ACB", sg("2026-08-24T17:30"), false), 0.8);
  });
});

test("pricing a stay", async (t) => {
  await t.test("two hours at an ordinary carpark costs $2.40", () => {
    const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), 120, never);
    assert.equal(f.total, 2.4);
    assert.equal(f.unavailable, null);
  });

  await t.test("two hours in the Central Area costs $4.80", () => {
    const f = feeFor(CENTRAL, sg("2026-08-24T14:00"), 120, never);
    assert.equal(f.total, 4.8);
  });

  await t.test("two hours at Albert Centre on a Monday afternoon costs $5.60", () => {
    const f = feeFor(CENTRAL_PEAK, sg("2026-08-24T14:00"), 120, never);
    assert.equal(f.total, 5.6);
  });

  await t.test("two hours at a peak Hougang carpark costs $3.20", () => {
    const f = feeFor(PEAK, sg("2026-08-24T12:00"), 120, never);
    assert.equal(f.total, 3.2);
  });

  await t.test("a stay that crosses 5pm is charged at both rates", () => {
    // 4pm-6pm in the Central Area: one hour at $1.20/half-hour, one at $0.60.
    const f = feeFor(CENTRAL, sg("2026-08-24T16:00"), 120, never);
    assert.equal(f.total, 3.6);
  });

  await t.test("charging is by the minute at an electronic carpark", () => {
    const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), 40, never);
    assert.equal(f.total, 0.8); // 40 min x 2 cents
  });
});

test("free parking", async (t) => {
  await t.test("Sunday morning is free where the scheme applies", () => {
    const f = feeFor(ORDINARY, sg("2026-08-30T10:00"), 120, never);
    assert.equal(f.total, 0);
    assert.equal(f.free, true);
  });

  await t.test("a public holiday on a weekday is free too", () => {
    const isHoliday = (d) => d === "2026-08-25";
    const f = feeFor(ORDINARY, sg("2026-08-25T10:00"), 120, isHoliday);
    assert.equal(f.total, 0);
  });

  await t.test("free parking ends at 10.30pm and charging resumes", () => {
    // Sunday 10pm for two hours: free until 10.30, then charged.
    const f = feeFor(ORDINARY, sg("2026-08-30T22:00"), 120, never);
    assert.equal(f.total, 1.8); // 90 chargeable minutes x 2 cents
    assert.equal(f.free, false);
  });

  await t.test("a carpark without the scheme is charged on Sundays", () => {
    const f = feeFor(CENTRAL, sg("2026-08-30T10:00"), 120, never);
    assert.equal(f.total, 2.4);
  });
});

test("the 15-minute grace period", async (t) => {
  await t.test("leaving within 15 minutes is free at an electronic carpark", () => {
    const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), 15, never);
    assert.equal(f.total, 0);
    assert.equal(f.grace, true);
  });

  await t.test("16 minutes is charged in full, not minus the grace", () => {
    const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), 16, never);
    assert.equal(f.total, 0.32);
    assert.equal(f.grace, false);
  });

  await t.test("coupon carparks have no grace period", () => {
    const f = feeFor(COUPON, sg("2026-08-24T14:00"), 15, never);
    assert.equal(f.grace, false);
    assert.ok(f.total > 0);
  });
});

test("coupon carparks round up to the half hour", async (t) => {
  await t.test("20 minutes needs one 60-cent coupon", () => {
    const f = feeFor(COUPON, sg("2026-08-24T14:00"), 20, never);
    assert.equal(f.couponTotal, 0.6);
    assert.equal(f.total, 0.4); // Parking.sg still charges by the minute
  });

  await t.test("31 minutes needs two coupons", () => {
    const f = feeFor(COUPON, sg("2026-08-24T14:00"), 31, never);
    assert.equal(f.couponTotal, 1.2);
  });

  await t.test("electronic carparks report no coupon price", () => {
    const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), 20, never);
    assert.equal(f.couponTotal, null);
  });
});

test("caps", async (t) => {
  await t.test("HDB's own example: midnight to 6am is capped at $5, not $7.20", () => {
    const f = feeFor(ORDINARY, sg("2026-08-25T00:00"), 360, never);
    assert.equal(f.total, 5);
    assert.equal(f.capApplied, "night");
  });

  await t.test("just under the cap is charged as metered", () => {
    // 00:00-04:00 = 4 hours x $1.20 = $4.80, below the $5 night cap.
    const f = feeFor(ORDINARY, sg("2026-08-25T00:00"), 240, never);
    assert.equal(f.total, 4.8);
    assert.equal(f.capApplied, null);
  });

  await t.test("a full day outside the Central Area is capped at $12", () => {
    // 7am to 10.30pm is 15.5 hours = $18.60 metered.
    const f = feeFor(CENTRAL_PEAK.nightParking ? { ...ORDINARY, freeParking: [] } : ORDINARY,
      sg("2026-08-24T07:00"), 15.5 * 60, never);
    assert.equal(f.total, 12);
    assert.equal(f.capApplied, "day");
  });

  await t.test("a full day in the Central Area is capped at $20", () => {
    const f = feeFor(CENTRAL, sg("2026-08-24T07:00"), 15.5 * 60, never);
    assert.equal(f.total, 20);
  });

  await t.test("caps do not apply at peak-hour carparks", () => {
    // HG9, 7am to 10.30pm: 4h at $1.20 + 9h at $1.60 + 2.5h at $1.20 = $22.20.
    const f = feeFor(PEAK, sg("2026-08-24T07:00"), 15.5 * 60, never);
    assert.equal(f.capApplied, null);
    assert.ok(f.total > 12, "expected an uncapped total above $12, got " + f.total);
  });
});

test("when a stay cannot be priced", async (t) => {
  await t.test("a season-only carpark reports why rather than quoting $0", () => {
    const f = feeFor(SEASON_ONLY, sg("2026-08-24T14:00"), 120, never);
    assert.equal(f.total, null);
    assert.equal(f.unavailable, "season-only");
  });

  await t.test("parking overnight where there is no night scheme is refused", () => {
    const f = feeFor(DAY_ONLY, sg("2026-08-24T22:00"), 180, never);
    assert.equal(f.total, null);
    assert.equal(f.unavailable, "outside-hours");
  });

  await t.test("the same carpark prices normally inside its hours", () => {
    const f = feeFor(DAY_ONLY, sg("2026-08-24T14:00"), 120, never);
    assert.equal(f.total, 2.4);
    assert.equal(f.unavailable, null);
  });

  await t.test("a night-only carpark prices an overnight stay", () => {
    const nightOnly = { ...DAY_ONLY, nightParking: true, shortTermParking: parseWindow("NO") };
    const f = feeFor(nightOnly, sg("2026-08-24T23:00"), 120, never);
    assert.equal(f.total, 2.4);
  });
});

test("the breakdown explains the total", async (t) => {
  await t.test("every line's amounts add up to the total", () => {
    const f = feeFor(CENTRAL, sg("2026-08-24T16:00"), 120, never);
    const summed = f.lines.reduce((a, l) => a + (l.amount || 0), 0);
    assert.equal(Math.round(summed * 100) / 100, f.total);
  });

  await t.test("a crossing stay is explained as two periods", () => {
    const f = feeFor(CENTRAL, sg("2026-08-24T16:00"), 120, never);
    assert.equal(f.lines.length, 2);
    assert.equal(f.lines[0].rate, 1.2);
    assert.equal(f.lines[1].rate, 0.6);
  });

  await t.test("free minutes appear as a line at zero", () => {
    const f = feeFor(ORDINARY, sg("2026-08-30T22:00"), 120, never);
    assert.ok(f.lines.some((l) => l.rate === 0 && l.amount === 0));
  });
});

test("rounding", async (t) => {
  await t.test("totals are whole cents", () => {
    for (const mins of [7, 13, 23, 47, 91, 137]) {
      const f = feeFor(ORDINARY, sg("2026-08-24T14:00"), mins, never);
      assert.equal(f.total, Math.round(f.total * 100) / 100, mins + " minutes");
    }
  });
});
