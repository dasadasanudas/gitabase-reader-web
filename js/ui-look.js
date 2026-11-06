/* Gitabase Reader web: shelf, look and lookup additions.
   0. Fast start: when library/catalog.json carries "meta" for every file (tools/prepare_library.py), the library is built from it and no
      database is opened at start; a file opens (once, lazily) the first time something reads from it. Old catalogues boot the old way.
   1. Books that carry no chapters rows (Teachings of Lord Caitanya, Nectar of Devotion, Teachings of Queen Kunti ...: ebooks whose
      texts are chapters) get one chapter built from their text rows, so they open and read as paged ebooks.
   2. Shelf order: Bhagavad-gita, Srimad-Bhagavatam, Caitanya-caritamrita always first, in that order, in every language.
      Every second row of the shelf (books and volume groups) gets a soft grey tint.
   3. A visible switch for the Modern theme (beta) in Settings and in the Aa panel; off = the old look.
   4. The Modern accent itself (key 'penta', colours come from css/penta.css, not from inline styles). Safe to load where it already exists.
   5. Word lookup: the gitabase texts write the anusvara as m + acute and the guttural nasal as n-acute, the reader draws them as the dotted letters;
      the lookup key now uses the books' own spelling first (words with m-dot and n-dot were reported as 'not in the dictionary').
   6. Search: the status line names the file being read.
   7. A thin bar along the bottom of the reader shows how much of the current verse has been read (scrolled into view). */
'use strict';
(function (GB) {
  const { h } = GB;
  const lib = GB.lib, L = GB.left;

  // ---------- 0. fast start from the catalogue ----------
  // lazy databases: GBDB.lazy(id, source) registers a file; the first call that names it opens it, and everything waits for that
  const lazy = new Map();
  GBDB.lazy = (id, source) => { lazy.set(id, { source, p: null }); };
  const wake = id => {
    const l = lazy.get(id); if (!l) return null;
    return l.p || (l.p = GBDB.open(id, l.source).then(() => { lazy.delete(id); }, e => { l.p = null; throw e; }));
  };
  for (const k of ['q', 'batch', 'wbwLookup', 'wbwSuggest', 'fts', 'hasFts', 'stats']) {
    const f = GBDB[k];
    GBDB[k] = function (id) { const w = wake(id); const a = arguments; return w ? w.then(() => f.apply(GBDB, a)) : f.apply(GBDB, a); };
  }
  { const f = GBDB.lookup;
    GBDB.lookup = function (args) { const w = wake(args && args.dbId); return w ? w.then(() => f.call(GBDB, args)) : f.call(GBDB, args); }; }
  { const f = GBDB.close;
    GBDB.close = function (id) {
      const l = lazy.get(id);
      if (l && !l.p) { lazy.delete(id); return Promise.resolve(true); }
      return l ? l.p.then(() => f.call(GBDB, id)) : f.call(GBDB, id);
    }; }

  const LANGS = { en: 'eng', hi: 'hin', ru: 'rus', bn: 'ben', uk: 'ukr', de: 'ger', fr: 'fre', es: 'spa', it: 'ita', pt: 'por', lv: 'lat', sa: 'san', gu: 'guj', ta: 'tam', te: 'tel', ml: 'mal', kn: 'kan', mr: 'mar', or: 'ori', zh: 'chi', ja: 'jpn', pl: 'pol', cs: 'cze', hu: 'hun', bg: 'bul', ka: 'geo', et: 'est', lt: 'lit', ne: 'nep' };
  const NAME_LANG = { eng: 'eng', en: 'eng', rus: 'rus', ru: 'rus', hin: 'hin', hi: 'hin', ben: 'ben', bn: 'ben', ukr: 'ukr', ua: 'ukr', uk: 'ukr',
    ger: 'ger', de: 'ger', fre: 'fre', fr: 'fre', spa: 'spa', es: 'spa', guj: 'guj', gu: 'guj', mar: 'mar', nep: 'nep', san: 'san' };
  function nameLang(name) {
    const parts = String(name || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) if (NAME_LANG[parts[i]]) return NAME_LANG[parts[i]];
    return '';
  }
  // the same decision library.js makes when it opens a file (name first, then the script of the text, then the locale)
  function detectLang(locale, sample, name) {
    const n = nameLang(name); if (n) return n;
    const t = String(sample || '').replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ');
    const count = re => (t.match(re) || []).length;
    const dev = count(/[\u0900-\u097F]/g), ben = count(/[\u0980-\u09FF]/g), cyr = count(/[\u0400-\u04FF]/g), lat = count(/[A-Za-z]/g);
    const top = Math.max(dev, ben, cyr, lat);
    if (top > 0 && top === dev) return 'hin';
    if (top > 0 && top === ben) return 'ben';
    if (top > 0 && top === cyr) return /[їєі]/i.test(t) ? 'ukr' : 'rus';
    const l = String(locale || '').slice(0, 2).toLowerCase();
    const Lg = LANGS[l] || l;
    return top > 0 && top === lat && ['rus', 'ukr', 'hin', 'ben'].includes(Lg) ? 'eng' : (Lg || 'eng');
  }
  let fastSeq = 0;
  function dbFromMeta(f) {
    const m = f.meta, rec = { id: 'h:' + f.id, name: f.name, size: f.size, kind: 'hosted' };
    const num = 100000 + (++fastSeq);
    const D = { id: rec.id, num, name: rec.name, size: rec.size, kind: rec.kind, tables: m.tables, idx: m.tables.__idx || [], rec, meta: m };
    D.modern = lib.has(D, 'textnums', 'text_id') || lib.has(D, 'image_nums', 'bid');
    let sample = m.books.map(b => (b.title || '') + ' ' + (b.author || '')).join(' ');
    for (const t of m.sample || []) sample += ' ' + t;
    D.lang = detectLang(m.locale, sample, rec.name); D.locale = m.locale || '';
    D.entityMode = !!m.entityMode; D.songs = m.songs || []; D.chapters = m.chapters || []; D.books = m.books; D.hasFts = !!m.hasFts;
    D.imgKinds = {};
    for (const r of m.imgRows || []) (D.imgKinds[r.b] = D.imgKinds[r.b] || {})[r.k || 1] = r.n;
    GBDB.lazy(num, { base: new URL(f.base, document.baseURI).href, size: f.size, chunkSize: f.chunkSize });
    return D;
  }
  const bootOld = lib.boot;
  lib.boot = async function () {
    if (/^https?:$/.test(location.protocol)) {
      let cat = null;
      try { const r = await fetch('library/catalog.json', { cache: 'no-cache' }); if (r.ok) cat = await r.json(); } catch (e) {}
      if (cat && (cat.files || []).length && cat.files.every(f => f.meta && f.meta.tables && f.meta.books)) {
        try {
          await GBDB.init();
          const made = cat.files.map(dbFromMeta);
          lib.hosted = true; lib.catalog = cat;
          for (const D of made) lib.dbs.set(D.id, D);
          lib.rebuild(); lib.fast = true; return;
        } catch (e) { console.warn('catalogue start failed, opening the files instead', e); lib.dbs.clear(); }
      }
    }
    return bootOld.apply(this, arguments);
  };

  // ---------- 4. the Modern accent ----------
  if (!GB.ACCENTS.penta) GB.ACCENTS.penta = { name: 'Modern', day: '#207dff', night: '#61c6fa', hdr: '#f7f7f7', hdrN: '#212121', ink: '#5a5a5d', inkN: '#a9aaab', key: 'penta' };
  GB.ACCENTS.penta.name = 'Modern';
  { const ai = GB.accentInk;
    GB.accentInk = nightInk => { const a = GB.ACCENTS[(GB.prefs && GB.prefs.accent) || 'tulasi'] || GB.ACCENTS.tulasi; return a.ink ? (nightInk ? a.inkN : a.ink) : ai(nightInk); }; }
  { const aa = GB.applyAccent;
    GB.applyAccent = function () {
      aa.apply(this, arguments);
      if (GB.prefs.accent === 'penta') for (const k of ['--accent', '--link', '--chip-b', '--tab-on', '--hdr', '--tab-bar', '--cmp-bar', '--transl', '--hdr-grad', '--wash', '--hover', '--sel']) document.body.style.removeProperty(k);
    }; }

  // ---------- 2. pinned order (runs first, so every screen that renders the shelf sees it) ----------
  const RANK = B => { const a = lib.shortAbbr(B); if (a === 'BG') return lib.edition(B) ? 1 : 0; if (a === 'SB') return 2; if (a === 'CC') return 3; return 9; };
  function pin() {
    const pos = new Map(lib.books.map((b, i) => [b, i]));
    lib.books.sort((a, b) => (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0) || (RANK(a) - RANK(b)) || (pos.get(a) - pos.get(b)));
  }
  document.addEventListener('gb:library', pin, true);
  // every second row of the shelf (single books and volume groups alike), in a neutral grey
  function zebra() { let i = 0; document.querySelectorAll('.home-body .stbody :is(.bk, .vol)').forEach(v => v.classList.toggle('alt', i++ % 2 === 1)); }
  { const hr = GB.home.render;
    GB.home.render = function () { const r = hr.apply(this, arguments); try { zebra(); } catch (e) {} return r; }; }

  // ---------- 1. ebooks without chapter rows ----------
  async function synth(B) {
    for (const part of B.parts) {
      const D = part.D; if (!lib.has(D, 'textnums', 'book_id')) continue;
      const ids = [part.bookId, String(part.bookId)];
      let rs = null;
      const pre = D.meta && D.meta.noch && D.meta.noch[String(part.bookId)];   // from the catalogue: no database read needed
      if (pre) rs = pre.map(r => ({ song: r[0], ch_no: r[1], n: r[2] }));
      else {
        rs = [];
        try { rs = await lib.q(D, 'SELECT song, ch_no, count(*) AS n FROM textnums WHERE book_id IN (?, ?) GROUP BY song, ch_no ORDER BY song, ch_no', ids); } catch (e) { console.warn('ebook chapters', e); }
      }
      for (const r of rs) B.chapters.push({ song: String(r.song), ch: r.ch_no, title: B.title, size: 0, part, prevSize: 0, synth: true });
    }
    B.chapters.forEach((c, i) => { c.idx = i; c.book = B; });
  }
  document.addEventListener('gb:library', () => {
    const todo = lib.books.filter(B => !B.chapters.length && !B._synthP);
    if (!todo.length) return;
    const all = Promise.all(todo.map(B => { B._synthP = synth(B); return B._synthP; }));
    all.then(() => { try { if (document.querySelector('.home-body') && GB.home) GB.home.render(); } catch (e) {} });
  });
  // a one-chapter ebook opens straight on its contents (the list of its chapters)
  const bo = GB.book.open;
  GB.book.open = function (B, song) {
    const go = () => (B.chapters.length === 1 && B.chapters[0].synth && !B.hasSongs ? GB.chapter.open(B, B.chapters[0], null, true) : bo.call(GB.book, B, song));
    return B._synthP ? B._synthP.then(go) : go();
  };

  // ---------- 5. word lookup spelling ----------
  const gbKey = w => String(w == null ? '' : w).normalize('NFC').replace(/[\u1E41\u1E43]/g, 'm\u0301').replace(/[\u1E40\u1E42]/g, 'M\u0301').replace(/\u1E45/g, '\u0144').replace(/\u1E44/g, '\u0143');
  { const wl = GBDB.wbwLookup;
    GBDB.wbwLookup = async function (id, word) {
      const a = gbKey(word); let r = await wl.call(GBDB, id, a);
      if ((!r || !r.length) && a !== word) r = await wl.call(GBDB, id, word);
      return r;
    }; }

  // ---------- 6. search: say which file is being read ----------
  { const ft = GBDB.fts;
    GBDB.fts = function (dbId) {
      try { const st = document.querySelector('.searchpage .loading-row'); if (st) { const D = Array.from(lib.dbs.values()).find(x => x.num === dbId); st.textContent = 'Searching ' + (D ? D.name : 'the library') + '…'; } } catch (e) {}
      return ft.apply(GBDB, arguments);
    }; }

  // ---------- 7. bottom bar: how much of the current verse has been read ----------
  // the share of the verse that has scrolled into view (the bottom edge of what is on screen), so a verse that fits the screen reads 100%
  let vpBar = null, vpFill = null, vpLast = -1;
  function vpRatio(rd) {
    const clamp = x => Math.max(0, Math.min(1, x));
    const cont = rd.querySelector('.rd-cont');
    if (cont && !cont.hidden) {
      const cr = cont.getBoundingClientRect(), line = cr.top + 56;
      const it = Array.from(cont.querySelectorAll('.cv')).find(x => x.getBoundingClientRect().bottom > line);
      if (!it) return 1;
      const r = it.getBoundingClientRect(); return r.height > 0 ? clamp((cr.bottom - r.top) / r.height) : 1;
    }
    const pager = rd.querySelector('.rd-pager'); if (!pager) return 0;
    const slot = pager.querySelectorAll(':scope > .rd-slot')[1], sc = slot && slot.firstElementChild; if (!sc) return 0;
    if (pager.classList.contains('hz')) return sc.scrollWidth > 0 ? clamp((sc.scrollLeft + sc.clientWidth) / sc.scrollWidth) : 1;
    return sc.scrollHeight > 0 ? clamp((sc.scrollTop + sc.clientHeight) / sc.scrollHeight) : 1;
  }
  function vpUpdate() {
    const rd = vpBar && vpBar.closest('.rd'); if (!rd || rd.hidden) return;
    const rc = rd.getBoundingClientRect();   // pinned to the very bottom of the screen, under the reader only (not the sidebar)
    if (vpBar._l !== rc.left || vpBar._w !== rc.width) { vpBar._l = rc.left; vpBar._w = rc.width; vpBar.style.left = rc.left + 'px'; vpBar.style.width = rc.width + 'px'; }
    const p = Math.round(vpRatio(rd) * 1000) / 10; if (p === vpLast) return; vpLast = p;
    vpFill.style.width = p + '%'; vpBar.setAttribute('aria-valuenow', String(Math.round(p))); vpBar.title = Math.round(p) + '% of this verse read'; vpBar.classList.toggle('done', p >= 99.5);
  }
  { const rb = GB.reader.build;
    GB.reader.build = function () {
      const r = rb.apply(this, arguments);
      try {
        const stage = document.querySelector('#reader .rd-stage'); if (!stage) return r;
        vpFill = h('i'); vpBar = h('div.vprog', { role: 'progressbar', 'aria-label': 'Part of this verse read', 'aria-valuemin': '0', 'aria-valuemax': '100' }, vpFill);
        stage.append(vpBar);
        const rd = stage.closest('.rd'); rd.addEventListener('scroll', vpUpdate, { capture: true, passive: true });
        window.addEventListener('resize', vpUpdate); setInterval(vpUpdate, 500);
      } catch (e) { console.warn('verse progress bar', e); }
      return r;
    }; }

  // ---------- 3. Modern theme (beta) switch ----------
  const isNew = () => GB.prefs.accent === 'penta';
  async function setLook(on) {
    if (on === isNew()) return;
    if (on) { await GB.store.kvSet('lookPrev', GB.prefs.accent); GB.setAccent('penta'); }
    else { const p = await GB.store.kvGet('lookPrev', 'tulasi'); GB.setAccent(p && p !== 'penta' && GB.ACCENTS[p] ? p : 'tulasi'); }
  }
  const SUB_ON = 'Modern theme is on: its colours, shapes, shadows and motion, in day and night. Switch off for the old look.';
  const SUB_OFF = 'Try the Modern theme in day and night: new colours, shapes, shadows and motion. Off = the old look.';
  function settingsRow() {
    const on = isNew();
    return h('div.pref.click.look', { onclick: () => setLook(!isNew()) },
      h('div.pref-main', null, h('div.pref-t', { text: 'Modern theme (beta)' }), h('div.pref-s', { text: on ? SUB_ON : SUB_OFF })),
      h('span.sw' + (on ? '.on' : '')));
  }
  const sp = GB.settingsPage;
  GB.settingsPage = function () {
    sp.apply(this, arguments);
    const pg = L.find('settings'); if (!pg || pg._look) return; pg._look = 1;
    const ensure = () => { if (pg.body.querySelector('.pref.look')) return; const first = pg.body.querySelector('.pref-cat'); if (first) first.after(settingsRow()); };
    ensure(); new MutationObserver(ensure).observe(pg.body, { childList: true });
  };
  function panelSec() {
    const sec = h('div.rp-sec.rp-look');
    const draw = () => {
      const on = isNew(); sec.innerHTML = '';
      sec.append(h('div.rp-line', null, h('div.rp-h', { text: 'Modern theme (beta)' }),
        h('button.sw2' + (on ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': 'Modern theme (beta)', onclick: async () => { await setLook(!isNew()); draw(); } }, h('i'))),
        h('div.rp-note', { text: on ? 'Modern theme. Off = the old look.' : 'Off = the old look.' }));
    };
    draw(); return sec;
  }
  const rpOpen = GB.readPanel;
  GB.readPanel = function () {
    rpOpen.apply(this, arguments);
    let tries = 0;
    const hook = () => {
      const box = document.querySelector('.rp'); if (!box) { if (++tries < 8) requestAnimationFrame(hook); return; }
      if (box._look) return; box._look = 1;
      const ensure = () => { if (!box.querySelector('.rp-look')) box.prepend(panelSec()); };
      ensure(); new MutationObserver(ensure).observe(box, { childList: true });
    };
    hook();
  };
})(window.GB);
