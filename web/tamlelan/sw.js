// Service worker for Tamlelan (works under any sub-path: everything is relative
// to the SW's own scope). Network-first so updates arrive; cache is only an
// offline fallback for the app shell. Dictation itself still needs internet.
const CACHE = "tamlelan-v15";
const SHELL = [
  "./",
  "index.html",
  "app.js",
  "style.css",
  "manifest.json",
  "icon.svg",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "icon-192.png",
  "icon-512.png",
  "vendor/jszip.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(
        // Add one by one so a single missing file does not abort the install.
        SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts etc.: leave to the browser

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // "no-cache" = revalidate with the server, so a new deploy is picked up
      // immediately instead of waiting for the HTTP cache (GitHub Pages: 10 min).
      const res = await fetch(req, { cache: "no-cache" });
      if (res && res.ok && res.type === "basic") {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await cache.match("index.html", { ignoreSearch: true });
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
