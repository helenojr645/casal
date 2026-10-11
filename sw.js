// Rede primeiro (sempre a versao nova quando tem internet); sem internet, abre a ultima copia salva.
// O servidor (Apps Script) nunca passa por aqui: so os arquivos da tela.
var CACHE = 'casal-v1';
var ARQS = ['./', 'index.html', 'app.js', 'motor.js', 'divisao.js', 'operacoes.js', 'config.js', 'manifest.json', 'icon-192.png'];
self.addEventListener('install', function (e) { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARQS); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copia); }); return r;
  }).catch(function () { return caches.match(e.request); }));
});
