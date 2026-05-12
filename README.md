# 🌐 Nexora Browser v2

> Browser desktop italiano — Electron + Chromium · Material You Design

---

## 🚀 Avvio rapido

```bash
cd nexora-browser
npm install    # ~1-2 minuti (scarica Electron)
npm start
```

---

## ⌨️ Shortcut tastiera

| Shortcut | Azione |
|---|---|
| `Ctrl+T` | Nuova tab |
| `Ctrl+W` | Chiudi tab corrente |
| `Ctrl+L` | Focus barra URL |
| `Ctrl+,` | Apri Impostazioni |
| `Ctrl+H` | Cronologia |
| `Ctrl+J` | Download |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Tab successiva / precedente |
| `Ctrl+1…9` | Salta alla tab N |
| `F5` | Aggiorna |
| `F11` | Schermo intero |
| `Alt+←/→` | Indietro / Avanti |

---

## 📁 Struttura

```
nexora-browser/
├── package.json
└── src/
    ├── main/
    │   └── main.js              ← processo Electron, BrowserView, IPC, download
    ├── preload/
    │   └── preload.js           ← bridge sicuro contextBridge
    └── renderer/
        ├── index.html           ← shell UI
        ├── app.js               ← orchestratore UI + IPC
        ├── components/
        │   ├── tabs.js          ← sistema tab DOM
        │   ├── settings.js      ← pagina impostazioni
        │   ├── history.js       ← pagina cronologia
        │   └── downloads.js     ← pagina & toast download
        └── styles/
            ├── tokens.css       ← variabili Material You
            ├── chrome.css       ← tab strip + nav bar
            └── panels.css       ← pagine interne
```

---

## ✨ Feature

- **Tab**: apri, chiudi, switcha — nessun crash con ultima tab
- **BrowserView reale** (non iframe): navigazione Chromium completa
- **URL smart**: dominio → `https://`, testo → DuckDuckGo
- **Homepage personalizzabile** dalle impostazioni
- **Motore di ricerca** configurabile (DDG, Google, Bing, Brave, custom)
- **Download**: toast in tempo reale, pagina dedicata, apri/mostra file
- **Cronologia**: raggruppata per giorno, cancellazione singola o totale
- **Segnalibri**: salva dalla barra, gestisci dalle impostazioni, nella New Tab
- **Menu applicazione** nativo Electron con tutte le azioni
- **Impostazioni**: tema chiaro/scuro, colore accento, cartella download
- **Material You**: design token system, colori dinamici, animazioni fluide
- **Pagina errore** elegante (no crash su URL non raggiungibili)
- **Header filter**: rimuove `X-Frame-Options` e CSP per max compatibilità
- **User-Agent Chrome realistico**: evita blocchi bot-detection
- **Dati persistenti** in `~/.config/nexora-browser/nexora/`
