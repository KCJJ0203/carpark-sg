// Sanity checks on what the availability feed reports.
//
// The feed is authoritative about its own numbers but not about whether its
// sensors are working. A wrong "882 lots free" sends someone across town to a
// full carpark, which is this app's version of publishing a wrong price.

// Below this many lots, a completely empty carpark is entirely believable.
//
// Measured, not guessed: of the 36 carparks reporting every lot free in one
// snapshot, the sizes were 4, 4, 4, 10, 10, then 50, 66, 98 and up to 2,754.
// The gap between 10 and 50 is where "plausibly empty" becomes "probably
// broken", so the line goes there.
const PLAUSIBLY_EMPTY_BELOW = 50;

function looksUnreported(total, available) {
  if (!total || available === null || available === undefined) return false;
  return available === total && total >= PLAUSIBLY_EMPTY_BELOW;
}

module.exports = { looksUnreported, PLAUSIBLY_EMPTY_BELOW };
