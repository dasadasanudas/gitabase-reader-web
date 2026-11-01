/* Gitabase Reader web: persistence (IndexedDB). Stores: kv (prefs/state), files (local gitabase blobs),
   notes (highlights, comments, questions, quotes, favourites, general notes), history, reading (reading list). */
'use strict';
(function (GB) {
  const NAME = 'gitabase-reader-web', VER = 3, STORES = ['kv', 'files', 'notes', 'history', 'reading'];
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const s = t.objectStore(store); let out;
      const r = fn(s); if (r && 'onsuccess' in r) r.onsuccess = () => (out = r.result);
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const store = {
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    all: s => tx(s, 'readonly', st => st.getAll()),
    put: (s, obj) => tx(s, 'readwrite', st => st.put(obj)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    clear: s => tx(s, 'readwrite', st => st.clear()),
    async kvGet(k, def) { const r = await store.get('kv', k); return r ? r.v : def; },
    kvSet: (k, v) => store.put('kv', { k, v })
  };
  GB.store = store;

  // ---------- preferences (from res/xml/preferences of the APK, plus web-only display switches) ----------
  const DEF = {
    night: false,
    openHistoryOnLaunch: false,
    layout: 'auto',                 // web: auto | desktop | mobile view
    hideStatusBar: false,           // pr_hide_android_status_bar_key: full screen while reading (phones)
    keepAwake: false,               // web: keep the screen on while a text is open
    defaultLayout: 'vertical',      // vertical | horizontal  (pr_default_layout_key)
    showSanskrit: true,
    wbwStyle: 'table',              // table | classic (APK default: table)
    hideDevanagari: false,
    fontSize: 18, fontStep: 1,
    textAlign: 'left',              // left | justify | center
    doubleProgress: false,
    topRightIcon: 'history',        // history | bookmark
    developer: false,
    chNotesIcons: true, chFullVerseNo: true, chSeqNo: true, chCompareSigns: false,
    hideImageTabs: false, chapters2col: true,
    readHours: 1, readSpeed: 10,    // hours per 3 days ; chars/min x100
    pageButtons: true,              // right-side up / close / down buttons
    pageButtonsCrossChapters: false,// PgUp/PgDn may open prev/next text (default No: they only scroll)
    crossButton: 'hide',            // hide | close  (what the middle button does)
    showPageNumbers: false,
    useIndex: true,                 // full-text index on/off
    matchScript: true,              // Hindi typography: per-block script detection & matching fonts
    diacritics: true,               // Diakritics vs Simple font
    notesFont: 16,
    lang: '', content: 'texts', fileFilter: '', picCols: 4, picChapters: true, picNumbers: false, picOpen: 'slide'
  };
  const prefs = Object.assign({}, DEF);
  GB.prefs = prefs;
  GB.prefsDefault = DEF;
  GB.loadPrefs = async () => { Object.assign(prefs, await store.kvGet('prefs', {})); return prefs; };
  GB.savePrefs = GB.debounce(() => store.kvSet('prefs', Object.assign({}, prefs)), 150);
  GB.setPref = (k, v) => { prefs[k] = v; GB.savePrefs(); document.dispatchEvent(new CustomEvent('gb:pref', { detail: { k, v } })); };
})(window.GB);
