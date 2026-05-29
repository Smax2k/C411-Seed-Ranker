import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Copy, Download, GitFork, History, Info, LogOut, Pencil, Plus, Radar, Save, X } from "lucide-react";
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
const WATCHLIST_DEFAULT_BONUS = 650;

function sizeGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

function ageLabel(date) {
  if (!date) return "-";
  const minutes = Math.max(Math.floor((Date.now() - new Date(date).getTime()) / 6e4), 0);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return `${hours} h ${remainingMinutes.toString().padStart(2, "0")} min`;
  return `${Math.round(hours / 24)} j`;
}

function HistoryChart({ rows }) {
  if (rows.length < 2) return null;
  const points = [...rows].reverse();
  const scores = points.map((row) => Number(row.score) || 0);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const spread = Math.max(max - min, 1);
  const width = 720;
  const height = 180;
  const path = points.map((row, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - ((Number(row.score) - min) / spread) * (height - 24) - 12;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="historyChart">
      <div className="chartLabels">
        <span>Score {max.toFixed(1)}</span>
        <span>{min.toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolution du score">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function App() {
  const [filters, setFilters] = useState(defaultFilters);
  const [health, setHealth] = useState(null);
  const [data, setData] = useState({ torrents: [], filters: defaultFilters });
  const [watchlist, setWatchlist] = useState({ radars: [], rules: [] });
  const [status, setStatus] = useState("Chargement...");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [radarsOpen, setRadarsOpen] = useState(false);
  const [radarTab, setRadarTab] = useState("automatic");
  const [radarSearch, setRadarSearch] = useState("");
  const [historyModal, setHistoryModal] = useState({ open: false, torrent: null, rows: [], loading: false });
  const [editingRadar, setEditingRadar] = useState(null);
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

  const manualRadarKeys = useMemo(() => new Set((watchlist.rules || []).map((rule) => rule.patternKey)), [watchlist.rules]);
  const automaticRadars = useMemo(() => watchlist.radars.filter((radar) => !manualRadarKeys.has(radar.patternKey)), [manualRadarKeys, watchlist.radars]);
  const manualRadars = useMemo(() => watchlist.radars.filter((radar) => manualRadarKeys.has(radar.patternKey)), [manualRadarKeys, watchlist.radars]);

  const filteredRadars = useMemo(() => {
    const tabRadars = radarTab === "manual" ? manualRadars : automaticRadars;
    const query = radarSearch.trim().toLowerCase();
    if (!query) return tabRadars;
    return tabRadars.filter((radar) => {
      const haystack = [
        radar.label,
        radar.patternKey,
        radar.latestTitle,
        ...(radar.torrents || []).map((torrent) => torrent.title)
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [automaticRadars, manualRadars, radarSearch, radarTab]);

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

  async function load({ fresh = false } = {}) {
    setStatus("Analyse des torrents...");
    try {
      const params = new URLSearchParams(searchParams);
      if (fresh) params.set("fresh", "1");
      const response = await fetch(`/api/ranked?${params}`);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur API");
      setData(body);
      const scanned = body.stats?.scanned ?? body.torrents.length;
      setStatus(`${body.torrents.length} classes sur ${scanned} analyses`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadWatchlist() {
    try {
      const response = await fetch("/api/watchlist");
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur watchlist");
      setWatchlist(body);
    } catch {
      setWatchlist({ radars: [], rules: [] });
    }
  }

  async function toggleRadar(radar, enabled) {
    try {
      const optimistic = {
        ...watchlist,
        radars: watchlist.radars.map((item) => item.patternKey === radar.patternKey ? { ...item, enabled } : item)
      };
      setWatchlist(optimistic);
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patternKey: radar.patternKey,
          label: radar.label,
          bonus: radar.bonus || 650,
          enabled
        })
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur watchlist");
      setWatchlist(body);
      load({ fresh: true });
    } catch (error) {
      setStatus(error.message);
      loadWatchlist();
    }
  }

  async function saveRadarEdit() {
    if (!editingRadar) return;
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patternKey: editingRadar.patternKey,
          label: editingRadar.label,
          bonus: editingRadar.bonus || 650,
          enabled: true,
          originalPatternKey: editingRadar.originalPatternKey || editingRadar.patternKey
        })
      });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur watchlist");
      setWatchlist(body);
      setRadarTab("manual");
      setEditingRadar(null);
      load({ fresh: true });
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function openHistory(torrent) {
    setHistoryModal({ open: true, torrent, rows: [], loading: true });
    try {
      const response = await fetch(`/api/torrent-history?id=${encodeURIComponent(torrent.id)}`);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Erreur historique");
      setHistoryModal({ open: true, torrent, rows: body.history || [], loading: false });
    } catch (error) {
      setHistoryModal({ open: true, torrent, rows: [], loading: false, error: error.message });
    }
  }

  function startManualRadar() {
    setRadarTab("manual");
    setEditingRadar({
      label: "",
      patternKey: "",
      bonus: WATCHLIST_DEFAULT_BONUS,
      enabled: true,
      isNew: true
    });
  }

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((body) => {
        setHealth(body);
        loadWatchlist();
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => load(), 450);
    const timer = autoRefresh ? setInterval(() => load(), 5 * 60 * 1000) : null;
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

      {radarsOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setRadarsOpen(false)}>
          <section className="helpModal radarModal" role="dialog" aria-modal="true" aria-labelledby="radars-title" onClick={(event) => event.stopPropagation()}>
            <div className="helpModalHead">
              <div>
                <h2 id="radars-title">Radars</h2>
                <p>{watchlist.radars.length ? `${watchlist.radars.filter((radar) => radar.enabled).length} actifs sur ${watchlist.radars.length}` : "Les détections apparaîtront après quelques scans RSS."}</p>
              </div>
              <div className="modalActions">
                <button className="secondaryButton addRadarButton" type="button" onClick={startManualRadar}>
                  <Plus size={16} />
                  Ajouter
                </button>
                <button className="iconButton" type="button" onClick={() => setRadarsOpen(false)} aria-label="Fermer">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="radarSearch">
              <input value={radarSearch} onChange={(event) => setRadarSearch(event.target.value)} placeholder="Filtrer les radars" autoFocus />
              {radarSearch ? (
                <button className="tinyIconButton" type="button" onClick={() => setRadarSearch("")} aria-label="Effacer la recherche">
                  <X size={15} />
                </button>
              ) : null}
            </div>
            <div className="radarTabs" role="tablist" aria-label="Type de radars">
              <button className={radarTab === "automatic" ? "active" : ""} type="button" role="tab" aria-selected={radarTab === "automatic"} onClick={() => setRadarTab("automatic")}>
                Automatiques
                <span>{automaticRadars.length}</span>
              </button>
              <button className={radarTab === "manual" ? "active" : ""} type="button" role="tab" aria-selected={radarTab === "manual"} onClick={() => setRadarTab("manual")}>
                Manuels
                <span>{manualRadars.length}</span>
              </button>
            </div>
            <div className="radarList">
              {filteredRadars.map((radar) => (
                <article className="radarCard" key={radar.patternKey}>
                  <div className="radarCardTop">
                    <strong>{radar.label}</strong>
                    <div className="radarTools">
                      <button className="tinyIconButton" type="button" onClick={() => setEditingRadar({ ...radar, originalPatternKey: radar.patternKey })} title="Modifier ce radar" aria-label="Modifier ce radar">
                        <Pencil size={15} />
                      </button>
                      <label className="switchControl compactSwitch" title={radar.enabled ? "Désactiver le bonus" : "Activer le bonus"}>
                        <input type="checkbox" checked={radar.enabled} onChange={(event) => toggleRadar(radar, event.target.checked)} />
                        <span className="switchTrack" aria-hidden="true">
                          <span className="switchThumb" />
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="radarStats">
                    <span>Heat {radar.heat}</span>
                    <span>Score {Math.round(radar.maxScore || 0)}</span>
                    <span>Leech {radar.maxLeechers}</span>
                    <span>{radar.torrentCount} torrents</span>
                    {radar.activeDayCount ? <span>{radar.activeDayCount} jours</span> : null}
                    <span>Bonus +{radar.bonus}</span>
                  </div>
                  <p>{radar.latestTitle}</p>
                  {radar.torrents?.length ? (
                    <div className="radarTorrentTable" role="table" aria-label={`Torrents liés à ${radar.label}`}>
                      <div className="radarTorrentRow radarTorrentHeader" role="row">
                        <span>Nom</span>
                        <span>Score</span>
                        <span>Leech</span>
                        <span>Seed</span>
                      </div>
                      {radar.torrents.map((torrent) => (
                        <div key={torrent.id} className="radarTorrentRow" role="row">
                          <a href={torrent.pageUrl} target="_blank" rel="noreferrer" title={torrent.title}>{torrent.title}</a>
                          <strong>{Math.round(torrent.score)}</strong>
                          <span>{torrent.leechers}</span>
                          <span>{torrent.seeders}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {!filteredRadars.length ? (
                <p className="emptyState">
                  {radarSearch
                    ? "Aucun radar ne correspond à cette recherche."
                    : radarTab === "manual"
                      ? "Aucun radar manuel pour l'instant."
                      : "Aucune détection automatique pour l'instant."}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {editingRadar ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setEditingRadar(null)}>
          <section className="helpModal editRadarModal" role="dialog" aria-modal="true" aria-labelledby="edit-radar-title" onClick={(event) => event.stopPropagation()}>
            <div className="helpModalHead">
              <h2 id="edit-radar-title">{editingRadar.isNew ? "Ajouter un radar" : "Modifier le radar"}</h2>
              <button className="iconButton" type="button" onClick={() => setEditingRadar(null)} aria-label="Fermer">
                <X size={18} />
              </button>
            </div>
            <div className="editRadarForm">
              <label>
                Nom affiché
                <input value={editingRadar.label} onChange={(event) => setEditingRadar((current) => ({ ...current, label: event.target.value }))} placeholder="Ex. The Last of Us" />
              </label>
              <label>
                Pattern
                <input value={editingRadar.patternKey} onChange={(event) => setEditingRadar((current) => ({ ...current, patternKey: event.target.value }))} placeholder="Mots à reconnaître dans les titres" />
              </label>
              <label>
                Bonus
                <input type="number" min="0" step="50" value={editingRadar.bonus || WATCHLIST_DEFAULT_BONUS} onChange={(event) => setEditingRadar((current) => ({ ...current, bonus: event.target.value }))} />
              </label>
              <button type="button" onClick={saveRadarEdit} disabled={!editingRadar.label.trim() || !editingRadar.patternKey.trim()}>
                <Save size={17} />
                Enregistrer
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {historyModal.open ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setHistoryModal({ open: false, torrent: null, rows: [], loading: false })}>
          <section className="helpModal historyModal" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}>
            <div className="helpModalHead">
              <div>
                <h2 id="history-title">Historique</h2>
                <p>{historyModal.torrent?.title}</p>
              </div>
              <button className="iconButton" type="button" onClick={() => setHistoryModal({ open: false, torrent: null, rows: [], loading: false })} aria-label="Fermer">
                <X size={18} />
              </button>
            </div>
            {historyModal.loading ? (
              <p className="emptyState">Chargement...</p>
            ) : historyModal.rows.length ? (
              <>
                <HistoryChart rows={historyModal.rows} />
                <div className="historyTableWrap">
                  <table className="historyTable">
                    <thead>
                      <tr>
                        <th>Vu</th>
                        <th>Score</th>
                        <th>Seed</th>
                        <th>Leech</th>
                        <th>Ratio</th>
                        <th>Grabs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyModal.rows.map((row) => (
                        <tr key={`${row.seenAt}-${row.seeders}-${row.leechers}`}>
                          <td>{new Date(row.seenAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                          <td className="score">{Number(row.score).toFixed(1)}</td>
                          <td>{row.seeders}</td>
                          <td>{row.leechers}</td>
                          <td>{(row.leechers / Math.max(row.seeders, 1)).toFixed(2)}</td>
                          <td>{row.grabs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="emptyState">{historyModal.error || "Pas encore assez de snapshots pour ce torrent."}</p>
            )}
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
          <button onClick={() => load({ fresh: true })}>Rafraîchir</button>
          <button className="secondaryButton" type="button" onClick={() => { loadWatchlist(); setRadarsOpen(true); }}>
            <Radar size={17} />
            Radars
          </button>
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
                <td>
                  <div className="torrentTitle">
                    {torrent.pageUrl ? (
                      <a href={torrent.pageUrl} target="_blank" rel="noreferrer">
                        {torrent.title}
                      </a>
                    ) : (
                      <span>{torrent.title}</span>
                    )}
                    {torrent.watchlistLabel ? <span className="watchBadge">{torrent.watchlistLabel}</span> : null}
                  </div>
                </td>
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
                  <button className="checkButton" type="button" onClick={() => openHistory(torrent)} title="Voir l'historique" aria-label="Voir l'historique">
                    <History size={17} />
                  </button>
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
