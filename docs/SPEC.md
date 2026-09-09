# SG Carpark Live — v1 spec

**Goal:** answer *"where can I park near here right now, how full is it, and will it cost me
anything?"* — for **every carpark in Singapore**, eventually.

v1 ships HDB carparks only. Everything below is designed so the other sources plug in rather than
force a rewrite, because "everything everywhere" is the stated end goal, not a maybe.

## Verified before designing

This project exists because the previous one (BasketSG) died on an unchecked data supply. So the
supply was checked first:

| check | result |
|---|---|
| HDB carparks with location data | 2,270 |
| Carparks reporting live availability | 2,015 |
| **Join succeeds on `car_park_no`** | **2,007 — effectively 100%** |
| Reporting real lot counts | 2,003 |
| Offering free parking at some hours | 1,506 |
| Licence | open, official, `Allow: /`, no key |

Eight live carparks have no location record. They are dropped and counted, never guessed at.

## Sources

| source | status | needs |
|---|---|---|
| **HDB** (data.gov.sg) | **shipped** | nothing |
| **URA** (URA Data Service) | **shipped 9 Sep 2026** | free AccessKey + daily token; carries its own RATES |
| LTA DataMall | later | free AccountKey; covers malls and private carparks |

**Rates are not in any dataset.** Every dataset on data.gov.sg was searched; none carries a price.
HDB publishes its schedule as a web page, so `src/rates.js` transcribes it and pins the date it was
read, and `scripts/check-rates.js` re-reads the page monthly and fails if anything moved. When URA
arrives it brings machine-readable rates with it, which is a reason to prefer its own adapter's
figures over anything transcribed — a source-agnostic `feeFor` per adapter, not one global table.

URA arrived the way this section promised: one new adapter (`src/sources/ura.js`), one new fee
engine (`src/ura-rates.js`), one line added to `SOURCES` in the collector. Storage, matching and
display were untouched. The one assumption that did have to give was that every availability
reading has a total — see the traps below.

**Every record carries its `source`.** IDs are namespaced (`hdb:ACB`) so two sources can never
collide, and so the UI can say where a number came from. Adding a source means writing one adapter
and registering it — no change to storage, matching or display.

## The common shapes

Both are deliberately source-agnostic. An adapter's only job is to produce these.

```js
// A place you can park. Changes rarely; refreshed weekly.
{ id: "hdb:ACB", source: "hdb", name, address,
  lat, lng,                    // ALWAYS WGS84 - see the SVY21 note
  type,                        // surface / multi-storey / basement
  gantryHeight,                // metres, null if unknown - matters for tall vehicles
  freeParking,                 // parsed windows, [] when never free
  shortTermParking,            // parsed windows, [] when none
  parkingSystem,               // electronic vs coupon: decides per-minute vs half-hour rounding
  nightParking,                // Night Parking Scheme: permits 10.30pm-7am AND caps it at $5.
                               // HDB only. null at URA means "this scheme does not apply here",
                               // which is NOT the same claim as "not allowed overnight"
  capacity,                    // how many lots exist. URA publishes it, HDB does not. NOT a live count
  rates }                      // a source that publishes its own prices brings them here and is
                               // priced by its own engine. null for HDB, whose schedule is transcribed

// How full it is. Changes constantly; collected every few minutes.
{ id: "hdb:ACB", source: "hdb", at,        // ISO timestamp
  lots: [ { type: "C", total, available } ] }   // C=car, Y=motorcycle, H=heavy
// `total` may be null: URA reports how many lots are FREE and never how many exist. Such a reading
// is stored, because readings cannot be collected later, but it can never become a proportion - so
// the predictions skip it and the UI draws no fullness bar for it.
```

## Known data traps

These are recorded because each one is a silent-wrong-answer risk, and a wrong "12 lots free" is
this app's version of a wrong price.

1. **Coordinates are SVY21, not lat/lng.** `x_coord: 30314.79, y_coord: 31490.49`. Treating them as
   degrees puts every carpark off the coast of Africa. Conversion must be tested against known
   points before anything is displayed on a map.
2. **Free-parking windows are prose.** `"SUN & PH FR 7AM-10.30PM"`, `"NO"`. Must be parsed into
   real windows, and "is it free right now?" must account for Sundays and public holidays. Saying
   parking is free when it is not costs the user money.
3. **`total_lots` of 0** appears for some carparks. Treat as unknown, not as "full".
4. **Availability can go stale.** Each record carries `update_datetime`; anything older than
   15 minutes is shown as stale rather than presented as live truth.
5. **No rates in the HDB dataset.** Rates must come from a verified source (URA API, or HDB's
   published rate card confirmed at build time) — never from memory.
6. **URA prices the night as TWO rows**: an accruing rate, and a flat price whose charging unit is
   the whole window. Reading the flat one as a second rate bills $11.90 for a night sold at $5.60.
   All 152 flat rows cross midnight, so the cap must be applied per stay-in-a-window and never per
   calendar day.
7. **A URA row with no rate fields is not a `$0.00` row.** URA writes `$0.00 / 0 mins` where parking
   is genuinely free. 145 rows across 88 carparks carry no rate at all, always on-street and always
   overnight or in the morning peak. That may mean free and may mean no parking; the app asserts
   neither and says the price is not published.
8. **URA `parkCapacity` is not an availability total.** Three carparks in one live sample reported
   more lots free than their stated capacity, so the two figures do not describe the same thing.
   Never divide one by the other.

## Storage

- `data/carparks.json` — the static list, rebuilt weekly.
- `data/history/YYYY-MM-DD.jsonl` — append-only availability snapshots, one JSON object per line.
  Append-only so a failed run can never corrupt earlier history.

History is what makes this more than an API proxy: after a few weeks it can answer *"is this
usually full at 7pm?"* — a prediction from data we collected ourselves.

## Non-goals for v1

- No accounts, no server-side state. Static site plus a scheduled collector, like StudyTracker.
- No navigation or routing. Distance as the crow flies, clearly labelled as such.
- No payments, no bookings.

## Honest limits to state in the UI

- **HDB and URA carparks.** Malls and private carparks are not covered yet. The app must say so
  rather than let a user conclude there is no parking nearby.
- **URA publishes a live lot count for only 89 of its 657 carparks**, and reaching it needs a key a
  static page cannot hold. Those carparks show a price and no live number, and say which.
- Availability is what the operator reports; it can lag reality.
- Distance is straight-line, not walking distance.
