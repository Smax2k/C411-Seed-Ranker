import { fetchTorznabPages } from "../server/torznab.js";
import { rankTorrents, toNumber } from "../server/scoring.js";

const rankedCache = new Map();
const downloadCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;

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
  const items = torrents.map((torrent) => {
    const id = torrentId(torrent);
    downloadCache.set(id, torrent.link);
    const downloadUrl = `${origin}/download?id=${encodeURIComponent(id)}`;

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
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        hasApiKey: Boolean(envValue(env, "C411_API_KEY")),
        rssUrl: `${url.origin}/rss`
      });
    }

    if (url.pathname === "/api/ranked") {
      return json(await ranked(url, env, { publicView: true }));
    }

    if (url.pathname === "/rss") {
      const data = await ranked(url, env);
      return new Response(buildRss(data.torrents, url.toString()), {
        headers: { "content-type": "application/rss+xml; charset=utf-8" }
      });
    }

    if (url.pathname === "/download") {
      const link = await findDownloadLink(url.searchParams.get("id"), env);
      if (!link) {
        return new Response("Torrent introuvable. Rafraichis la liste puis reessaie.", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      return Response.redirect(link, 302);
    }

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
