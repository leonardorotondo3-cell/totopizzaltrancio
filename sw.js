/* ============================================================
   Service worker del sito di Totò

   Esiste per una ragione sola: senza, Chrome su Android non offre
   l'installazione vera dell'app e lascia solo una scorciatoia del
   browser.

   NON mette niente in cache, di proposito. Un menu servito da una cache
   vecchia mostrerebbe prezzi che non sono più quelli, e il cliente se ne
   accorgerebbe alla consegna: peggio di un sito che si apre lento.
   Tutto passa dalla rete; se la rete manca, si dice.
   ============================================================ */

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><title>Senza connessione</title>' +
      '<body style="font:16px/1.5 system-ui;padding:2rem;background:#EFEBE6;color:#2A2422">' +
      '<h1 style="color:#C8102E">Manca la connessione</h1>' +
      '<p>Il menu e gli ordini hanno bisogno della rete. Riprova fra un momento.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  );
});
