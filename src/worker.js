import { fetchTorznabPages } from "../server/torznab.js";
import { rankTorrents, toNumber } from "../server/scoring.js";

const rankedCache = new Map();
const downloadCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const SESSION_COOKIE = "c411_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

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

async function createSession(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${expires}`;
  return `${payload}.${await hmac(payload, envValue(env, "SESSION_SECRET"))}`;
}

async function isSessionValid(request, env) {
  const secret = envValue(env, "SESSION_SECRET");
  if (!secret) return false;

  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;

  const [expires, signature] = decodeURIComponent(match[1]).split(".");
  if (!expires || !signature || Number(expires) < Math.floor(Date.now() / 1000)) return false;

  const expected = await hmac(expires, secret);
  if (expected.length !== signature.length) return false;

  const left = base64UrlToBytes(expected);
  const right = base64UrlToBytes(signature);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function isRssTokenValid(url, env) {
  const token = envValue(env, "RSS_TOKEN");
  return Boolean(token) && url.searchParams.get("token") === token;
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
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: linear-gradient(180deg, #092025, #081016); }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(154, 192, 205, .22); border-radius: 8px; padding: 24px; background: rgba(14, 27, 39, .92); }
      h1 { margin: 0 0 18px; font-size: 28px; }
      label { display: grid; gap: 8px; color: #a9bac8; font-size: 14px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid rgba(157, 192, 209, .22); border-radius: 6px; padding: 12px; color: #fff; background: #0a1720; font: inherit; }
      button { width: 100%; margin-top: 16px; border: 0; border-radius: 8px; padding: 12px 18px; color: #062018; background: #4de1b0; font: inherit; cursor: pointer; }
      p { min-height: 20px; margin: 12px 0 0; color: #ffb4a8; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h1>C411 Seed Ranker</h1>
      <form method="post" action="/login">
        <label>Mot de passe
          <input name="password" type="password" autocomplete="current-password" autofocus>
        </label>
        <button type="submit">Entrer</button>
      </form>
      <p>${escapeXml(error)}</p>
    </main>
  </body>
</html>`, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function publicTorrent(torrent) {
  const id = torrentId(torrent);
  downloadCache.set(id, torrent.link);

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
  const apiKey = envValue(env, "C411_API_KEY");
  const baseUrl = envValue(env, "C411_API_URL", "https://c411.org/api");
  if (!apiKey || apiKey === "remplace_moi") {
    throw new Error("C411_API_KEY manquante dans les secrets Cloudflare");
  }

  const filters = filtersFrom(url, env);
  const cacheKey = JSON.stringify(filters);
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
  const torrents = await fetchTorznabPages({
    baseUrl,
    apiKey,
    query: filters.query,
    categories: filters.categories,
    target: Math.min(targetScan, 2000),
    pageSize: 100
  });
  const rankedTorrents = rankTorrents(torrents, filters);

  const data = {
    filters,
    stats: {
      scanned: torrents.length,
      eligible: rankedTorrents.length,
      targetScan: Math.min(targetScan, 2000)
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
    downloadCache.set(id, torrent.link);
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
    <description>Torrents legaux/autorises classes par potentiel d'upload.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

async function findDownloadLink(id, env) {
  const cached = downloadCache.get(id);
  if (cached) return cached;

  const torrents = await fetchTorznabPages({
    baseUrl: envValue(env, "C411_API_URL", "https://c411.org/api"),
    apiKey: envValue(env, "C411_API_KEY"),
    target: 2000,
    pageSize: 100
  });

  for (const torrent of torrents) {
    const currentId = torrentId(torrent);
    downloadCache.set(currentId, torrent.link);
    if (currentId === id) return torrent.link;
  }

  return "";
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      if (form.get("password") !== envValue(env, "ADMIN_PASSWORD")) {
        return loginPage("Mot de passe incorrect.");
      }

      const session = await createSession(env);
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
    const rssTokenValid = isRssTokenValid(url, env);

    if (url.pathname === "/api/health") {
      if (!sessionValid) return json({ error: "Authentification requise" }, 401);
      return json({
        ok: true,
        hasApiKey: Boolean(envValue(env, "C411_API_KEY")),
        rssUrl: `${url.origin}/rss?token=${encodeURIComponent(envValue(env, "RSS_TOKEN"))}`
      });
    }

    if (url.pathname === "/api/ranked") {
      if (!sessionValid) return json({ error: "Authentification requise" }, 401);
      return json(await ranked(url, env, { publicView: true }));
    }

    if (url.pathname === "/rss") {
      if (!rssTokenValid) return new Response("RSS token invalide", { status: 401 });
      const data = await ranked(url, env);
      return new Response(buildRss(data.torrents, url.toString()), {
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      });
    }

    if (url.pathname === "/download") {
      if (!sessionValid && !rssTokenValid) return new Response("Authentification requise", { status: 401 });
      const link = await findDownloadLink(url.searchParams.get("id"), env);
      if (!link) {
        return new Response("Torrent introuvable. Rafraichis la liste puis reessaie.", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      return Response.redirect(link, 302);
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
