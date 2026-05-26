import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fetchTorznabPages } from "./torznab.js";
import { rankTorrents, toNumber } from "./scoring.js";
import { buildRss } from "./rss.js";
import { loadDotEnv } from "./env.js";

await loadDotEnv();

const root = resolve(".");
const distDir = join(root, "dist");
const port = Number(process.env.SERVER_PORT || 4174);
const downloadCache = new Map();
const rankedCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function filtersFrom(url) {
  return {
    query: url.searchParams.get("q") || "",
    categories: url.searchParams.get("cat") || "",
    maxSeeders: toNumber(url.searchParams.get("maxSeeders"), toNumber(env("MAX_SEEDERS"), 30)),
    minLeechers: toNumber(url.searchParams.get("minLeechers"), toNumber(env("MIN_LEECHERS"), 2)),
    minSizeGb: toNumber(url.searchParams.get("minSizeGb"), toNumber(env("MIN_SIZE_GB"), 1)),
    maxSizeGb: toNumber(url.searchParams.get("maxSizeGb"), toNumber(env("MAX_SIZE_GB"), 500)),
    maxAgeHours: toNumber(url.searchParams.get("maxAgeHours"), toNumber(env("MAX_AGE_HOURS"), 6)),
    minScore: toNumber(url.searchParams.get("minScore"), toNumber(env("MIN_SCORE"), 0)),
    maxResults: toNumber(url.searchParams.get("maxResults"), toNumber(env("MAX_RESULTS"), 40))
  };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function publicTorrent(torrent) {
  const id = createHash("sha256").update(torrent.link || torrent.guid || torrent.title).digest("base64url").slice(0, 20);
  downloadCache.set(id, torrent);

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

async function ranked(url, options = {}) {
  const apiKey = env("C411_API_KEY");
  const baseUrl = env("C411_API_URL", "https://c411.org/api");
  if (!apiKey || apiKey === "remplace_moi") {
    throw new Error("C411_API_KEY manquante dans .env");
  }

  const filters = filtersFrom(url);
  const cacheKey = JSON.stringify(filters);
  const cached = rankedCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return options.publicView
      ? { ...cached.data, torrents: cached.data.torrents.map(publicTorrent) }
      : cached.data;
  }

  const targetScan = Math.max(
    filters.maxResults * 10,
    toNumber(env("SCAN_RESULTS"), 500)
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

  rankedCache.set(cacheKey, {
    createdAt: Date.now(),
    data
  });

  return options.publicView
    ? { ...data, torrents: data.torrents.map(publicTorrent) }
    : data;
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = join(distDir, pathname);
  const fallbackPath = join(distDir, "index.html");
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml"
  };

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    const data = await readFile(fallbackPath);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        hasApiKey: Boolean(env("C411_API_KEY")),
        rssUrl: `http://${req.headers.host}/rss`
      });
    }

    if (url.pathname === "/api/ranked") {
      return json(res, 200, await ranked(url, { publicView: true }));
    }

    if (url.pathname === "/rss") {
      const data = await ranked(url);
      res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      return res.end(buildRss(data.torrents, url.toString()));
    }

    if (url.pathname === "/download") {
      const torrent = downloadCache.get(url.searchParams.get("id"));
      if (!torrent?.link) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return res.end("Torrent introuvable. Rafraichis la liste puis reessaie.");
      }

      res.writeHead(302, { location: torrent.link });
      return res.end();
    }

    return serveStatic(req, res);
  } catch (error) {
    const isRateLimit = error.message.includes("429");
    return json(res, isRateLimit ? 429 : 500, {
      error: isRateLimit
        ? "API distante limite les requetes. Attends un peu ou reduis les changements de filtres."
        : error.message
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`C411 Seed Ranker server: http://127.0.0.1:${port}`);
});
