# C411 Seed Ranker

Application locale Vite + React qui classe des torrents issus d'une API Torznab compatible, puis expose un flux RSS local pour qBittorrent.

Usage prevu : contenus legaux, libres ou explicitement autorises.

## Fonctionnalites

- classement par potentiel de seed
- flux RSS local compatible qBittorrent
- filtres : seeders max, leechers min, taille min/max, age max, score min
- auto-refresh toutes les 5 minutes
- bouton de telechargement manuel
- marquage local des torrents deja traites

## Configuration

Copie `.env.example` vers `.env`, puis remplace la cle API :

```bash
cp .env.example .env
```

```env
C411_API_URL=https://c411.org/api
C411_API_KEY=ta_cle_api
SERVER_PORT=4174
MAX_SEEDERS=30
MIN_LEECHERS=2
MIN_SIZE_GB=1
MAX_SIZE_GB=500
MAX_AGE_HOURS=6
MIN_SCORE=0
MAX_RESULTS=40
SCAN_RESULTS=800
```

La cle API reste cote serveur local. Elle n'est pas envoyee au navigateur.

Ne commit jamais `.env`. Le fichier est ignore par `.gitignore`.

## Lancer l'application

```bash
npm install
npm run dev
```

Interface :

```text
http://127.0.0.1:5173
```

RSS a ajouter dans qBittorrent :

```text
http://127.0.0.1:4174/rss
```

Tu peux aussi copier l'URL complete affichee dans l'interface, qui inclut les filtres courants.

## qBittorrent

Dans qBittorrent, ajoute le flux RSS affiche par l'application. Pour l'auto-telechargement, cree une regle RSS large et laisse l'application filtrer le flux avec ses criteres.

Sur Cloudflare, le flux RSS contient un `token` secret dans l'URL. Ce token est necessaire parce que qBittorrent ne sait pas utiliser le cookie de session de l'interface.

## Scoring

Le score favorise :

- peu de seeders
- des leechers presents
- un ratio leechers/seeders eleve
- une taille raisonnable
- les torrents recents

Les filtres par defaut sont modifiables dans `.env` ou dans l'interface. `MIN_SIZE_GB=1` masque par defaut les torrents de moins de 1 Go, `MAX_SIZE_GB=500` laisse passer les gros packs, `MAX_AGE_HOURS=6` garde la liste tres recente, et `MIN_SCORE` permet de limiter le RSS aux meilleurs scores.

`SCAN_RESULTS` controle combien de resultats l'app tente de parcourir avant de calculer le top final. Si un torrent apparait en recherche ciblee mais pas dans le classement general, augmente cette valeur.

## Securite

- `.env` contient les secrets locaux et n'est pas versionne.
- `.env.example` contient uniquement des valeurs d'exemple.
- Sur Cloudflare, l'interface est protegee par un mot de passe cote Worker.
- Le cookie de session est `HttpOnly`, `Secure` et `SameSite=Lax`.
- Le RSS et les URLs de telechargement qBittorrent sont proteges par un token separe.
- Configure les secrets avec Wrangler : `C411_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET` et `RSS_TOKEN`.
