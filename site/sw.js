/* Service worker de leprixdubetail.fr

   - les fichiers du site (pages, CSS, JS, icônes) sont servis depuis le cache,
     ce qui rend l'application utilisable hors connexion ;
   - les données (JSON des cotations) sont d'abord demandées au réseau, pour
     afficher les derniers prix, avec repli sur le cache si l'on est hors ligne ;
   - à chaque déploiement, __VERSION__ change : un nouveau cache est créé et les
     anciens sont supprimés. */

'use strict';

const VERSION = '__VERSION__';
const CACHE = `leprixdubetail-${VERSION}`;

// Le strict nécessaire pour que le site s'ouvre hors connexion
const COQUILLE = [
  './',
  'index.html',
  'essentiel.html',
  'evolution.html',
  'comprendre.html',
  `style.css?v=${VERSION}`,
  `app.js?v=${VERSION}`,
  `email.js?v=${VERSION}`,
  `d3.min.js?v=${VERSION}`,
  `favicon.svg?v=${VERSION}`,
  'icon-192.png',
  'manifest.webmanifest',
  `data/indicateurs.json?v=${VERSION}`,
  `data/details.json?v=${VERSION}`,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Données et navigation : le réseau d'abord, le cache en secours (hors ligne)
  const donnees = url.pathname.includes('/data/');
  if (donnees || requete.mode === 'navigate') {
    e.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(requete, copie));
          return reponse;
        })
        // hors ligne : on ignore les paramètres de l'adresse (?serie=…&periode=…),
        // sinon une page déjà en cache ne serait pas reconnue
        .catch(() => caches.match(requete, { ignoreSearch: true })
          .then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Fichiers du site : le cache d'abord (leur adresse change à chaque déploiement)
  e.respondWith(
    caches.match(requete).then((r) => r || fetch(requete).then((reponse) => {
      const copie = reponse.clone();
      caches.open(CACHE).then((c) => c.put(requete, copie));
      return reponse;
    }))
  );
});
