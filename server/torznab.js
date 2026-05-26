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

export function parseTorznab(xml) {
  const itemMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return itemMatches.map((match) => {
    const itemXml = match[0];
    const enclosure = itemXml.match(/<enclosure\b[^>]*>/i)?.[0] ?? "";
    const size = textBetween(itemXml, "size") || attrValue(enclosure, "length");

    return {
      title: textBetween(itemXml, "title"),
      link: attrValue(enclosure, "url") || textBetween(itemXml, "link"),
      guid: textBetween(itemXml, "guid") || attrValue(enclosure, "url") || textBetween(itemXml, "link"),
      pubDate: textBetween(itemXml, "pubDate"),
      category: textBetween(itemXml, "category"),
      seeders: Number(extractTorznabAttr(itemXml, "seeders") || extractTorznabAttr(itemXml, "grabs") || 0),
      leechers: Number(extractTorznabAttr(itemXml, "leechers") || extractTorznabAttr(itemXml, "peers") || 0),
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
  if (categories) url.searchParams.set("cat", categories);

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
