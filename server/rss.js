function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function buildRss(torrents, requestUrl) {
  const items = torrents.map((torrent) => `
    <item>
      <title>${escapeXml(`[${torrent.score.toFixed(1)}] ${torrent.title}`)}</title>
      <link>${escapeXml(torrent.link)}</link>
      <guid isPermaLink="false">${escapeXml(torrent.guid || torrent.id)}</guid>
      <pubDate>${escapeXml(torrent.pubDate || new Date().toUTCString())}</pubDate>
      <description>${escapeXml(`${torrent.seeders} seeders / ${torrent.leechers} leechers`)}</description>
      <enclosure url="${escapeXml(torrent.link)}" length="${Math.round(torrent.sizeBytes || 0)}" type="application/x-bittorrent" />
    </item>`).join("");

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
