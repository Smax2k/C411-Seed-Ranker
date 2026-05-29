function textBetween(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function attrValue(fragment, name) {
  const match = fragment.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function extractTorznabAttr(itemXml, attrName) {
  const attrs = [...itemXml.matchAll(/<(?:torznab:)?attr\b[^>]*>/gi)];
  for (const attr of attrs) {
    const fragment = attr[0];
    if (attrValue(fragment, "name").toLowerCase() === attrName.toLowerCase()) {
      return attrValue(fragment, "value");
    }
  }
  return "";
}

const ADULT_CATEGORY_IDS = new Set(["6000", "6010", "6050", "6060", "6070", "6080"]);
const DEFAULT_SAFE_CATEGORY_IDS = [
  "1000",
  "1030",
  "1040",
  "1080",
  "1090",
  "2000",
  "2010",
  "2030",
  "2050",
  "2060",
  "2070",
  "2080",
  "2090",
  "3000",
  "3010",
  "3030",
  "3050",
  "4000",
  "4030",
  "4040",
  "4050",
  "4060",
  "4070",
  "5000",
  "5060",
  "5070",
  "5080",
  "7000",
  "7010",
  "7020",
  "7030",
  "8010"
];
const ADULT_TITLE_PATTERNS = [
  /\bxxx\b/i,
  /\bporn(?:hub|megaload|mega|load)?\b/i,
  /\bhentai(?:ed)?\b/i,
  /\bonlyfans\b/i,
  /\bxvideos/i,
  /\bsexart\b/i,
  /\bsinfulxxx\b/i,
  /\bhardx\b/i,
  /\bnubiles\b/i,
  /\bsiterip\b/i
];

export function safeCategories(categories = "") {
  const values = String(categories)
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean)
    .filter((category) => !ADULT_CATEGORY_IDS.has(category));

  return (values.length ? values : DEFAULT_SAFE_CATEGORY_IDS).join(",");
}

export function isAdultTorrent(torrent) {
  const category = String(torrent.category || "").trim();
  if (ADULT_CATEGORY_IDS.has(category)) return true;

  const title = String(torrent.title || "");
  return ADULT_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function parseTorznab(xml) {
  const itemMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return itemMatches.map((match) => {
    const itemXml = match[0];
    const enclosure = itemXml.match(/<enclosure\b[^>]*>/i)?.[0] ?? "";
    const size = textBetween(itemXml, "size") || attrValue(enclosure, "length");
    const seedersAttr = extractTorznabAttr(itemXml, "seeders");
    const leechersAttr = extractTorznabAttr(itemXml, "leechers");
    const peersAttr = extractTorznabAttr(itemXml, "peers");
    const seeders = Number(seedersAttr || 0);
    const peers = Number(peersAttr || 0);

    return {
      title: textBetween(itemXml, "title"),
      link: attrValue(enclosure, "url") || textBetween(itemXml, "link"),
      guid: textBetween(itemXml, "guid") || attrValue(enclosure, "url") || textBetween(itemXml, "link"),
      pubDate: textBetween(itemXml, "pubDate"),
      category: textBetween(itemXml, "category"),
      seeders,
      leechers: leechersAttr ? Number(leechersAttr) : Math.max(peers >= seeders ? peers - seeders : peers, 0),
      grabs: Number(extractTorznabAttr(itemXml, "grabs") || 0),
      infohash: extractTorznabAttr(itemXml, "infohash"),
      uploadVolumeFactor: Number(extractTorznabAttr(itemXml, "uploadvolumefactor") || 1),
      downloadVolumeFactor: Number(extractTorznabAttr(itemXml, "downloadvolumefactor") || 1),
      sizeBytes: Number(size || 0)
    };
  });
}

export async function fetchTorznab({ baseUrl, apiKey, query = "", categories = "", limit = 100, offset = 0 }) {
  const url = new URL(baseUrl);
  url.searchParams.set("t", "search");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (query) url.searchParams.set("q", query);
  const safeCategoryFilter = safeCategories(categories);
  if (safeCategoryFilter) url.searchParams.set("cat", safeCategoryFilter);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "c411-seed-ranker/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`API HTTP ${response.status}`);
  }

  return parseTorznab(await response.text());
}

export async function fetchTorznabPages({ baseUrl, apiKey, query = "", categories = "", target = 500, pageSize = 100 }) {
  const seen = new Set();
  const torrents = [];
  const maxPages = Math.ceil(target / pageSize);

  for (let page = 0; page < maxPages; page += 1) {
    const pageTorrents = await fetchTorznab({
      baseUrl,
      apiKey,
      query,
      categories,
      limit: pageSize,
      offset: page * pageSize
    });

    let added = 0;
    for (const torrent of pageTorrents) {
      if (isAdultTorrent(torrent)) continue;
      const key = torrent.guid || torrent.link || torrent.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      torrents.push(torrent);
      added += 1;
    }

    if (pageTorrents.length < pageSize || added === 0) break;
  }

  return torrents;
}
