export const SETTINGS_KEY = "c411AutomaticDownloads";
export const ATTEMPTS_KEY = "c411AutomaticDownloadAttempts";

export function readStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function eligibleTorrents(torrents, threshold, downloaded, attempts) {
  if (threshold === "" || !Number.isFinite(Number(threshold)) || Number(threshold) < 0) return [];
  return torrents.filter((torrent) => {
    const key = torrent.guid || torrent.id || torrent.title;
    return torrent.id && Number.isFinite(Number(torrent.score)) && Number(torrent.score) > Number(threshold)
      && !downloaded[key] && !attempts[key];
  });
}
