// Service Worker: hält die App-Hülle bereit, damit das Terminal auch bei kurzem Netzausfall sofort startet.
// Buchungen laufen über den Server; bei Netzausfall legt das Terminal sie verschlüsselt in IndexedDB ab (app/terminal/offline-queue.ts).
const CACHE = "naya-time-shell-v4";
const SHELL = ["/terminal", "/brand/naya-logo.svg", "/manifest.webmanifest", "/icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // API nie aus dem Cache
  if (e.request.mode === "navigate") {
    // Nur das Terminal wird für den Offline-Start vorgehalten. Verwaltung und Portal nie zwischenspeichern.
    if (url.pathname !== "/terminal") return;
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match("/terminal")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })));
  }
});
