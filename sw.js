// Offline shell for Carpark SG.
//
// Cache the things that describe carparks; NEVER cache how full they are.
// A lot count served from cache would look live and be hours old, which is
// worse than showing nothing - the whole point of the app is the number being
// current. So availability is network-only and simply absent when offline.

const VERSION = "v1";
const SHELL = ["./", "./index.html", "./carparks.min.json", "./holidays.json", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Live availability and geocoding are never cached.
  if (url.hostname.endsWith("data.gov.sg") || url.hostname.endsWith("onemap.gov.sg")) return;

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
