export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function scoreTorrent(torrent, filters) {
  const seeders = Math.max(toNumber(torrent.seeders), 0);
  const leechers = Math.max(toNumber(torrent.leechers), 0);
  const sizeGb = Math.max(toNumber(torrent.sizeBytes) / 1024 ** 3, 0);
  const ageHours = torrent.pubDate
    ? Math.max((Date.now() - new Date(torrent.pubDate).getTime()) / 36e5, 0)
    : 72;

  const demand = Math.log1p(leechers) * 28;
  const scarcity = 46 / Math.sqrt(seeders + 1);
  const pressure = (leechers / Math.max(seeders, 1)) * 30;
  const freshness = Math.max(0, 18 - Math.log1p(ageHours) * 4);
  const sizeFit = sizeGb <= filters.maxSizeGb ? 12 : Math.max(0, 12 - (sizeGb - filters.maxSizeGb) * 1.8);
  const saturationPenalty = seeders > filters.maxSeeders ? (seeders - filters.maxSeeders) * 1.4 : 0;

  return Math.max(0, demand + scarcity + pressure + freshness + sizeFit - saturationPenalty);
}

function torrentAgeHours(torrent) {
  return torrent.pubDate
    ? Math.max((Date.now() - new Date(torrent.pubDate).getTime()) / 36e5, 0)
    : Number.POSITIVE_INFINITY;
}

export function rankTorrents(torrents, filters) {
  return torrents
    .map((torrent) => ({
      ...torrent,
      score: scoreTorrent(torrent, filters)
    }))
    .filter((torrent) => torrent.seeders <= filters.maxSeeders)
    .filter((torrent) => torrent.leechers >= filters.minLeechers)
    .filter((torrent) => torrent.sizeBytes >= filters.minSizeGb * 1024 ** 3)
    .filter((torrent) => torrent.sizeBytes <= filters.maxSizeGb * 1024 ** 3)
    .filter((torrent) => torrentAgeHours(torrent) <= filters.maxAgeHours)
    .filter((torrent) => torrent.score >= filters.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, filters.maxResults);
}
