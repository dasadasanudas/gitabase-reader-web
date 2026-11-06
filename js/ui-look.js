/* Gitabase Reader web: shelf and look additions (preview).
   1. Books that carry no chapters rows (Teachings of Lord Caitanya, Nectar of Devotion, Teachings of Queen Kunti ...: ebooks whose
      texts are chapters) get one chapter built from their text rows, so they open and read as paged ebooks.
   2. Shelf order: Bhagavad-gita, Srimad-Bhagavatam, Caitanya-caritamrita always first, in that order, in every language.
   3. A visible switch for the new Pentabase look (beta) in Settings and in the Aa panel; off = the old look. */
'use strict';
(function (GB) {
  const { h } = GB;
  const lib = GB.lib, L = GB.left;

  // ---------- 2. pinned order (runs first, so every screen that renders the shelf sees it) ----------
  const RANK = B => { const a = lib.shortAbbr(B); if (a === 'BG') return lib.edition(B) ? 1 : 0; if (a === 'SB') return 2; if (a === 'CC') return 3; return 9; };
  function pin() {
    const pos = new Map(lib.books.map((b, i) => [b, i]));
    lib.books.sort((a, b) => (a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0) || (RANK(a) - RANK(b)) || (pos.get(a) - pos.get(b)));
  }
  document.addEventListener('gb:library', pin, true);

  // ---------- 1. ebooks without chapter rows ----------
  async function synth(B) {
    for (const part of B.parts) {
      const D = part.D; if (!lib.has(D, 'textnums', 'book_id')) continue;
      const ids = [part.bookId, String(part.bookId)];
      let rs = [];
      try { rs = await lib.q(D, 'SELECT song, ch_no, count(*) AS n FROM textnums WHERE book_id IN (?, ?) GROUP BY song, ch_no ORDER BY song, ch_no', ids); } catch (e) { console.warn('ebook chapters', e); }
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

  // ---------- 3. New look (beta) switch ----------
  const isNew = () => GB.prefs.accent === 'penta';
  async function setLook(on) {
    if (on === isNew()) return;
    if (on) { await GB.store.kvSet('lookPrev', GB.prefs.accent); GB.setAccent('penta'); }
    else { const p = await GB.store.kvGet('lookPrev', 'tulasi'); GB.setAccent(p && p !== 'penta' && GB.ACCENTS[p] ? p : 'tulasi'); }
  }
  const SUB_ON = 'Pentabase look is on: its colours, shapes, shadows and motion. Switch off for the old look.';
  const SUB_OFF = 'Try the Pentabase look in day and night: new colours, shapes, shadows and motion. Off = the old look.';
  function settingsRow() {
    const on = isNew();
    return h('div.pref.click.look', { onclick: () => setLook(!isNew()) },
      h('div.pref-main', null, h('div.pref-t', { text: 'New look (beta)' }), h('div.pref-s', { text: on ? SUB_ON : SUB_OFF })),
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
      sec.append(h('div.rp-line', null, h('div.rp-h', { text: 'New look (beta)' }),
        h('button.sw2' + (on ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': 'New look (beta)', onclick: async () => { await setLook(!isNew()); draw(); } }, h('i'))),
        h('div.rp-note', { text: on ? 'Pentabase look. Off = the old look.' : 'Off = the old look.' }));
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
