# Carpark SG

Live HDB carpark availability and parking fees across Singapore. Open the map, see what every
carpark near you costs for the stay you have in mind, and how full it is right now.

**→ [kcjj0203.github.io/carpark-sg](https://kcjj0203.github.io/carpark-sg/)**

No accounts, no tracking, no server. The page is static; your browser talks to the government's
open-data APIs directly.

## What it does

- **A map of what parking costs** — every pin carries the price for your stay and the lots free now
- **What it will actually cost**, worked out from HDB's published schedule and shown broken down by
  rate band: Central Area, peak hour, night and daily caps, the 15-minute grace period, and the
  half-hour rounding at coupon carparks
- **Park now or later** — rates change at 5pm, at 10.30pm and on Sundays, so a two-hour stay at
  Albert Centre costs $5.60 arriving at 2pm and $2.40 arriving at 6pm. The app prices each half
  hour at whatever rate applies then, so a stay crossing a boundary stays right.
- **Filter by carpark type** — multi-storey, surface, basement or covered
- **Nearest carparks** by geolocation, or by searching any Singapore address, building or postal code
- **Live availability** — lots free right now, with a fullness bar
- **Free right now** — 1,671 HDB carparks are free on Sundays and public holidays, and the app knows
  which, using MOM's official holiday dates rather than a hardcoded list
- **Honest about its data** — readings older than 15 minutes are labelled with their age, and
  carparks whose sensors look dead are flagged instead of shown as empty
- **Works offline** for everything except the live numbers, which are never served stale from cache

## Data

| source | what | licence |
|---|---|---|
| [data.gov.sg](https://data.gov.sg) — HDB Carpark Information | 2,270 carparks: location, type, gantry height, parking hours | open |
| [data.gov.sg](https://data.gov.sg) — Carpark Availability | live lot counts, ~2,015 carparks reporting | open |
| [data.gov.sg](https://data.gov.sg) — Public Holidays (MOM) | 2020-2027, drives "free right now" | open |
| [OneMap](https://www.onemap.gov.sg) | address search, and the map tiles | open |
| [HDB](https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/shortterm-parking-charges) — Short-Term Parking Charges | the rate schedule | published web page |

All official, all permitted, no API key, no scraping. That was a deliberate choice — see
[the lesson below](#what-went-wrong-and-what-it-taught).

## Design decisions worth explaining

**Coordinates.** data.gov.sg publishes carpark positions in **SVY21**, Singapore's national grid, as
metres from a projection origin. Read as latitude and longitude they place every carpark off the
coast of West Africa. The converter is validated against OneMap — which returns both coordinate
systems for the same point — and agrees to **8 centimetres**.

**A wrong number is worse than no number.** Three rules follow from that:

- `total_lots: 0` means *not reporting*, never *full*. Rendering it as full would send people away
  from a carpark that has space.
- A parking-hours string the parser does not recognise yields *no* free window, i.e. "not free".
  Being wrong in that direction costs nothing; the other way earns a fine.
- A large carpark reporting **every** lot free is almost certainly one with dead sensors. In a single
  snapshot, 36 carparks reported 100% free — including one with 2,754 lots. The threshold sits at 50
  lots because the observed sizes were 4, 4, 4, 10, 10, then 50, 66, 98 … 2,754: a four-lot carpark
  really can be empty, so warning about those would train people to ignore the warning.

**Never guess which place you meant.** Searching "Jurong Point" returns a clinic in Taman Jurong as
OneMap's top hit, kilometres from the mall. The app uses an exact name match when there is one and
otherwise asks, showing road names — because a plausible list of carparks near the wrong place is
worse than a question.

**Payload size.** The full carpark records are 839KB. All 2,270 use only **six** distinct
parking-hour patterns, so those became a lookup table instead of 2,270 copies; with coordinates
rounded to about a metre, the download is 248KB.

**The rates are transcribed, and the repo knows it.** There is no parking-rate dataset — every
dataset on data.gov.sg was checked. HDB publishes the schedule as a web page only, and their server
returns 403 to scripted requests, so the numbers in `src/rates.js` were read in a browser and pinned
with the date. Hard-coding was unavoidable; hard-coding *quietly* was not. So the file names its
source, records when it was read, and `scripts/check-rates.js` re-reads the page monthly and fails
loudly if any figure, either carpark list, or any peak window has moved. It never updates itself —
a rate change deserves a human reading the page.

**One rate engine, not two.** Pricing is rate windows, caps and boundary crossings. The page needs
it and so does Node, and re-typing it into the HTML would guarantee the two drifted. `build-web.js`
bundles `src/rates.js` and `src/windows.js` verbatim into `web/rates.js`, refuses to emit a bundle
that still has an unresolved `require()`, and prices a known stay through the bundle as a build-time
check.

**Pins collapse rather than overlap.** A pin carrying both a price and a lot count is wide, and in
town carparks sit close enough that the labels would pile into an unreadable heap. The nearest pin
in a cluster keeps its label; the ones it would cover become dots. No carpark disappears — only the
text on it, and what survives is the one you were most likely to be reading.

## Running it

```bash
npm test                             # 102 tests, no network needed
node scripts/collect.js --carparks   # rebuild the carpark list + one snapshot
node scripts/build-web.js            # regenerate the files the page downloads
node scripts/check-rates.js          # re-read HDB's rates (opens a browser window)
node scripts/coverage.js             # how much history actually landed, per day
```

`playwright` is the only dependency, and only the rate check uses it — the tests and the site need
nothing installed.

The site is plain files in `web/`. Serve that directory with anything.

## What went wrong, and what it taught

This project replaced an earlier one that died. That one compared supermarket prices, and the idea
was sound — but the chains that mattered either blocked collection or had no online catalogue, and
that was only discovered after the matching engine was built. The premise had been tested hard; the
*data supply* never had been.

So this project checked the supply first: **2,007 of 2,015 live carparks join to their location
records** before a line of the app was written.

The same lesson arrived again mid-build. Collection ran from a desktop on a 30-minute schedule and
produced 6-7 samples a day instead of 48, because the machine sleeps — and 12 of 24 hours had *no*
samples at all, including the 5-8pm peak. The scheduled task had been verified: it ran, exited 0,
wrote a file. That proved the mechanism worked and said nothing about whether the data would be
usable. Collection now runs on an always-on runner.

**Check the shape of what you collected, not just that collection happened.**

## Limits

- **HDB carparks only.** Shopping-mall and URA carparks need separate API keys and are not included
  yet. The app says so rather than letting an empty list read as "no parking nearby".
- Distances are straight-line, not walking routes.
- Availability is whatever the operator reports, and it can lag reality.
- Fees cover **motor cars**. Motorcycles, heavy vehicles and the loading bays with their own
  pricing are not quoted rather than quoted approximately.
- Season parking is not priced. 111 carparks offer nothing else, and the app says "season parking
  only" instead of inventing an hourly rate for them.
- Whether a public holiday counts as a "weekend" for the 12 peak-hour carparks is not stated on
  HDB's page, so the app goes by the actual day of the week. Most HDB carparks are free on public
  holidays anyway, which makes this moot nearly everywhere it could apply.
