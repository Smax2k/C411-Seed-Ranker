# C411 Seed Ranker

Application Vite + React qui classe des resultats issus d'une API Torznab compatible, puis expose un flux RSS filtrable pour qBittorrent.

Usage prevu : contenus legaux, libres ou explicitement autorises.

## Ce Que Fait L'App

- classe les torrents par potentiel de seed
- expose un flux RSS compatible qBittorrent
- filtre par seeders max, leechers min, taille min/max, age max et score min
- rafraichit automatiquement la liste toutes les 5 minutes
- permet le telechargement manuel depuis l'interface
- marque localement les torrents deja traites
- peut tourner en local ou sur Cloudflare Workers

## Deux Modes D'Utilisation

### Mode Local

Le mode local est le plus simple. Il lance :

- Vite pour l'interface React
- un serveur Node local pour `/api/ranked`, `/rss` et `/download`

Dans ce mode, l'app est accessible uniquement sur ta machine :

```text
http://127.0.0.1:5173
```

Le flux RSS local est :

```text
http://127.0.0.1:4174/rss
```

Ce mode ne demande pas de mot de passe, car il est expose uniquement en local.

### Mode Cloudflare

Le mode Cloudflare publie l'interface et les endpoints sur un Worker.

Dans ce mode :

- l'interface est protegee par mot de passe cote Worker
- l'API `/api/*` demande une session valide
- le RSS qBittorrent utilise un token dans l'URL
- les URLs `/download` acceptent soit la session, soit le token RSS
- la cle API C411 reste dans les secrets Cloudflare

Exemple d'URL publique :

```text
https://ton-worker.workers.dev
```

Exemple de RSS Cloudflare :

```text
https://ton-worker.workers.dev/rss?token=TON_RSS_TOKEN
```

## Installation Locale

```bash
npm install
cp .env.example .env
```

Puis edite `.env` :

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

Lance l'app :

```bash
npm run dev
```

Interface :

```text
http://127.0.0.1:5173
```

RSS local :

```text
http://127.0.0.1:4174/rss
```

## Deploiement Cloudflare

Le fichier `wrangler.toml` n'est pas versionne volontairement. Cree-le localement a partir de ce modele :

```toml
name = "c411-seed-ranker"
main = "./src/worker.js"
compatibility_date = "2025-09-01"
account_id = "TON_ACCOUNT_ID"

workers_dev = true
preview_urls = false

[observability]
enabled = false

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true

[vars]
C411_API_URL = "https://c411.org/api"
MAX_SEEDERS = "30"
MIN_LEECHERS = "2"
MIN_SIZE_GB = "1"
MAX_SIZE_GB = "500"
MAX_AGE_HOURS = "6"
MIN_SCORE = "0"
MAX_RESULTS = "40"
SCAN_RESULTS = "800"
```

`run_worker_first = true` est important : il force Cloudflare a faire passer les requetes par le Worker avant de servir les fichiers statiques. Sans ca, l'ecran de login peut etre contourne par les assets.

Configure les secrets Cloudflare :

```bash
npx wrangler secret put C411_API_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RSS_TOKEN
```

Suggestions :

```bash
openssl rand -hex 24  # ADMIN_PASSWORD
openssl rand -hex 32  # SESSION_SECRET
openssl rand -hex 32  # RSS_TOKEN
```

Puis deploie :

```bash
npm run build
npx wrangler deploy
```

## qBittorrent

Ajoute dans qBittorrent le flux RSS affiche par l'application.

Pour l'auto-telechargement :

1. Active le telechargement automatique RSS dans qBittorrent.
2. Cree une regle RSS large.
3. Applique cette regle au flux de l'app.
4. Laisse l'app filtrer avec `minScore`, `maxAgeHours`, `minSizeGb`, etc.

En local, le RSS n'a pas de token :

```text
http://127.0.0.1:4174/rss?...filtres...
```

Sur Cloudflare, le RSS a un token :

```text
https://ton-worker.workers.dev/rss?token=TON_RSS_TOKEN&...filtres...
```

qBittorrent ne sait pas utiliser le cookie de session de l'interface, donc le token RSS est necessaire pour ce mode.

## Scoring

Le score favorise :

- peu de seeders
- des leechers presents
- un ratio leechers/seeders eleve
- une taille suffisante
- les torrents recents

Filtres utiles :

- `MAX_SEEDERS` : evite les torrents deja trop satures
- `MIN_LEECHERS` : garde une demande minimale
- `MIN_SIZE_GB` : evite les fichiers trop petits pour faire du volume
- `MAX_SIZE_GB` : evite les torrents trop lourds
- `MAX_AGE_HOURS` : garde les torrents recents
- `MIN_SCORE` : limite le RSS aux meilleurs scores
- `SCAN_RESULTS` : nombre de resultats API a parcourir avant classement

## Securite

- `.env` contient les secrets locaux et n'est pas versionne.
- `.env.example` contient uniquement des valeurs d'exemple.
- `wrangler.toml` est ignore volontairement.
- Sur Cloudflare, l'interface est protegee par mot de passe cote Worker.
- Le cookie de session est `HttpOnly`, `Secure` et `SameSite=Lax`.
- Le RSS et les URLs de telechargement qBittorrent sont proteges par `RSS_TOKEN`.
- La cle API C411 doit etre stockee en secret Cloudflare, jamais dans le code.

## Limitations

- L'app ne connait pas ton ratio global de compte.
- Le ratio affiche est calcule a partir de `leechers / seeders`.
- Les donnees dependent de ce que l'API Torznab expose.
- L'API distante peut repondre `429 Too Many Requests`; l'app utilise un cache court pour reduire ce risque.
