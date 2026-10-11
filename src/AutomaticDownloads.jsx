import React, { useEffect, useRef, useState } from "react";
import { ATTEMPTS_KEY, SETTINGS_KEY, eligibleTorrents, readStored } from "./automaticDownloads.js";

export default function AutomaticDownloads({ torrents, downloaded, downloadBaseUrl, autoRefresh, onDownload }) {
  const [settings, setSettings] = useState(() => readStored(SETTINGS_KEY, { enabled: false, threshold: "" }));
  const [attempts, setAttempts] = useState(() => readStored(ATTEMPTS_KEY, {}));
  const [error, setError] = useState("");
  const frames = useRef(new Set());
  const validThreshold = settings.threshold !== "" && Number.isFinite(Number(settings.threshold)) && Number(settings.threshold) >= 0;

  function updateSettings(update) {
    const next = { ...settings, ...update };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      setSettings(next);
      setError("");
    } catch {
      setError("Stockage du navigateur indisponible : automatisation arrêtée pour éviter les doublons.");
      setSettings({ ...next, enabled: false });
    }
  }

  useEffect(() => {
    const sync = (event) => {
      if (event.key === SETTINGS_KEY) setSettings(readStored(SETTINGS_KEY, { enabled: false, threshold: "" }));
      if (event.key === ATTEMPTS_KEY) setAttempts(readStored(ATTEMPTS_KEY, {}));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    if (!settings.enabled || !validThreshold || !downloadBaseUrl) return;
    let stopped = false;
    async function dispatch() {
      const run = () => {
        if (stopped) return;
        const current = readStored(ATTEMPTS_KEY, {});
        const torrent = eligibleTorrents(torrents, settings.threshold, downloaded, current)[0];
        if (!torrent) return;
        const key = torrent.guid || torrent.id || torrent.title;
        const next = { ...current, [key]: new Date().toISOString() };
        try {
          localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(next));
        } catch {
          setError("Stockage indisponible : désactivez l’automatisation. Aucun nouveau téléchargement déclenché.");
          return;
        }
        setAttempts(next);
        const url = new URL(downloadBaseUrl);
        url.searchParams.set("id", torrent.id);
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.title = "Téléchargement automatique du fichier torrent";
        frame.src = url.toString();
        document.body.appendChild(frame);
        frames.current.add(frame);
        onDownload(torrent);
        // La navigation laisse Chrome gérer le fichier, sans fetch/CORS ni popup.
        // Un déclenchement n’est pas une confirmation de téléchargement.
      };
      if (navigator.locks) await navigator.locks.request("c411-automatic-download", run);
      else run();
    }
    dispatch();
    const timer = setInterval(dispatch, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [settings.enabled, settings.threshold, validThreshold, torrents, downloaded, downloadBaseUrl, onDownload]);

  useEffect(() => {
    const timer = setInterval(() => {
      // Les fichiers sont normalement transférés en quelques secondes.
      for (const frame of frames.current) { frame.remove(); frames.current.delete(frame); }
    }, 120000);
    return () => {
      clearInterval(timer);
      for (const frame of frames.current) frame.remove();
      frames.current.clear();
    };
  }, []);

  return (
    <section className="panel automaticDownloads" aria-label="Téléchargements automatiques Chrome">
      <div className="automaticDownloadControls">
        <label className="switchControl">
          <input type="checkbox" checked={Boolean(settings.enabled)} disabled={!validThreshold} onChange={(event) => updateSettings({ enabled: event.target.checked })} />
          <span className="switchTrack" aria-hidden="true"><span className="switchThumb" /></span>
          <span>Téléchargement automatique dans Chrome</span>
        </label>
        <label>Déclencher si le score dépasse
          <input type="number" min="0" step="any" placeholder="Choisir un seuil" value={settings.threshold ?? ""} onChange={(event) => updateSettings({ threshold: event.target.value })} />
        </label>
        <span aria-live="polite">{Object.keys(attempts).length} déclenchement(s) mémorisé(s)</span>
      </div>
      <p>Concerne les résultats correspondant aux filtres ci-dessus. Gardez cette page ouverte, autorisez les téléchargements automatiques multiples dans Chrome et désactivez « Toujours demander où enregistrer les fichiers ». Configurez qBittorrent pour surveiller le dossier Téléchargements.</p>
      <p>Chaque torrent n’est déclenché qu’une fois dans ce navigateur et reçoit la même coche que pour un téléchargement manuel. Chrome peut bloquer un téléchargement : vérifiez sa liste de téléchargements ; la coche et le compteur indiquent une demande lancée, pas la réception du fichier ni son ajout dans qBittorrent.</p>
      {!autoRefresh && <p role="status">L’actualisation automatique est désactivée : seuls les résultats déjà chargés sont surveillés.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
