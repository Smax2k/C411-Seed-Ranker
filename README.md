# C411 Seed Ranker

C411 Seed Ranker est une application Cloudflare Workers qui aide à améliorer son ratio plus vite avec qBittorrent.

Le principe : tu te connectes avec ta clé API C411, l'application classe les torrents selon leur potentiel d'upload, puis elle génère un flux RSS que qBittorrent peut surveiller et télécharger automatiquement.

Usage prévu : contenus légaux, libres ou explicitement autorisés.

## Objectif

- repérer les torrents récents avec une demande visible
- éviter les torrents déjà trop saturés en seeders
- fournir un flux RSS filtrable pour qBittorrent
- automatiser l'ajout de torrents intéressants
- augmenter son ratio plus rapidement grâce à des choix de seed plus efficaces

## Fonctionnement

1. Tu ouvres l'application Cloudflare.
2. Tu te connectes avec ta clé API C411.
3. L'application crée un token RSS propre à ta session.
4. Tu ajustes les filtres : seeders max, leechers min, taille, âge, score.
5. Tu copies l'URL RSS dans qBittorrent.
6. qBittorrent peut télécharger automatiquement les torrents qui correspondent aux règles.

La clé API sert de connexion. Il n'y a plus de mot de passe admin côté utilisateur.

## Architecture

Le projet fonctionne maintenant uniquement sur Cloudflare :

- Cloudflare Workers pour l'interface et les endpoints
- Cloudflare D1 pour le cache des métadonnées et les tokens RSS utilisateurs
- Cloudflare Secrets pour les secrets serveur
- qBittorrent côté utilisateur pour consommer le flux RSS

Le mode local Node/Vite n'est plus le mode d'exécution cible, car l'application dépend de D1 et du Worker pour gérer les sessions, les tokens RSS et les clés API chiffrées.

## Données Stockées

D1 stocke :

- des métadonnées de torrents : titre, taille, date, seeders, leechers, catégorie, identifiant
- les tokens RSS sous forme de hash
- les clés API C411 chiffrées

D1 ne doit pas stocker :

- de clé API C411 en clair
- d'URL de téléchargement C411 contenant `apikey=`
- de token RSS en clair

Le lien de téléchargement C411 est reconstruit au moment où qBittorrent appelle `/download`, avec la clé API associée au token RSS.

## Configuration Cloudflare

Le Worker utilise `wrangler.toml` avec un binding D1 nommé `DB`.

Exemple de base :

```toml
name = "c411-seed-ranker"
main = "./src/worker.js"
compatibility_date = "2025-09-01"

workers_dev = true
preview_urls = false

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
MEMORY_CACHE_TTL_SECONDS = "60"
D1_CACHE_TTL_SECONDS = "60"
RSS_D1_CACHE_TTL_SECONDS = "60"

[[d1_databases]]
binding = "DB"
database_name = "c411-seed-ranker"
database_id = "TON_DATABASE_ID"
```

`run_worker_first = true` est important pour que les requêtes passent par le Worker avant les assets.

## Secrets Nécessaires

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ENCRYPTION_SECRET
```

Suggestions :

```bash
openssl rand -hex 32  # SESSION_SECRET
openssl rand -hex 32  # ENCRYPTION_SECRET
```

Secrets qui ne sont plus nécessaires pour le fonctionnement utilisateur :

- `ADMIN_PASSWORD`
- `C411_API_KEY`
- `RSS_TOKEN`

La clé API C411 est fournie par chaque utilisateur sur la page de connexion.

## D1

Créer la base :

```bash
npx wrangler d1 create c411-seed-ranker
```

Appliquer les migrations :

```bash
npx wrangler d1 execute DB --remote --file migrations/0001_cache_torrents.sql
npx wrangler d1 execute DB --remote --file migrations/0002_multi_user_secure_cache.sql
```

Vérifier que la base ne contient pas d'URL sensible :

```bash
npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) AS rows_total, SUM(CASE WHEN link LIKE '%apikey=%' THEN 1 ELSE 0 END) AS rows_with_apikey_in_link, SUM(CASE WHEN raw_json LIKE '%apikey=%' THEN 1 ELSE 0 END) AS rows_with_apikey_in_raw FROM torrent_cache;"
```

Les deux compteurs `rows_with_apikey_*` doivent rester à `0`.

## Déploiement

```bash
npm install
npm run build
npm run deploy
```

`npm run deploy` publie le Worker avec Wrangler.

## qBittorrent

Dans qBittorrent :

1. Va dans RSS.
2. Ajoute l'URL RSS copiée depuis l'application.
3. Active le téléchargement automatique RSS.
4. Crée une règle qui accepte le flux de C411 Seed Ranker.
5. Ajuste les filtres dans l'application pour contrôler ce que qBittorrent récupère.

Le flux RSS est fait pour l'automatisation : qBittorrent peut récupérer les torrents à ta place dès qu'ils correspondent aux critères.

## Scoring

Le score favorise :

- peu de seeders
- des leechers présents
- un ratio leechers/seeders élevé
- une taille suffisante pour générer du volume
- des torrents récents

Filtres utiles :

- `MAX_SEEDERS` : évite les torrents déjà trop saturés
- `MIN_LEECHERS` : garde une demande minimale
- `MIN_SIZE_GB` : évite les fichiers trop petits pour faire du volume
- `MAX_SIZE_GB` : évite les torrents trop lourds
- `MAX_AGE_HOURS` : garde les torrents récents
- `MIN_SCORE` : limite le RSS aux meilleurs scores
- `SCAN_RESULTS` : nombre de résultats API parcourus avant classement
- `MEMORY_CACHE_TTL_SECONDS` : micro-cache mémoire de l'interface, gardé court pour éviter les doublons immédiats sans masquer les données du cron
- `D1_CACHE_TTL_SECONDS` : fraîcheur D1 pour l'interface web ; `60` laisse le cron minute fournir les données fraîches
- `RSS_D1_CACHE_TTL_SECONDS` : fraîcheur D1 affichée pour qBittorrent ; le RSS lit D1 directement et ne retape pas l'API à chaque appel

## Sécurité

- La clé API C411 est fournie à la connexion.
- Le token RSS est stocké en hash.
- La clé API est stockée chiffrée.
- Les liens C411 avec `apikey=` ne sont pas stockés en D1.
- Le cookie de session est `HttpOnly`, `Secure` et `SameSite=Lax`.
- Seuls `SESSION_SECRET` et `ENCRYPTION_SECRET` doivent être configurés comme secrets serveur.

## Limitations

- L'application ne connaît pas ton ratio global C411.
- Le ratio affiché dans le tableau est le rapport `leechers / seeders`, pas ton ratio de compte.
- Les résultats dépendent des données exposées par l'API Torznab/C411.
