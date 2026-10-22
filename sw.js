const CACHE_NAME = "doktori-static-v33";
const STATIC_FILES = [
    "./", "./index.html", "./account/signin.html", "./account/register.html", "./account/blocked.html", "./css/theme.css", "./css/footer.css", "./css/qr-scanner.css", "./js/qr-scanner.js",
    "./js/auth.js", "./js/firebase.js", "./js/app-ui.js", "./js/event-config.js", "./js/chat.js", "./js/admin-guard.js", "./js/auth.js?v=27", "./js/app-ui.js?v=27", "./js/chat.js?v=27", "./account/mypage.html", "./support/info.html", "./support/chat.html", "./support/chat.html?access=blocked&v=27", "./admin/index.html", "./offline.html", "./icon.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (event.request.mode === "navigate") {
        event.respondWith(fetch(event.request).catch(() => caches.match("./offline.html")));
        return;
    }
    event.respondWith(fetch(event.request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
    }).catch(() => caches.match(event.request)));
});
