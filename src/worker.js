import { fetchTorznabPages } from "../server/torznab.js";
import { rankTorrents, toNumber } from "../server/scoring.js";

const rankedCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_D1_CACHE_TTL_SECONDS = 15 * 60;
const SESSION_COOKIE = "c411_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();

function envValue(env, name, fallback = "") {
  return env[name] || fallback;
}

function filtersFrom(url, env) {
  return {
    query: url.searchParams.get("q") || "",
    categories: url.searchParams.get("cat") || "",
    maxSeeders: toNumber(url.searchParams.get("maxSeeders"), toNumber(envValue(env, "MAX_SEEDERS"), 30)),
    minLeechers: toNumber(url.searchParams.get("minLeechers"), toNumber(envValue(env, "MIN_LEECHERS"), 2)),
    minSizeGb: toNumber(url.searchParams.get("minSizeGb"), toNumber(envValue(env, "MIN_SIZE_GB"), 1)),
    maxSizeGb: toNumber(url.searchParams.get("maxSizeGb"), toNumber(envValue(env, "MAX_SIZE_GB"), 500)),
    maxAgeHours: toNumber(url.searchParams.get("maxAgeHours"), toNumber(envValue(env, "MAX_AGE_HOURS"), 6)),
    minScore: toNumber(url.searchParams.get("minScore"), toNumber(envValue(env, "MIN_SCORE"), 0)),
    maxResults: toNumber(url.searchParams.get("maxResults"), toNumber(envValue(env, "MAX_RESULTS"), 40))
  };
}

function torrentId(torrent) {
  return torrent.infohash || torrent.guid || btoa(unescape(encodeURIComponent(torrent.title))).slice(0, 48);
}

function buildC411DownloadLink(baseUrl, apiKey, id) {
  const url = new URL(baseUrl);
  url.searchParams.set("t", "get");
  url.searchParams.set("id", id);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

function scopeKey(filters, userId = "") {
  return JSON.stringify({
    userId,
    query: filters.query || "",
    categories: filters.categories || ""
  });
}

function d1CacheTtlMs(env) {
  return toNumber(
    envValue(env, "D1_CACHE_TTL_SECONDS"),
    DEFAULT_D1_CACHE_TTL_SECONDS
  ) * 1000;
}

function hasD1(env) {
  return Boolean(env.DB && typeof env.DB.prepare === "function");
}

function fromCacheRow(row) {
  return {
    title: row.title,
    guid: row.guid,
    pubDate: row.pub_date,
    category: row.category,
    seeders: row.seeders,
    leechers: row.leechers,
    grabs: row.grabs,
    infohash: row.infohash,
    uploadVolumeFactor: row.upload_volume_factor,
    downloadVolumeFactor: row.download_volume_factor,
    sizeBytes: row.size_bytes
  };
}

async function readScanState(env, key) {
  if (!hasD1(env)) return null;
  return env.DB.prepare(
    "SELECT scope_key, scanned_at, scanned_count, target_scan FROM torrent_scan_states WHERE scope_key = ?"
  ).bind(key).first();
}

async function readCachedTorrents(env, key) {
  if (!hasD1(env)) return [];
  const rows = await env.DB.prepare(
    "SELECT title, guid, pub_date, category, seeders, leechers, grabs, infohash, upload_volume_factor, download_volume_factor, size_bytes FROM torrent_cache WHERE scope_key = ? ORDER BY last_seen_at DESC"
  ).bind(key).all();
  return (rows.results || []).map(fromCacheRow);
}

function publicCachedTorrent(torrent) {
  return {
    title: torrent.title,
    guid: torrent.guid,
    pubDate: torrent.pubDate,
    category: torrent.category,
    seeders: torrent.seeders,
    leechers: torrent.leechers,
    grabs: torrent.grabs,
    infohash: torrent.infohash,
    uploadVolumeFactor: torrent.uploadVolumeFactor,
    downloadVolumeFactor: torrent.downloadVolumeFactor,
    sizeBytes: torrent.sizeBytes
  };
}

async function writeCachedTorrents(env, key, filters, torrents, targetScan) {
  if (!hasD1(env)) return;

  const now = Date.now();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO torrent_scan_states (scope_key, query, categories, scanned_at, scanned_count, target_scan) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(key, filters.query || "", filters.categories || "", now, torrents.length, targetScan).run();

  const statements = [];
  for (const torrent of torrents) {
    statements.push(env.DB.prepare(`
      INSERT OR REPLACE INTO torrent_cache (
        scope_key, torrent_key, user_id, title, link, guid, pub_date, category, seeders, leechers, grabs,
        infohash, upload_volume_factor, download_volume_factor, size_bytes, raw_json, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      key,
      torrentId(torrent),
      filters.userId || "",
      torrent.title || "",
      "",
      torrent.guid || "",
      torrent.pubDate || "",
      torrent.category || "",
      Math.max(toNumber(torrent.seeders), 0),
      Math.max(toNumber(torrent.leechers), 0),
      Math.max(toNumber(torrent.grabs), 0),
      torrent.infohash || "",
      toNumber(torrent.uploadVolumeFactor, 1),
      toNumber(torrent.downloadVolumeFactor, 1),
      Math.max(toNumber(torrent.sizeBytes), 0),
      JSON.stringify(publicCachedTorrent(torrent)),
      now
    ));

    if (statements.length >= 50) {
      await env.DB.batch(statements.splice(0));
    }
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  await env.DB.prepare(
    "DELETE FROM torrent_cache WHERE scope_key = ? AND last_seen_at < ?"
  ).bind(key, now).run();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function encryptionSecret(env) {
  return envValue(env, "ENCRYPTION_SECRET") || envValue(env, "SESSION_SECRET");
}

async function encryptionKey(env) {
  const secret = encryptionSecret(env);
  if (!secret) throw new Error("ENCRYPTION_SECRET ou SESSION_SECRET manquant pour chiffrer les clés API utilisateur");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptText(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(value)
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv)
  };
}

async function decryptText(ciphertext, iv, env) {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(env),
    base64UrlToBytes(ciphertext)
  );
  return new TextDecoder().decode(bytes);
}

async function createRssUser(env, { label, apiKey }) {
  if (!hasD1(env)) throw new Error("D1 DB manquante");
  if (!apiKey || String(apiKey).trim().length < 16) throw new Error("Clé API C411 invalide");

  const token = randomToken();
  const tokenHash = await sha256(token);
  const encrypted = await encryptText(String(apiKey).trim(), env);
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO rss_users (id, label, token_hash, api_key_ciphertext, api_key_iv, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, String(label || "").trim(), tokenHash, encrypted.ciphertext, encrypted.iv, now).run();

  return { id, token };
}

async function apiKeyFromRssToken(token, env) {
  if (!token || !hasD1(env)) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT id, api_key_ciphertext, api_key_iv FROM rss_users WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!row) return null;

  await env.DB.prepare(
    "UPDATE rss_users SET last_used_at = ? WHERE id = ?"
  ).bind(Date.now(), row.id).run();

  return {
    apiKey: await decryptText(row.api_key_ciphertext, row.api_key_iv, env),
    source: "user",
    userId: row.id
  };
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

async function isRateLimited(key, env, limit = LOGIN_RATE_LIMIT_MAX_ATTEMPTS, windowMs = LOGIN_RATE_LIMIT_WINDOW_MS) {
  if (env.RATE_LIMIT && typeof env.RATE_LIMIT.get === "function") {
    const now = Date.now();
    const existing = await env.RATE_LIMIT.get(key, { type: "json" });
    if (!existing || now > existing.resetAt) {
      await env.RATE_LIMIT.put(
        key,
        JSON.stringify({ count: 1, resetAt: now + windowMs }),
        { expirationTtl: Math.ceil(windowMs / 1000) }
      );
      return false;
    }

    const count = toNumber(existing.count) + 1;
    await env.RATE_LIMIT.put(
      key,
      JSON.stringify({ count, resetAt: existing.resetAt }),
      { expirationTtl: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
    );
    return count > limit;
  }

  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now > current.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  current.count += 1;
  return current.count > limit;
}

function rateLimitResponse() {
  return new Response("Trop de tentatives. Réessaie dans quelques minutes.", {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(Math.ceil(LOGIN_RATE_LIMIT_WINDOW_MS / 1000))
    }
  });
}

async function createSession(env, token) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${expires}:${token}`;
  return `${payload}.${await hmac(payload, envValue(env, "SESSION_SECRET"))}`;
}

async function isSessionValid(request, env) {
  const secret = envValue(env, "SESSION_SECRET");
  if (!secret) return false;

  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const cookieValue = decodeURIComponent(match[1]);
  const separator = cookieValue.lastIndexOf(".");
  if (separator < 0) return null;

  const payload = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  const [expires, token] = payload.split(":");
  if (!expires || !token || !signature || Number(expires) < Math.floor(Date.now() / 1000)) return null;

  const expected = await hmac(payload, secret);
  if (expected.length !== signature.length) return null;

  const left = base64UrlToBytes(expected);
  const right = base64UrlToBytes(signature);
  const valid = left.length === right.length && left.every((byte, index) => byte === right[index]);
  return valid ? { token, expires: Number(expires) } : null;
}

function loginPage(error = "") {
  return new Response(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>C411 Seed Ranker - Login</title>
    <style>
      :root { color: #edf3ff; background: #07110f; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: linear-gradient(180deg, rgba(9, 32, 37, .96), rgba(8, 16, 22, .98)), radial-gradient(circle at 20% 10%, rgba(31, 120, 137, .28), transparent 34%); }
      main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(420px, .8fr); gap: 22px; width: min(1100px, 100%); }
      section, aside { border: 1px solid rgba(154, 192, 205, .22); border-radius: 8px; background: rgba(14, 27, 39, .92); }
      section { display: grid; align-content: center; gap: 22px; padding: 30px; }
      aside { padding: 24px; }
      .eyebrow { margin: 0 0 8px; color: #80c8d5; font-size: 13px; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(34px, 5vw, 56px); line-height: 1; }
      .lead { max-width: 640px; margin: 0; color: #b7c8d5; font-size: 17px; line-height: 1.55; }
      .features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      article { border: 1px solid rgba(154, 192, 205, .16); border-radius: 8px; padding: 14px; background: rgba(255,255,255,.03); }
      article strong { display: block; margin-bottom: 7px; color: #f7fbff; }
      article p { margin: 0; color: #a9bac8; font-size: 13px; line-height: 1.42; }
      .links { display: flex; flex-wrap: wrap; gap: 10px; }
      .github { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(157, 192, 209, .24); border-radius: 8px; padding: 11px 14px; color: #d6e3ee; background: #0a1720; font-size: 14px; text-decoration: none; }
      .github svg { width: 17px; height: 17px; }
      aside h2 { margin: 0 0 18px; font-size: 24px; }
      label { display: grid; gap: 8px; color: #a9bac8; font-size: 14px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid rgba(157, 192, 209, .22); border-radius: 6px; padding: 12px; color: #fff; background: #0a1720; font: inherit; }
      button { width: 100%; margin-top: 16px; border: 0; border-radius: 8px; padding: 12px 18px; color: #062018; background: #4de1b0; font: inherit; cursor: pointer; }
      .apiHelp { margin: 0 0 18px; border: 1px solid rgba(77, 225, 176, .26); border-radius: 8px; padding: 14px; background: rgba(77, 225, 176, .08); }
      .apiHelp strong { display: block; margin-bottom: 6px; color: #f7fbff; font-size: 15px; }
      .apiHelp p { margin: 0 0 12px; color: #b7c8d5; font-size: 13px; line-height: 1.45; }
      .apiHelp a { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; border-radius: 8px; padding: 11px 14px; color: #062018; background: #4de1b0; font-size: 14px; font-weight: 700; text-decoration: none; }
      .apiHelp a svg { width: 17px; height: 17px; }
      .error { min-height: 20px; margin: 12px 0 0; color: #ffb4a8; font-size: 13px; }
      .hint { margin: 18px 0 0; color: #8fb7c4; font-size: 13px; line-height: 1.45; }
      @media (max-width: 820px) {
        main { grid-template-columns: 1fr; }
        .features { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <div>
          <p class="eyebrow">RSS intelligent pour qBittorrent</p>
          <h1>C411 Seed Ranker</h1>
        </div>
        <p class="lead">Connecte ta clé API C411, repère les torrents avec le meilleur potentiel d'upload, puis copie un flux RSS prêt à brancher dans qBittorrent.</p>
        <div class="features">
          <article>
            <strong>Score utile</strong>
            <p>Priorise les torrents récents, peu seedés et avec une vraie demande visible.</p>
          </article>
          <article>
            <strong>RSS pret a copier</strong>
            <p>Tu ajustes les filtres et tu recuperes une URL propre a ajouter dans qBittorrent.</p>
          </article>
          <article>
            <strong>Clé personnelle</strong>
            <p>Ta clé API sert de connexion et génère uniquement tes propres liens de téléchargement.</p>
          </article>
        </div>
        <div class="links">
          <a class="github" href="https://github.com/Smax2k/C411-Seed-Ranker" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"></path><path d="M12 12v3"></path></svg>
            GitHub
          </a>
        </div>
      </section>
      <aside>
        <h2>Connexion</h2>
        <div class="apiHelp">
          <strong>Besoin d'une clé API ?</strong>
          <p>Connecte-toi sur C411, clique sur "Créer une clé", copie-la, puis colle-la ici.</p>
          <a href="https://c411.org/user/integrations" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
            Ouvrir la page des clés API
          </a>
        </div>
        <form method="post" action="/login">
          <label>Clé API C411
            <input name="apiKey" type="password" autocomplete="current-password" autofocus>
          </label>
          <button type="submit">Entrer</button>
        </form>
        <p class="error">${escapeXml(error)}</p>
        <p class="hint">La clé API crée ton token RSS de session. Pour utiliser une autre clé, déconnecte-toi puis reconnecte-toi avec la nouvelle.</p>
      </aside>
    </main>
  </body>
</html>`, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function publicTorrent(torrent) {
  const id = torrentId(torrent);

  return {
    id,
    title: torrent.title,
    guid: torrent.guid,
    pubDate: torrent.pubDate,
    category: torrent.category,
    seeders: torrent.seeders,
    leechers: torrent.leechers,
    sizeBytes: torrent.sizeBytes,
    score: torrent.score
  };
}

async function ranked(url, env, options = {}) {
  const apiKey = options.apiKey;
  const userId = options.userId || "";
  const baseUrl = envValue(env, "C411_API_URL", "https://c411.org/api");
  if (!apiKey || apiKey === "remplace_moi") {
    throw new Error("Clé API C411 manquante pour cette session");
  }

  const filters = filtersFrom(url, env);
  const cacheKey = JSON.stringify({ userId, filters });
  const cached = rankedCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return options.publicView
      ? { ...cached.data, torrents: cached.data.torrents.map(publicTorrent) }
      : cached.data;
  }

  const targetScan = Math.max(
    filters.maxResults * 10,
    toNumber(envValue(env, "SCAN_RESULTS"), 800)
  );
  const effectiveTargetScan = Math.min(targetScan, 2000);
  const key = scopeKey(filters, userId);
  const state = await readScanState(env, key);
  const cacheIsFresh = state && Date.now() - state.scanned_at <= d1CacheTtlMs(env);
  let torrents = [];
  let source = "api";
  let stale = false;
  let warning = "";

  if (cacheIsFresh) {
    torrents = await readCachedTorrents(env, key);
    source = "d1";
  } else {
    try {
      torrents = await fetchTorznabPages({
        baseUrl,
        apiKey,
        query: filters.query,
        categories: filters.categories,
        target: effectiveTargetScan,
        pageSize: 100
      });
      await writeCachedTorrents(env, key, { ...filters, userId }, torrents, effectiveTargetScan);
    } catch (error) {
      const cachedTorrents = await readCachedTorrents(env, key);
      if (!cachedTorrents.length) throw error;
      torrents = cachedTorrents;
      source = "d1";
      stale = true;
      warning = error.message.includes("429")
        ? "API distante limitée. Résultats servis depuis le cache."
        : `API distante indisponible. Résultats servis depuis le cache : ${error.message}`;
    }
  }

  const rankedTorrents = rankTorrents(torrents, filters);

  const data = {
    filters,
    stats: {
      scanned: torrents.length,
      eligible: rankedTorrents.length,
      targetScan: effectiveTargetScan,
      source,
      stale,
      warning,
      cacheAgeSeconds: state?.scanned_at ? Math.round((Date.now() - state.scanned_at) / 1000) : null
    },
    torrents: rankedTorrents
  };

  rankedCache.set(cacheKey, { createdAt: Date.now(), data });

  return options.publicView
    ? { ...data, torrents: data.torrents.map(publicTorrent) }
    : data;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function buildRss(torrents, requestUrl) {
  const url = new URL(requestUrl);
  const origin = url.origin;
  const token = url.searchParams.get("token") || "";
  const items = torrents.map((torrent) => {
    const id = torrentId(torrent);
    const downloadUrl = `${origin}/download?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;

    return `
    <item>
      <title>${escapeXml(`[${torrent.score.toFixed(1)}] ${torrent.title}`)}</title>
      <link>${escapeXml(downloadUrl)}</link>
      <guid isPermaLink="false">${escapeXml(torrent.guid || id)}</guid>
      <pubDate>${escapeXml(torrent.pubDate || new Date().toUTCString())}</pubDate>
      <description>${escapeXml(`${torrent.seeders} seeders / ${torrent.leechers} leechers`)}</description>
      <enclosure url="${escapeXml(downloadUrl)}" length="${Math.round(torrent.sizeBytes || 0)}" type="application/x-bittorrent" />
    </item>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>C411 Seed Ranker</title>
    <link>${escapeXml(requestUrl)}</link>
    <description>Torrents légaux/autorisés classés par potentiel d'upload.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

async function findDownloadLinkForApiKey(id, env, apiKey, userId = "") {
  if (!id || !apiKey) return "";

  const baseUrl = envValue(env, "C411_API_URL", "https://c411.org/api");
  if (hasD1(env)) {
    const row = await env.DB.prepare(
      "SELECT torrent_key FROM torrent_cache WHERE torrent_key = ? AND user_id = ? LIMIT 1"
    ).bind(id, userId).first();
    if (row?.torrent_key) return buildC411DownloadLink(baseUrl, apiKey, id);
    return "";
  }

  const torrents = await fetchTorznabPages({
    baseUrl,
    apiKey,
    target: 2000,
    pageSize: 100
  });

  for (const torrent of torrents) {
    const currentId = torrentId(torrent);
    if (currentId === id) return buildC411DownloadLink(baseUrl, apiKey, currentId);
  }

  return "";
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/login" && request.method === "POST") {
      if (await isRateLimited(`login:${clientIp(request)}`, env)) return rateLimitResponse();
      const form = await request.formData();
      const apiKey = String(form.get("apiKey") || "").trim();
      if (apiKey.length < 16) return loginPage("Clé API C411 invalide.");

      const user = await createRssUser(env, { label: "Connexion web", apiKey });
      const session = await createSession(env, user.token);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(session)}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    if (url.pathname === "/logout") {
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
        }
      });
    }

    const sessionValid = await isSessionValid(request, env);
    const sessionAuth = sessionValid ? await apiKeyFromRssToken(sessionValid.token, env) : null;
    const rssAuth = await apiKeyFromRssToken(url.searchParams.get("token"), env);
    const rssTokenValid = Boolean(rssAuth);

    if (url.pathname === "/api/health") {
      if (!sessionValid) return json({ error: "Authentification requise" }, 401);
      return json({
        ok: true,
        hasApiKey: Boolean(sessionAuth?.apiKey),
        rssUrl: `${url.origin}/rss?token=${encodeURIComponent(sessionValid.token)}`
      });
    }

    if (url.pathname === "/api/users" && request.method === "POST") {
      if (!sessionValid) return json({ error: "Authentification requise" }, 401);
      if (await isRateLimited(`api-users:${clientIp(request)}:${sessionAuth?.userId || "unknown"}`, env, 12)) {
        return json({ error: "Trop de créations de tokens. Réessaie dans quelques minutes." }, 429);
      }
      const contentType = request.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await request.json()
        : Object.fromEntries(await request.formData());
      const user = await createRssUser(env, payload);
      return json({
        id: user.id,
        token: user.token,
        rssUrl: `${url.origin}/rss?token=${encodeURIComponent(user.token)}`
      }, 201);
    }

    if (url.pathname === "/api/ranked") {
      if (!sessionValid) return json({ error: "Authentification requise" }, 401);
      if (!sessionAuth?.apiKey) return json({ error: "Clé API C411 introuvable pour cette session" }, 401);
      return json(await ranked(url, env, { publicView: true, apiKey: sessionAuth.apiKey, userId: sessionAuth.userId }));
    }

    if (url.pathname === "/rss") {
      if (!rssAuth) return new Response("RSS token invalide", { status: 401 });
      const data = await ranked(url, env, { apiKey: rssAuth.apiKey, userId: rssAuth.userId });
      return new Response(buildRss(data.torrents, url.toString()), {
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      });
    }

    if (url.pathname === "/download") {
      if (!sessionValid && !rssTokenValid) return new Response("Authentification requise", { status: 401 });
      const link = rssAuth
        ? await findDownloadLinkForApiKey(url.searchParams.get("id"), env, rssAuth.apiKey, rssAuth.userId)
        : await findDownloadLinkForApiKey(url.searchParams.get("id"), env, sessionAuth?.apiKey, sessionAuth?.userId);
      if (!link) {
        return new Response("Torrent introuvable. Rafraichis la liste puis reessaie.", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      return new Response(null, {
        status: 302,
        headers: {
          location: link,
          "referrer-policy": "no-referrer"
        }
      });
    }

    if (!sessionValid) return loginPage();

    return env.ASSETS.fetch(request);
  } catch (error) {
    const isRateLimit = error.message.includes("429");
    return json({
      error: isRateLimit
        ? "API distante limite les requetes. Attends un peu ou reduis les changements de filtres."
        : error.message
    }, isRateLimit ? 429 : 500);
  }
}

export default {
  fetch: handleRequest
};
