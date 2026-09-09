// Offline shell for Carpark SG.
//
// Cache the things that describe carparks; NEVER cache how full they are.
// A lot count served from cache would look live and be hours old, which is
// worse than showing nothing - the whole point of the app is the number being
// current. So availability is network-only and simply absent when offline.

// v3: URA carparks and their rate tables joined the payload, so every cached
// copy of carparks.min.json and rates.js is now short by 657 carparks.
// v4: the page was rebuilt - a rail beside the map on wide screens, sliders for
// the stay, and search suggestions - so a cached index.html is the old app.
// v5: arrival became a time field instead of a slider, the sort/filter rows were
// split apart, and the carpark panel gained the through-the-day price chart.
// v6: the front page is now a verdict about WHEN to park, not a list of
// carparks, so a cached index.html is a different app.
// v7: "find me" now explains a blocked permission instead of failing silently,
// and the hide-list button moved to the edge of the list it hides.
// v8: the panel now switches to "how full is it usually" where every carpark
// charges the same, which is most of the island.
const VERSION = "v8";
const TILES = "tiles-v1";
const SHELL = [
  "./", "./index.html", "./carparks.min.json", "./holidays.json", "./patterns.json",
  "./manifest.json", "./rates.js", "./lib/leaflet.js", "./lib/leaflet.css",
];

// Map tiles are immutable and small, and a map with no tiles is a grey square.
// Keeping the last few hundred means the roads you looked at last are still
// drawn in a car park with no signal. Bounded so it cannot grow forever.
const TILE_LIMIT = 600;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // One missing file must not fail the whole install and leave the app
      // with no cache at all.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Live availability is never cached, in any form.
  if (url.hostname.endsWith("data.gov.sg")) return;

  if (url.hostname.endsWith("onemap.gov.sg")) {
    // Tiles yes, the geocoder no: a cached search result would answer a
    // question the user did not ask this time.
    if (!url.pathname.startsWith("/maps/tiles/")) return;
    e.respondWith(
      caches.open(TILES).then((cache) =>
        cache.match(e.request).then((hit) =>
          hit || fetch(e.request).then((res) => {
            if (res.ok) cache.put(e.request, res.clone()).then(() => trimTiles(cache)).catch(() => {});
            return res;
          })
        )
      )
    );
    return;
  }

  // Network-first for our own files so a redeploy is picked up promptly, with
  // the cache as the fallback when there is no signal.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
