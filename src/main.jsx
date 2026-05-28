import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Copy, Download, GitFork, Info, LogOut, X } from "lucide-react";
import "./styles.css";

const defaultFilters = {
  q: "",
  cat: "",
  maxSeeders: 30,
  minLeechers: 2,
  minSizeGb: 1,
  maxSizeGb: 500,
  maxAgeHours: 6,
  minScore: 0,
  maxResults: 40
};

function sizeGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

function ageLabel(date) {
  if (!date) return "-";
  const hours = Math.max((Date.now() - new Date(date).getTime()) / 36e5, 0);
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} j`;
}

function App() {
  const [filters, setFilters] = useState(defaultFilters);
  const [health, setHealth] = useState(null);
  const [data, setData] = useState({ torrents: [], filters: defaultFilters });
  const [status, setStatus] = useState("Chargement...");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("downloadedTorrents") || "{}");
    } catch {
      return {};
    }
  });

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== "") params.set(key, value);
    });
    return params;
  }, [filters]);

  const rssUrl = useMemo(() => {
    const token = health?.rssUrl ? new URL(health.rssUrl) : null;
    if (!token) return "";
    searchParams.forEach((value, key) => token.searchParams.set(key, value));
    return token.toString();
  }, [health, searchParams]);

  const downloadBaseUrl = useMemo(() => {
    if (!health?.rssUrl) return "";
    const url = new URL(health.rssUrl);
    url.pathname = "/download";
    url.searchParams.delete("maxSeeders");
    url.searchParams.delete("minLeechers");
    url.searchParams.delete("minSizeGb");
    url.searchParams.delete("maxSizeGb");
    url.searchParams.delete("maxAgeHours");
    url.searchParams.delete("minScore");
    url.searchParams.delete("maxResults");
    url.searchParams.delete("q");
    url.searchParams.delete("cat");
    return url;
  }, [health]);

  function downloadUrl(id) {
    if (!downloadBaseUrl) return "#";
    const url = new URL(downloadBaseUrl);
    url.searchParams.set("id", id);
    return url.toString();
  }

  function torrentKey(torrent) {
    return torrent.guid || torrent.id || torrent.title;
  }

  function setDownloadedState(key, value) {
    setDownloaded((current) => {
      const next = { ...current };
      if (value) {
        next[key] = new Date().toISOString();
      } else {
        delete next[key];
      }
      localStorage.setItem("downloadedTorrents", JSON.stringify(next));
      return next;
    });
  }

  function handleDownload(torrent) {
    setDownloadedState(torrentKey(torrent), true);
  }

  async function load() {
    setStatus("Analyse des torrents...");
    try {
      const response = await fetch(`/api/ranked?${searchParams}`);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur API");
      setData(body);
      const scanned = body.stats?.scanned ?? body.torrents.length;
      setStatus(`${body.torrents.length} classes sur ${scanned} analyses`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then(setHealth)
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    const delay = setTimeout(load, 450);
    const timer = autoRefresh ? setInterval(load, 5 * 60 * 1000) : null;
    return () => {
      clearTimeout(delay);
      if (timer) clearInterval(timer);
    };
  }, [searchParams, autoRefresh]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function copyRssUrl() {
    if (!rssUrl) return;
    await navigator.clipboard.writeText(rssUrl);
    setCopyStatus("Copié");
    setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <main className="shell">
      {helpOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setHelpOpen(false)}>
          <section className="helpModal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
            <div className="helpModalHead">
              <h2 id="help-title">Comment ca marche</h2>
              <button className="iconButton" type="button" onClick={() => setHelpOpen(false)} aria-label="Fermer">
                <X size={18} />
              </button>
            </div>
            <div className="helpGrid">
              <article>
                <strong>1. Scanner</strong>
                <p>L'application lit les nouveaux torrents C411 et garde une liste exploitable pour tes filtres.</p>
              </article>
              <article>
                <strong>2. Classer</strong>
                <p>Le score favorise les torrents récents, peu seedés, avec une demande visible et une taille utile pour générer de l'upload.</p>
              </article>
              <article>
                <strong>3. Télécharger</strong>
                <p>Le flux RSS utilise ta clé API de session pour fournir à qBittorrent tes propres liens de téléchargement.</p>
              </article>
            </div>
          </section>
        </div>
      ) : null}

      <section className="topbar">
        <div>
          <p className="eyebrow">RSS pour contenus légaux ou autorisés</p>
          <h1>C411 Seed Ranker</h1>
        </div>
        <div className="topActions">
          <label className="switchControl">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span className="switchTrack" aria-hidden="true">
              <span className="switchThumb" />
            </span>
            <span>Auto-refresh</span>
          </label>
          <button onClick={load}>Rafraîchir</button>
          <a className="logoutButton" href="https://github.com/Smax2k/C411-Seed-Ranker" target="_blank" rel="noreferrer" title="Voir le projet sur GitHub">
            <GitFork size={17} />
            GitHub
          </a>
          <a className="logoutButton" href="/logout" title="Se deconnecter">
            <LogOut size={17} />
            Déconnexion
          </a>
        </div>
      </section>

      <section className="introBanner">
        <div>
          <strong>Repère les torrents avec le meilleur potentiel d'upload.</strong>
          <span>Connecte ta clé API C411, ajuste les filtres, copie le RSS dans qBittorrent.</span>
        </div>
        <button className="secondaryButton" type="button" onClick={() => setHelpOpen(true)}>
          <Info size={17} />
          Détails
        </button>
      </section>

      <section className="panel controls">
        <label>
          Recherche
          <input value={filters.q} onChange={(event) => updateFilter("q", event.target.value)} placeholder="Optionnel" />
        </label>
        <label>
          Catégories
          <input value={filters.cat} onChange={(event) => updateFilter("cat", event.target.value)} placeholder="ex: 5000,5030" />
        </label>
        <label>
          Seeders max
          <input type="number" min="0" value={filters.maxSeeders} onChange={(event) => updateFilter("maxSeeders", event.target.value)} />
        </label>
        <label>
          Leechers min
          <input type="number" min="0" value={filters.minLeechers} onChange={(event) => updateFilter("minLeechers", event.target.value)} />
        </label>
        <label>
          Taille min Go
          <input type="number" min="0" step="0.1" value={filters.minSizeGb} onChange={(event) => updateFilter("minSizeGb", event.target.value)} />
        </label>
        <label>
          Taille max Go
          <input type="number" min="0.1" step="0.1" value={filters.maxSizeGb} onChange={(event) => updateFilter("maxSizeGb", event.target.value)} />
        </label>
        <label>
          Âge max heures
          <input type="number" min="1" step="1" value={filters.maxAgeHours} onChange={(event) => updateFilter("maxAgeHours", event.target.value)} />
        </label>
        <label>
          Score min
          <input type="number" min="0" step="10" value={filters.minScore} onChange={(event) => updateFilter("minScore", event.target.value)} />
        </label>
        <label>
          Résultats
          <input type="number" min="1" max="200" value={filters.maxResults} onChange={(event) => updateFilter("maxResults", event.target.value)} />
        </label>
      </section>

      <section className="rssBox compactRss">
        <span>RSS qBittorrent</span>
        <code>{rssUrl || "Demarre le serveur pour obtenir l'URL"}</code>
        <button className="secondaryButton" type="button" onClick={copyRssUrl} disabled={!rssUrl}>
          <Copy size={17} />
          {copyStatus || "Copier"}
        </button>
      </section>

      <section className="tableWrap">
        <div className="tableHead">
          <strong>{status}</strong>
          <span>{health?.hasApiKey ? "Clé API détectée" : "Clé API manquante"}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Torrent</th>
              <th>Seed</th>
              <th>Leech</th>
              <th>Ratio</th>
              <th>Taille</th>
              <th>Âge</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.torrents.map((torrent) => (
              <tr key={torrent.id || torrent.guid} className={downloaded[torrentKey(torrent)] ? "isDownloaded" : ""}>
                <td className="score">{torrent.score.toFixed(1)}</td>
                <td>{torrent.title}</td>
                <td>{torrent.seeders}</td>
                <td>{torrent.leechers}</td>
                <td>{(torrent.leechers / Math.max(torrent.seeders, 1)).toFixed(2)}</td>
                <td>{sizeGb(torrent.sizeBytes)}</td>
                <td>{ageLabel(torrent.pubDate)}</td>
                <td className="actions">
                  <a className="download" href={downloadUrl(torrent.id)} target="_blank" rel="noreferrer" onClick={() => handleDownload(torrent)} title="Télécharger le torrent">
                    <Download size={16} />
                    Télécharger
                  </a>
                  <button
                    className={`checkButton ${downloaded[torrentKey(torrent)] ? "active" : ""}`}
                    type="button"
                    onClick={() => setDownloadedState(torrentKey(torrent), !downloaded[torrentKey(torrent)])}
                    title={downloaded[torrentKey(torrent)] ? "Marquer comme non téléchargé" : "Marquer comme téléchargé"}
                    aria-label={downloaded[torrentKey(torrent)] ? "Marquer comme non téléchargé" : "Marquer comme téléchargé"}
                  >
                    <Check size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
