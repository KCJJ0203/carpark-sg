# Carpark SG

**When** parking near you is cheapest — not just where it is. Search a place, say how long you are
staying, and the first thing the app tells you is the hour to arrive:

> **Arrive after 5.00pm and pay free.**
> It is $2.40 arriving 1.00pm, so you save $2.40 by waiting.

Then the map, the list and every price on it move with whatever hour you pick. Covers **2,929
carparks** — every HDB carpark and every URA carpark and on-street bay.

**→ [kcjj0203.github.io/carpark-sg](https://kcjj0203.github.io/carpark-sg/)**

No accounts, no tracking, no server. The page is static; your browser talks to the government's
open-data APIs directly.

## Why this exists

Singapore already has good parking apps, and they answer *"which carpark near me has a space?"*
[wheretopark.sg](https://wheretopark.sg) answers it well — live availability, malls, EV chargers,
walking times, and a per-stay price too.

None of them answer **"what hour should I come?"**, even though rates here step at 8.30am, at 5pm
and at 10.30pm, and change again on Sundays and public holidays. Two hours at the same Orchard
street costs $4.80 at lunchtime and nothing at all after five. That is a bigger saving than picking
a different carpark, and no amount of sorting a list by distance or price will surface it, because
the list only ever describes one moment.

So the front page here is a verdict about time, and the carparks come second.

## What it does

- **Tells you when to arrive**, with the cheapest hours you can still reach marked, and the saving
  named in money. Hours that have already gone are dimmed, not recommended
- **Tap an hour and the whole app re-prices** — the verdict, the list, and every price pin on the map
- **A map of what parking costs** — every pin carries the price for your stay and the lots free now
- **What it will actually cost**, worked out from HDB's published schedule and shown broken down by
  rate band: Central Area, peak hour, night and daily caps, the 15-minute grace period, and the
  half-hour rounding at coupon carparks
- **Park now or later** — rates change at 5pm, at 10.30pm and on Sundays, so a two-hour stay at
  Albert Centre costs $5.60 arriving at 2pm and $2.40 arriving at 6pm. The app prices each half
  hour at whatever rate applies then, so a stay crossing a boundary stays right.
- **A price for every hour of the day** — see what the same stay costs arriving at 9am, at 6pm or at
  midnight, and tap the hour you want
- **Every carpark priced against the cheapest one near it**, so a number means something
- **Filter by carpark type** — multi-storey, surface, basement, covered, and for URA the
  distinction that actually changes the trip: an off-street lot you drive into, or a row of
  parallel bays on a public road
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
| [URA Data Service](https://eservice.ura.gov.sg/maps/api/) — Car Park Details | 657 carparks: location, capacity, **and their rates** | free AccessKey |
| [URA Data Service](https://eservice.ura.gov.sg/maps/api/) — Car Park Availability | live lot counts, 89 carparks reporting | free AccessKey |
| [OneMap](https://www.onemap.gov.sg) | address search, and the map tiles | open |
| [HDB](https://www.hdb.gov.sg/parking/other-parking-matters/shortterm-parking/shortterm-parking-charges) — Short-Term Parking Charges | the rate schedule | published web page |

All official, all permitted, no scraping. Only URA needs a key, it is free, and it is the one source
that publishes its own prices rather than making us read them off a web page — see
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
- **And the predictions have to obey the same rule.** They did not, at first. `hdb:ACM` reported
  every lot free in *all 738* of its readings — dead sensors — and the model dutifully learned
  "usually 100% free now", which is a confident invitation to drive across town to a full carpark.
  The list had been flagging that carpark the whole time; the predictions simply never asked. 21
  carparks were doing it. They are silent now, and silence is the honest answer.

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
source, records when it was read, and `scripts/check-rates.js` re-reads the page weekly and
Telegrams if any figure, either carpark list, or any peak window has moved. It never updates
itself — a rate change deserves a human reading the page.

That check runs from a laptop, not from CI, and the reason is worth recording. HDB serves a
**headless** browser `403 Error - Forbidden` and a windowed one the real page — measured both ways
on one machine in the same minute — and blocks GitHub's runners either way, even windowed under
xvfb. It also has to tell those two cases apart: its first ever run reported twelve confident
findings, every one false, because it had been handed an empty error page and read that as "every
rate changed at once". Each page must now contain a known landmark before any conclusion is drawn
from it. A watchdog that cries wolf is worse than no watchdog.

**Two rate engines, because two sources price differently.** HDB has one national schedule that had
to be transcribed; URA ships a rate table with every carpark, so `src/ura-rates.js` reads prices off
the record and hard-codes nothing. Both return the same shape, so the page prices a mixed list
without knowing which source a row came from. Two things in URA's data are quiet traps:

- **The night rate is two rows, not one.** Angullia Park, 10.30pm—7am, publishes `$0.70 / 30 mins`
  *and* `$5.60 / 510 mins`. 510 minutes is the window, so the second row is the price of the whole
  night, not a second rate: read as one, seventeen half hours bill $11.90 for a night URA sells at
  $5.60. The rule — a row whose charging unit equals the window length is a flat price — was
  checked against every such pair in the live data before it was written: 146 of 146, and in all 146
  the flat price is the cheaper one. All 152 flat rows cross midnight, which is why the cap is
  applied per stay-in-a-window and not per calendar day; grouping by day would have quietly
  overcharged every Saturday night and every holiday eve.
- **An absent rate is not a free rate.** URA writes an explicit `$0.00 / 0 mins` where parking really
  is free — 899 rows do. But 145 rows across 88 carparks carry no rate fields at all, and every one
  of those is an on-street bay overnight or in the morning peak. That may mean free and may equally
  mean no parking allowed. The app prices neither: it says the price is not published and tells you
  to read the signboard, because guessing "free" is the guess that costs money.

**One rate engine per source, bundled once.** Pricing is rate windows, caps and boundary crossings. The page needs
it and so does Node, and re-typing it into the HTML would guarantee the two drifted. `build-web.js`
bundles `src/rates.js`, `src/ura-rates.js` and `src/windows.js` verbatim into `web/rates.js`,
refuses to emit a bundle that still has an unresolved `require()`, and prices a known stay through
each engine as a build-time check — including a whole night at Angullia Park, which has to come
back $5.60 and not $11.90.

**The desktop layout is not the phone layout with more air.** The page began as a map with a
draggable sheet over it, which is right on a phone and wrong on a 1920px monitor, where it produced
a letterboxed map and a list hidden in a drawer. Past 980px the sheet becomes a fixed rail beside
the map, the map takes about three quarters of the window, and the drag handle disappears because
there is nothing left to drag.

On a phone the sheet still drags, but it no longer snaps to three preset heights — it stays where
it is put — and letting go re-anchors the list to the middle of the strip of map you can still see.
That last part is the whole fix: "cheapest near the middle of the map" used to mean the middle of a
map that was half covered by the list quoting it.

**How long you stay is a slider; when you arrive is not.** A length of stay is a magnitude with no
exact value in mind — "about two hours" — so it is a slider, over a scale that is fifteen minutes wide
at the short end and an hour wide at the long end, because 15 versus 30 minutes is a real difference
to a driver (the grace period sits between them) and 9 versus 10 hours is not. An arrival time is
the opposite: a specific moment, where dragging for 6.45pm is guesswork. So that is a real time
field, with chips for the answers people actually give ("in 1 h", "7pm"). Both read out as
`12.00pm → 2.00pm`, because the question is "what will I pay", and that depends on when you leave as
much as when you arrive.

**Where price cannot decide it, our own history can.** HDB charges the same rate all day, so across
most of the island "when is it cheapest" has no answer at all. There the panel switches question and
says so in its heading: *how full carparks near here usually are, hour by hour*, from the readings
this project has been collecting since August. Around Toa Payoh that reads 44% free overnight, 67%
at midday and 56% by 9pm — a housing estate filling up as people come home, which is both the
expected shape and the check that the numbers are real.

It is the median of the ten nearest carparks, not the emptiest of twenty-five: the emptiest is
always some large carpark sitting near 90%, which washes the daily cycle out completely and
describes one carpark rather than an area. Only HDB has this at all — URA reports lots free and
never lots total, so 657 carparks have no pattern to learn from, and hours with too few readings
stay blank rather than being filled in.

**Advice has to be reachable.** The first version of the verdict cheerfully recommended arriving at
2am, because that was genuinely the cheapest hour. It was true and useless: nobody waits thirteen
hours to save $2.40, and on today's date those hours have already gone. So the verdict only ever
considers hours you can still arrive at — from the current hour to the end of the day, or the whole
day if you have picked a future date — and the hours behind you are drawn faint and cannot be clicked.
A run of cheap hours is phrased the way a person would say it, "after 5.00pm", rather than as a list
of eight times.

**A control that fails silently is worse than one that is missing.** The browser shows its location
prompt only the first time; once the answer is remembered it never asks again, so a blocked site
makes "find me" look like a dead button. The app checks the permission first and says exactly that,
with the fix — padlock, set Location to Allow, reload — and tells the difference between blocked,
refused, timed out and simply unavailable. Messages live in their own element rather than in the
list, because the list is rewritten every time the map settles, which is precisely when someone is
looking for the message. And "find me" now uses the same centring as search, so on a phone you are
placed above the sheet rather than behind it.

**Three vehicles, and silence where the source is silent.** URA publishes motorcycle and
heavy-vehicle rates in the same rows the app already downloads — 842 and 664 of them, previously
thrown away. They are priced now: a motorcycle on Aliwal St is $0.01 per 3 minutes, so two hours is
40 cents rather than the car's $2.40. HDB's schedule covers motor cars only, so an HDB carpark
answers "no motorcycle rate here" and says why. Shipping all three tables cost 12KB, because 657
carparks share 46 distinct tables between them.

**Free is not the same as unknown.** Hours a carpark cannot be priced for are drawn hatched, never
as zero, and never counted as the cheapest. This is the same rule as everywhere else in the project,
in the one place where breaking it would look most convincing.

**What it costs through the day, per carpark too.** Open a carpark and the same chart appears for
that one, so you can see whether *this* street follows the area's pattern. The list makes the point
sideways: every row is quoted against the cheapest option near it (`+$2.40 vs cheapest nearby`), and
that mark disappears entirely when every carpark in view charges the same, because then it is not
telling you anything.

**The search suggests, because the geocoder's first answer is often wrong.** Asked for "orchard
road", OneMap returns a HOTEL ON BIDEFORD ROAD first and Orchard Road itself second; asked for
"Jurong Point" it returns a clinic in Taman Jurong. Suggestions appear as you type, each with its
road name or postcode, an exact name match is floated to the top, and a result that IS a road is
labelled as one and zooms the map out — because "I am going to Orchard, where is parking cheap"
wants two kilometres of road, not one shopfront.

**Pins collapse rather than overlap.** A pin carrying both a price and a lot count is wide, and in
town carparks sit close enough that the labels would pile into an unreadable heap. The nearest pin
in a cluster keeps its label; the ones it would cover become dots. No carpark disappears — only the
text on it, and what survives is the one you were most likely to be reading.

## Running it

```bash
npm test                             # 147 tests, no network needed
node scripts/collect.js --carparks   # rebuild the carpark list + one snapshot
node scripts/build-web.js            # regenerate the files the page downloads
node scripts/check-rates.js          # re-read HDB's rates (opens a browser window)
node scripts/coverage.js             # how much history actually landed, per day
node scripts/audit-ura.js            # what URA's adapter produced, priced end to end
node scripts/audit-ui.js             # drives the page like a user at three window sizes
```

`playwright` is the only dependency, and only the rate check uses it — the tests and the site need
nothing installed. URA's free AccessKey goes in `URA_ACCESS_KEY` or
`~/.claude/.secrets/ura-access-key.txt`; without it the collector keeps the URA records it already
has and says so, rather than rebuilding the list as HDB-only and silently deleting 657 carparks.

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
usable. Collection moved to an always-on runner.

**Check the shape of what you collected, not just that collection happened.**

And once more, about a competitor rather than a dataset. Asked whether this app was becoming a
clone of wheretopark.sg, I fetched their site, read the landing page, and reported that they had
"no fees, no arrival time, no duration". All three were wrong. Their landing page is a hero and a
search box; every feature I had ruled out lives one search deeper — the same rail-and-map layout,
the same Leaflet and OneMap tiles, the same duration presets, the same Cheapest/Nearest sort, the
same $4.80 for the same carpark. The next build then "differentiated" against a picture that was
wrong, and moved *toward* them.

It is the identical mistake to the rate watchdog reading an empty 403 page as twelve rate changes:
a conclusion drawn from a page that did not contain the thing being judged. **Drive the flow before
describing what a thing does.** The right answer, once the flow had actually been driven, was not to
look different but to answer a different question.

And then it happened a third time, which is why that sentence is now a script. GitHub's scheduler
quietly stopped dispatching the workflow — 26 snapshots a day became 3 — while every run that did
fire reported success, none were cancelled, and the workflow sat there marked active. The
once-daily publish workflow decayed in exactly the same shape, which is what proved it was
GitHub's scheduler rather than our cron. Meanwhile the laptop task had been collecting a *perfect*
48 a day across all 24 hours and publishing none of it, because it wrote to disk and never pushed.

Collection now comes from three overlapping sources and `scripts/coverage.js` reports snapshots,
hours covered and the longest gap per day — the gap being the part that hurts, since it is a time
of day the app can never learn anything about. See [docs/COLLECTION.md](docs/COLLECTION.md).

## Limits

- **HDB and URA only.** Shopping-mall and private carparks need LTA DataMall and are not included
  yet. The app says so rather than letting an empty list read as "no parking nearby".
- **URA publishes a live lot count for 89 of its 657 carparks**, and those need an API key, which a
  static page cannot hold. So URA carparks show a price and no live number, and say why. Their
  readings are still collected, because a day of history not collected is gone for good.
- **URA reports how many lots are free and never how many exist**, so there is no fullness bar for
  them and they cannot feed the predictions. `parkCapacity` was checked as a substitute and
  rejected: three carparks in one live sample reported more lots free than their stated capacity.
- **87 URA carparks cannot be priced for an overnight stay**, because URA publishes no rate for
  those hours. See the note above.
- Distances are straight-line, not walking routes.
- Availability is whatever the operator reports, and it can lag reality.
- **Motorcycles and lorries are priced only where URA prices them** — 214 and 162 carparks. HDB
  publishes a schedule for motor cars, so anything else at an HDB carpark says "no motorcycle rate
  here" rather than quoting the car price, which would be wrong in the direction that costs money.
- Season parking is not priced. 111 carparks offer nothing else, and the app says "season parking
  only" instead of inventing an hourly rate for them.
- Whether a public holiday counts as a "weekend" for the 12 peak-hour carparks is not stated on
  HDB's page, so the app goes by the actual day of the week. Most HDB carparks are free on public
  holidays anyway, which makes this moot nearly everywhere it could apply.
