/* Gitabase Reader web: app shell (page stack, back handling, tab rail) and the home tabs:
   L My Library (Books / Reading / My books), F favourites, Q questions, N notes, T topics, D dictionary. */
'use strict';
(function (GB) {
  const { h, $, $$, img } = GB;
  const lib = GB.lib;
  GB.ut = s => String(s == null ? '' : s).replace(/ ([।॥ः])/g, '\u00a0$1');          // UI strings from the books
  GB.decEnt = s => String(s == null ? '' : s).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&').normalize('NFC');
  GB.foldKey = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Settings > Layout: 'desktop' / 'mobile' force a view; 'auto' follows the window width (900 px)
  GB.isWide = () => GB.prefs.layout === 'desktop' ? true : GB.prefs.layout === 'mobile' ? false : window.matchMedia('(min-width: 900px)').matches;
  const ico = (name, cls) => h('span.ico' + (cls ? '.' + cls : ''), { html: GB.icons.svg(name) });
  GB.ico = ico;

  // ---------- page stack (left column on desktop, whole screen on phones) ----------
  const L = GB.left = { stack: [] };
  L.top = () => L.stack[L.stack.length - 1];
  L.push = page => {
    const t = L.top(); if (t) t.el.classList.add('under');
    $('#left').append(page.el); L.stack.push(page); chrome();
    requestAnimationFrame(() => page.el.classList.add('in'));
    return page;
  };
  L.replaceTop = page => { if (L.stack.length > 1) { const p = L.stack.pop(); p.el.remove(); if (p.onClose) p.onClose(); } return L.push(page); };
  L.pop = () => {
    if (L.stack.length <= 1) return false;
    const p = L.stack.pop(); p.el.remove(); if (p.onClose) p.onClose();
    const t = L.top(); t.el.classList.remove('under'); if (t.refresh) t.refresh(); chrome(); return true;
  };
  L.home = tab => {
    while (L.stack.length > 1) { const p = L.stack.pop(); p.el.remove(); if (p.onClose) p.onClose(); }
    L.top().el.classList.remove('under');
    if (tab && tab !== HOME.tab) HOME.select(tab); else HOME.render();
    chrome();
  };
  L.find = kind => L.stack.find(p => p.kind === kind);
  function chrome() {
    document.body.classList.toggle('at-home', L.stack.length <= 1);
    $$('#rail .tab').forEach(t => t.classList.toggle('on', L.stack.length <= 1 && t.dataset.tab === HOME.tab));
  }
  GB.chrome = chrome;
  // generic page with an app title bar
  GB.page = function (o) {
    const back = h('button.hdr-logo', { title: 'Back', onclick: () => GB.back() }, img('headermenuicon.png'));
    const titles = h('div.t2', null, h('div.t2a', { text: GB.ut(o.title || '') }), o.subtitle != null ? h('div.t2b', { text: GB.ut(o.subtitle) }) : null);
    const right = h('div.hdr-right'); (o.actions || []).forEach(a => right.append(a));
    const hdr = h('header.hdr' + (o.big ? '.big' : ''), null, back, titles, right);
    const body = h('div.pc' + (o.bodyCls ? '.' + o.bodyCls : ''));
    const el = h('div.page' + (o.cls ? '.' + o.cls : ''), null, hdr, o.under || null, body);
    return { el, hdr, body, titles, kind: o.kind, refresh: o.refresh, onClose: o.onClose };
  };
  GB.hbtn = (iconName, title, onclick, cls) => h('button.hdr-btn' + (cls ? '.' + cls : ''), { title, onclick }, iconName.indexOf('.') > 0 ? img(iconName.replace(/\.(png|svg)$/, '_hdr.$1')) : ico(iconName));

  // ---------- back: overlays -> reader (phone) -> page stack -> home tab ----------
  GB.back = function () {
    if (GB.ui.handleEsc()) return true;
    if (document.body.classList.contains('reading') && !GB.isWide()) { GB.reader.close(); return true; }
    if (L.pop()) return true;
    if (HOME.tab !== 'L') { HOME.select('L'); return true; }
    return false;
  };
  GB.nav = {
    init() {
      try { history.pushState({ gb: 1 }, ''); } catch (e) {}
      window.addEventListener('popstate', () => { if (GB.back()) { try { history.pushState({ gb: 1 }, ''); } catch (e) {} } });
    }
  };

  // ---------- rail / bottom tabs ----------
  GB.APP_NAME = GB.APP_NAME || 'Gitabase Reader';   // shown in the menu and About; index.html and manifest.webmanifest carry it too
  const TABS = [
    { k: 'L', icon: 'lib', title: 'Library' }, { k: 'F', icon: 'fav', title: 'Saved passages' },
    { k: 'Q', icon: 'quest', title: 'Questions' }, { k: 'N', icon: 'note', title: 'Notes' },
    { k: 'T', icon: 'topic', title: 'Topics' }, { k: 'D', icon: 'dict', title: 'Word finder' }];
  GB.TABS = TABS;
  function buildRail() {
    const r = $('#rail'); r.innerHTML = '';
    for (const t of TABS) r.append(h('button.tab', { 'data-tab': t.k, title: t.title, 'aria-label': t.title, onclick: () => L.home(t.k) }, h('span.tab-ico', { html: GB.icons.svg(t.icon) })));
  }

  // ---------- home ----------
  const HOME = GB.home = { tab: 'L', sub: 'books', favFilter: 'all', qGeneral: false, nGeneral: false, showFinished: false };
  let homeEl, hdrEl, bodyEl;
  HOME.build = function () {
    buildRail();
    hdrEl = h('header.hdr.home-hdr'); bodyEl = h('div.pc.home-body');
    homeEl = h('div.page.home.in', null, hdrEl, h('div.strip', { text: 'Hare Kṛṣṇa Hare Kṛṣṇa Kṛṣṇa Kṛṣṇa Hare Hare · Hare Rāma Hare Rāma Rāma Rāma Hare Hare' }), bodyEl);
    L.stack = []; $('#left').innerHTML = ''; L.push({ el: homeEl, kind: 'home', refresh: () => HOME.render() });
    HOME.render();
  };
  HOME.select = tab => { HOME.tab = tab; HOME.render(); chrome(); bodyEl.scrollTop = 0; };
  HOME.render = function () {
    renderHeader();
    const keep = bodyEl.scrollTop; bodyEl.innerHTML = ''; bodyEl.className = 'pc home-body tab-' + HOME.tab;
    ({ L: renderL, F: renderF, Q: () => renderNotes('quest'), N: () => renderNotes('note'), T: renderT, D: renderD })[HOME.tab](bodyEl);
    bodyEl.scrollTop = keep; chrome();
  };
  function renderHeader() {
    hdrEl.innerHTML = '';
    const logo = h('button.hdr-logo', { title: 'Menu', onclick: e => tabMenu(e.currentTarget) }, img('headermenuicon.png'));
    hdrEl.append(logo);
    const right = h('div.hdr-right');
    if (HOME.tab === 'L') {
      const langs = lib.langs(); const cur = curLang();
      const flag = cur === 'eng' ? img('eng.png', 'flag') : h('span.flag.txt', { text: (cur || '··').slice(0, 2).toUpperCase() });
      const langBtn = h('button.hdr-dd', { title: 'Language', onclick: e => langMenu(e.currentTarget) }, flag, h('span.dd-text', { text: cur || 'all' }), img('ic_arrow_drop_down_28.svg', 'dd-arrow'));
      const files = filesFor(cur); const ff = files.find(D => D.id === GB.prefs.fileFilter);
      const typeBtn = h('button.hdr-dd.grow', { title: 'Choose collection', onclick: e => contentMenu(e.currentTarget) }, img('change_content.png', 'dd-swap'), h('span.dd-text', { text: ff ? shortName(ff.name) : 'texts' }), img('ic_arrow_drop_down_28.svg', 'dd-arrow'));
      hdrEl.append(h('div.hdr-lib', null, langs.length ? langBtn : null, typeBtn));
      right.append(GB.hbtn('ic_action_search.png', 'Search', () => GB.search.dialog({})));
    } else {
      const titles = { F: favTitle(), Q: HOME.qGeneral ? 'General questions' : 'Questions on texts', N: HOME.nGeneral ? 'General notes' : 'Notes on texts', T: 'Topics', D: 'Word finder' };
      const t = h('div.hdr-title', { text: titles[HOME.tab], onclick: () => { if (HOME.tab === 'Q') { HOME.qGeneral = !HOME.qGeneral; HOME.render(); } if (HOME.tab === 'N') { HOME.nGeneral = !HOME.nGeneral; HOME.render(); } } });
      if (HOME.tab === 'Q' || HOME.tab === 'N') t.classList.add('switch');
      hdrEl.append(t);
      if ((HOME.tab === 'Q' && HOME.qGeneral) || (HOME.tab === 'N' && HOME.nGeneral)) right.append(GB.hbtn('ic_plus_orange.png', HOME.tab === 'Q' ? 'New question' : 'New note', () => GB.noteEdit({ type: HOME.tab === 'Q' ? 'quest' : 'note', general: true })));
      if (HOME.tab === 'T') right.append(GB.hbtn('ic_new_topic.png', 'New topic', addTopic));
    }
    hdrEl.append(right);
  }
  const favTitle = () => ({ all: 'Saved passages', quote: 'Saved quotes', fav: 'Favourite texts', highl: 'Highlights' })[HOME.favFilter];
  function curLang() { const ls = lib.langs(); if (GB.prefs.lang === '*') return ''; if (ls.includes(GB.prefs.lang)) return GB.prefs.lang; return ls.includes('eng') ? 'eng' : (ls[0] || ''); }
  HOME.curLang = curLang;
  const filesFor = lang => Array.from(lib.dbs.values()).filter(D => !lang || D.lang === lang);
  const shortName = n => String(n).replace(/\.(db|gitabase|sqlite3?)$/i, '').replace(/^gitabase_/i, '').slice(0, 22);
  function langMenu(anchor) {
    const items = [{ header: true, label: 'Language' }].concat(lib.langs().map(l => ({ label: (lib.LANG_NAMES[l] || l) + '  (' + l + ')', checked: curLang() === l, onClick: () => { GB.setPref('lang', l); GB.setPref('fileFilter', ''); HOME.render(); } })));
    if (lib.langs().length > 1) items.push({ label: 'All languages', checked: GB.prefs.lang === '*', onClick: () => { GB.setPref('lang', '*'); GB.setPref('fileFilter', ''); HOME.render(); } });
    GB.ui.menu(anchor, items, { align: 'left' });
  }
  function contentMenu(anchor) {
    const files = filesFor(curLang());
    const items = [{ header: true, label: 'Choose collection' }, { label: 'All texts', checked: !GB.prefs.fileFilter, onClick: () => { GB.setPref('fileFilter', ''); HOME.render(); } }]
      .concat(files.map(D => ({ label: shortName(D.name) + ' · ' + GB.fmtSize(D.size), checked: GB.prefs.fileFilter === D.id, onClick: () => { GB.setPref('fileFilter', D.id); HOME.render(); } })));
    if (!lib.hosted) items.push({ divider: true }, { label: 'Add books', icon: 'ic_plus_orange.png', onClick: () => GB.addFilesUI() });
    GB.ui.menu(anchor, items, { align: 'left' });
  }
  // per-tab menus
  function tabMenu(anchor) {
    const common = [{ label: 'History', icon: 'ic_screen_manager.png', onClick: () => GB.historyPage() }];
    const notesIO = [{ label: 'Back up notes', icon: 'ic_save_to_cloud.png', onClick: () => GB.notes.backup() }, { label: 'Restore notes', icon: 'ic_open_from_cloud.png', onClick: () => GB.restoreUI() }];
    const font = [{ label: 'Larger text', icon: 'ic_action_inct.png', onClick: () => GB.fontStep(1) }, { label: 'Smaller text', icon: 'ic_menu_dec_font.png', onClick: () => GB.fontStep(-1) }];
    let items;
    if (HOME.tab === 'L') items = [{ header: true, label: 'Menu' }].concat(common, [
      { label: GB.APP_NAME, icon: 'ic_mmenu_about.png', sub: [{ header: true, label: GB.APP_NAME }, { label: 'About', icon: 'ic_mmenu_about.png', onClick: GB.about },
        { label: 'Maintenance', icon: 'ic_sysutils.png', sub: [{ header: true, label: 'Maintenance' }, { label: 'Clear search history', onClick: async () => { await GB.store.kvSet('searchHistory', []); GB.ui.toast('Search history cleared'); } }, { label: 'Clear browsing history', onClick: async () => { await GB.history.clear(); GB.ui.toast('Browsing history cleared'); } }].concat(notesIO) }] },
      lib.hosted ? null : { label: 'Add books', icon: 'ic_plus_orange.png', onClick: () => GB.addFilesUI() },
      { label: GB.prefs.night ? 'Day theme' : 'Night theme', icon: GB.prefs.night ? 'ic_sun.png' : 'ic_menu_night.png', onClick: GB.toggleNight },
      { label: 'Choose collection', icon: 'ic_change_gitabase.png', onClick: () => contentMenu(anchor) }], font,
      [{ label: 'Settings', icon: 'ic_mmenu_settings.png', onClick: () => GB.settingsPage() }]);
    else if (HOME.tab === 'F') items = notesIO.concat(font, [{ divider: true },
      { label: 'Quotes only', icon: 'cab_highl.png', checked: HOME.favFilter === 'quote', onClick: () => setFav('quote') },
      { label: 'Favourites only', icon: 'cab_fav.png', checked: HOME.favFilter === 'fav', onClick: () => setFav('fav') },
      { label: 'Highlights only', icon: 'ic_notes_highl.png', checked: HOME.favFilter === 'highl', onClick: () => setFav('highl') },
      { label: 'Everything', checked: HOME.favFilter === 'all', onClick: () => setFav('all') }]);
    else if (HOME.tab === 'Q') items = common.concat(notesIO, font, [{ label: 'General / on texts', icon: 'ic_menu_compare.png', onClick: () => { HOME.qGeneral = !HOME.qGeneral; HOME.render(); } }, { label: 'New question', icon: 'ic_menu_add_question.png', onClick: () => GB.noteEdit({ type: 'quest', general: true }) }]);
    else if (HOME.tab === 'N') items = common.concat(notesIO, font, [{ label: 'General / on texts', icon: 'ic_menu_compare.png', onClick: () => { HOME.nGeneral = !HOME.nGeneral; HOME.render(); } }, { label: 'New note', icon: 'ic_menu_add_note.png', onClick: () => GB.noteEdit({ type: 'note', general: true }) }]);
    else if (HOME.tab === 'T') items = common.concat(notesIO, font, [{ label: 'New topic', icon: 'ic_new_topic.png', onClick: addTopic }]);
    else items = common.concat([{ label: 'About', icon: 'ic_mmenu_about.png', onClick: GB.about }]);
    GB.ui.menu(anchor, items.filter(Boolean), { align: 'left' });
  }
  function setFav(f) { HOME.favFilter = f; HOME.render(); }
  async function addTopic() { const t = await GB.ui.prompt('New topic', '', 'topic name (use / for a subtopic)'); if (t) { await GB.notes.addTopic(t); HOME.render(); } }

  // ---------- L: library ----------
  function renderL(body) {
    const subs = [['books', 'Books'], ['reading', 'Reading']].concat(lib.hosted ? [] : [['mine', 'My books']]);
    body.append(h('div.subtabs', null, subs.map(([k, t]) => h('button.st' + (HOME.sub === k ? '.on' : ''), { onclick: () => { HOME.sub = k; HOME.render(); } }, h('span', { text: t })))));
    const list = h('div.stbody'); body.append(list);
    if (HOME.sub === 'reading') renderReading(list); else if (HOME.sub === 'mine' && !lib.hosted) renderMine(list); else renderBooks(list);
  }
  function emptyLib(list) {
    list.append(h('div.empty', null, img(GB.prefs.night ? 'my_books_empty_d.png' : 'my_books_empty.png', 'empty-img'),
      h('div.empty-t', { text: lib.hosted ? 'The online library is empty' : 'No book files yet' }),
      lib.hosted ? null : h('div.empty-s', { text: 'Add .db / .gitabase files from your computer or phone. They stay in this browser, so you add them only once.' }),
      lib.hosted ? null : h('button.btn', { onclick: () => GB.addFilesUI() }, ico('plus'), h('span', { text: 'Add book files' })),
      lib.hosted ? null : h('div.empty-s.small', { text: 'Tip: you can also drop the files onto this window.' })));
    if (lib.broken && lib.broken.length) list.append(h('div.empty-s.err', { text: 'Could not reopen: ' + lib.broken.map(r => r.name).join(', ') }));
  }
  function renderBooks(list) {
    const lang = curLang(); let books = lib.books.filter(B => !lang || B.lang === lang);
    if (GB.prefs.fileFilter) books = books.filter(B => B.parts.some(p => p.D.id === GB.prefs.fileFilter));
    if (!lib.books.length) return emptyLib(list);
    for (const B of books) list.append(bookCard(B));
  }
  function bookCard(B) {
    const rd = GB.reading.get(B);
    if (B.hasSongs) {
      const row = h('div.cantos');
      for (const s of B.songs) {
        const mark = rd && String(rd.song) === s.song;
        row.append(h('div.canto', { onclick: () => GB.book.open(B, s.song) },
          h('div.canto-sub', { text: GB.ut(s.subtitle || (B.lang === 'eng' ? 'Canto ' + s.song : s.song)) }),
          h('div.canto-title', { text: GB.ut(s.name || ('Canto ' + s.song)) }),
          mark ? h('div.canto-mark', null, h('span', { text: rd.label.split(' ').pop() }), img('ic_bookmark_icon_short.png')) : null));
      }
      return h('div.vol', null, h('div.vol-author', { text: GB.ut(B.author) }), h('div.vol-title', { text: GB.ut(B.title), onclick: () => GB.book.open(B) }), row);
    }
    return h('div.bk', { onclick: () => GB.book.open(B) }, h('div.bk-author', { text: GB.ut(B.author) }), h('div.bk-title', { text: GB.ut(B.title) }),
      rd ? h('div.bk-mark', null, h('span', { text: rd.label.split(' ').pop() }), img(GB.prefs.night ? 'bookmark_open_dark.png' : 'bookmark_open.png')) : null,
      B.hasImages ? img('ic_images.png', 'bk-img') : null);
  }
  function renderReading(list) {
    const all = Array.from(GB.reading.map.values()).filter(e => lib.book(e.id)).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    const fin = all.filter(e => e.finished), act = all.filter(e => !e.finished);
    const show = HOME.showFinished ? fin : act;
    if (!all.length) list.append(h('div.help-row', { text: 'Books you start reading appear here with your position, progress and reading time. Tap a card to continue.' }));
    for (const e of show) list.append(HOME.showFinished ? finishedCard(e) : readingCard(e));
    list.append(h('div.rswitch', { onclick: () => { HOME.showFinished = !HOME.showFinished; HOME.render(); } },
      h('span.rswitch-t', { text: HOME.showFinished ? 'Reading' : 'Finished' }), h('span.rswitch-c', { text: String(HOME.showFinished ? act.length : fin.length) }), ico('fwd', 'rswitch-a')));
  }
  function readingCard(e) {
    const B = lib.book(e.id); const pct = Math.round((e.progress || 0) * 100);
    const left = B ? Math.max(0, B.textSize * (1 - (e.progress || 0)) / (Math.max(1, GB.prefs.readSpeed) * 100) * 60000) : 0;
    return h('div.rcard', { onclick: () => GB.reader.openSaved(B, e) },
      h('div.rc-author', { text: GB.ut(e.author) }), h('div.rc-title', { text: GB.ut(e.title) }),
      h('div.rc-prog', null, h('span.rc-pct', { text: pct + '%' }), h('div.rc-bar', null, h('i', { style: { width: pct + '%' } }))),
      h('div.rc-meta', null, img(GB.prefs.night ? 'ic_time1_d.png' : 'ic_time1_o.png', 'rc-ic'), h('span', { text: GB.fmtDuration(e.timeSpent || 0) }), h('span.rc-code', { text: e.label }),
        h('span.rc-left', { text: GB.fmtDuration(left) }), img(GB.prefs.night ? 'ic_time2_d.png' : 'ic_time2_o.png', 'rc-ic')),
      h('div.rc-sub', { text: GB.ut(e.preview || e.chTitle || '') }),
      h('span.rc-mode', { html: GB.icons.svg(e.mode === 'horizontal' ? 'horizontal' : 'vertical'), title: e.mode === 'horizontal' ? 'Horizontal scrolling' : 'Vertical scrolling' }),
      h('button.rc-del', { title: 'Delete', onclick: async ev => { ev.stopPropagation(); if (await GB.ui.confirm('Reading list', 'Remove "' + e.title + '" from the reading list?')) { await GB.reading.remove(e.id); HOME.render(); } } }, img(GB.prefs.night ? 'ic_icon_delete_d.png' : 'ic_icon_delete.png')));
  }
  function finishedCard(e) {
    return h('div.rcard.fin', { onclick: () => GB.reader.openSaved(lib.book(e.id), e) }, img(GB.prefs.night ? 'purnam_d.png' : 'purnam.png', 'rc-ribbon'),
      h('div.rc-author', { text: GB.ut(e.author) }), h('div.rc-title', { text: GB.ut(e.title) }), h('div.rc-time', { text: 'Reading time: ' + GB.fmtDuration(e.timeSpent || 0) + (e.finishedAt ? ' · finished ' + new Date(e.finishedAt).toLocaleDateString() : '') }));
  }
  function renderMine(list) {
    list.append(h('div.file-add', { onclick: () => GB.addFilesUI() }, img('ic_plus_orange.png'), h('span', { text: 'Add book files (.db, .gitabase)' })));
    const files = Array.from(lib.dbs.values());
    if (!files.length) list.append(h('div.help-row', { text: 'Files you add are kept inside this browser (IndexedDB) and are read page by page, so even 190 MB gitabases open instantly.' }));
    for (const D of files) {
      const books = lib.books.filter(B => B.parts.some(p => p.D === D)).map(B => B.title);
      list.append(h('div.file-row', null, ico('db', 'file-ic'), h('div.file-main', null, h('div.file-name', { text: D.name }),
        h('div.file-meta', { text: GB.fmtSize(D.size) + ' · ' + (lib.LANG_NAMES[D.lang] || D.lang) + (D.hasFts ? ' · search index' : '') }), h('div.file-books', { text: GB.ut(books.join(' · ')) })),
        h('button.file-del', { title: 'Remove from library', onclick: async () => { if (await GB.ui.confirm('Remove book file', 'Remove ' + D.name + ' from this browser? Your notes stay.', 'REMOVE')) { await lib.removeDb(D.id); HOME.render(); } } }, ico('trash'))));
    }
    if (lib.broken && lib.broken.length) list.append(h('div.empty-s.err', { text: 'Could not reopen: ' + lib.broken.map(r => r.name).join(', ') }));
  }
  GB.addFilesUI = () => { const i = $('#fileAdd'); i.value = ''; i.click(); };

  // ---------- note cards (F / Q / N / T lists) ----------
  const TYPE_ICON = { fav: 'star_icon.png', quote: 'cab_highl.png', highl: 'cab_highl.png', note: 'cab_comment.png', quest: 'qmark.png' };
  GB.noteCard = function (n) {
    const top = h('div.nc-top', null, img(n.general ? (n.type === 'quest' ? 'ic_my_question.png' : 'ic_my_note.png') : TYPE_ICON[n.type] || 'cab_comment.png', 'nc-type'),
      n.ref ? h('span.nc-chip', { text: n.ref.label + ' »' }) : null, h('span.nc-date', { text: GB.fmtDate(n.created) }));
    const el = h('div.ncard.t-' + n.type, { onclick: () => openNote(n) }, top,
      n.subject ? h('div.nc-subject', { text: n.subject }) : null,
      n.text ? h('div.nc-comment', { text: n.text }) : null,
      n.quote ? h('div.nc-quote' + (n.type === 'fav' ? '.fav' : ''), { text: GB.ut(n.quote) }) : null,
      (n.tags && n.tags.length) ? h('div.nc-tags', { text: '#: ' + n.tags.join(', ') }) : null,
      h('button.nc-edit', { title: 'Edit', onclick: e => { e.stopPropagation(); GB.noteEdit(n); } }, ico('edit')));
    return el;
  };
  async function openNote(n) {
    if (!n.ref) return GB.noteEdit(n);
    const B = lib.book(n.ref.book) || lib.resolveBook(n.ref.abbr, n.ref.lang);
    if (!B) { GB.ui.toast('The book of this note is not in your library'); return; }
    const ch = lib.findChapter(B, n.ref.song, n.ref.ch); if (!ch) { GB.ui.toast('Chapter not found in your library'); return; }
    const rows = await lib.chapterTexts(B, ch); const i = lib.findTextIndex(rows, n.ref.no); if (i < 0) return;
    GB.reader.open(B, ch, i, { noteId: n.id });
  }
  function noteList(body, notes, emptyText) {
    if (!notes.length) { body.append(h('div.help-row', { text: emptyText })); return; }
    notes.sort((a, b) => b.created - a.created).forEach(n => body.append(GB.noteCard(n)));
  }
  function renderF(body) {
    const F = [['all', 'All'], ['highl', 'Highlights'], ['quote', 'Quotes'], ['fav', 'Texts']];
    body.append(h('div.filters', null, F.map(([k, t]) => h('button.fchip' + (HOME.favFilter === k ? '.on' : ''), { text: t, onclick: () => setFav(k) }))));
    const want = HOME.favFilter === 'all' ? ['fav', 'quote', 'highl'] : [HOME.favFilter];
    noteList(body, GB.notes.list.filter(n => want.includes(n.type)), 'Select words and choose Highlight or Quote, or tap the garland under a translation, to keep a passage here.');
  }
  function renderNotes(type) {
    const general = type === 'quest' ? HOME.qGeneral : HOME.nGeneral;
    const list = GB.notes.list.filter(n => n.type === type && !!n.general === general);
    noteList(bodyEl, list, general ? 'Tap + to add a general ' + (type === 'quest' ? 'question' : 'note') + '.' : 'Select text in a verse and choose ' + (type === 'quest' ? 'Question' : 'Comment') + '.');
  }
  // ---------- T: topics ----------
  function topicRows(body, parent) {
    const kids = GB.notes.children(parent);
    for (const t of kids) {
      const subs = GB.notes.children(t).length, cnt = GB.notes.inTopic(t, false).length;
      body.append(h('div.folder', { onclick: () => GB.topicPage(t) }, img(subs ? 'ic_folder_subs.png' : 'ic_folder.png', 'folder-ic'),
        h('div.folder-main', null, h('div.folder-name', { text: t.split('/').pop() }), h('div.folder-n', { text: (subs ? subs + ' subtopic(s), ' : '') + cnt + ' note(s)' })),
        h('button.folder-more', { title: 'Topic actions', onclick: e => { e.stopPropagation(); topicMenu(e.currentTarget, t); } }, ico('more'))));
    }
    return kids.length;
  }
  function topicMenu(anchor, t) {
    GB.ui.menu(anchor, [{ label: 'Rename', icon: 'ic_rename_o.png', onClick: async () => { const n = await GB.ui.prompt('Rename topic', t); if (n && n !== t) { await GB.notes.renameTopic(t, n); refreshAll(); } } },
      { label: 'Add subtopic', icon: 'ic_new_topic.png', onClick: async () => { const n = await GB.ui.prompt('New subtopic of ' + t, ''); if (n) { await GB.notes.addTopic(t + '/' + n); refreshAll(); } } },
      { label: 'Delete', icon: 'ic_delete_o.png', onClick: async () => { if (await GB.ui.confirm('Delete topic', 'Delete topic "' + t + '"? Notes stay, only the tag is removed.', 'Delete')) { await GB.notes.deleteTopic(t); refreshAll(); } } }]);
  }
  function refreshAll() { for (const p of L.stack) if (p.refresh) p.refresh(); }
  GB.refreshAll = refreshAll;
  function renderT(body) {
    const n = topicRows(body, '');
    if (!n) body.append(h('div.help-row', { text: 'Topics are #tags. Add them while writing a note (for example #krsna in the heart) or tap the folder+ icon above.' }));
  }
  GB.topicPage = function (t) {
    const pg = GB.page({ kind: 'topic', title: 'Topics', subtitle: t, actions: [GB.hbtn('ic_new_topic.png', 'Add subtopic', async () => { const n = await GB.ui.prompt('New subtopic of ' + t, ''); if (n) { await GB.notes.addTopic(t + '/' + n); fill(); } })] });
    function fill() { pg.body.innerHTML = ''; topicRows(pg.body, t); noteList(pg.body, GB.notes.inTopic(t, false), 'No notes in this topic yet.'); }
    pg.refresh = fill; fill(); L.push(pg);
  };
  // ---------- D: dictionary ----------
  let dictQ = '';
  // links rows: ASCII input matches the ASCII slugs ("k/karpanya", "gb://pro/k/karpanya" or "karpanya"), so diacritics do
  // not matter; other scripts match the word column. Plain ranges, so hosted files use their index (no LIKE scans).
  async function dictLinks(D, qs) {
    const n = lib.has(D, 'links', 'num_items') ? ', num_items AS n' : '', wc = lib.has(D, 'links', 'word') ? 'word' : 'link';
    let col, key;
    if (/^[\x20-\x7e]+$/.test(qs)) {
      const p = GB.foldKey(qs).replace(/[^a-z0-9-]/g, ''); if (!p) return [];
      if (D.linkPre === undefined) { const r = await lib.q(D, 'SELECT link FROM links WHERE link IS NOT NULL AND link <> \'\' LIMIT 1'); const m = String((r[0] && r[0].link) || '').match(/^(gb:\/\/pro\/)?([a-z0-9]\/)?/i); D.linkPre = { scheme: m[1] || '', dir: !!m[2] }; }
      col = 'link'; key = D.linkPre.scheme + (D.linkPre.dir ? p[0] + '/' : '') + p;
    } else { col = wc; key = qs.normalize('NFC'); }
    const rows = await lib.q(D, 'SELECT ' + wc + ' AS w, link' + n + ' FROM links WHERE ' + col + ' >= ? AND ' + col + ' < ? ORDER BY ' + col + ' LIMIT 120', [key, key + '\uffff']);
    return rows.map(r => ({ w: r.w, link: r.link, n: r.n }));
  }
  function renderD(body) {
    const inp = h('input.dict-in', { type: 'search', value: dictQ, placeholder: 'Type a Sanskrit word (Latin letters or Devanagari)', autocomplete: 'off', spellcheck: 'false' });
    const out = h('div.dict-out');
    body.append(h('div.dict-box', null, inp), out);
    const run = GB.debounce(async () => {
      dictQ = inp.value.trim(); out.innerHTML = '';
      if (!dictQ) { out.append(h('div.help-row', { text: 'Type the beginning of a Sanskrit word (for example dharma or धर्म). Words come from the dictionary tables of your gitabases, or from their word-by-word translations.' })); return; }
      const lang = curLang(); const seen = new Set();
      for (const D of lib.dbs.values()) {
        if (lang && D.lang !== lang) continue;
        let words = [];
        if (lib.has(D, 'links', 'link')) { try { words = await dictLinks(D, dictQ); } catch (e) { console.warn('dict', e); } }
        if (!words.length) { try { words = (await GBDB.wbwSuggest(D.num, dictQ, 120)).map(([w, n]) => ({ w, n })); } catch (e) {} }
        for (const x of words) {
          const k = D.lang + '|' + String(x.w).toLowerCase(); if (seen.has(k)) continue; seen.add(k);
          out.append(h('div.wrow', { onclick: () => GB.word.open(D, x.link || '', GB.decEnt(x.w)) }, h('span.wrow-w', { text: GB.ut(GB.decEnt(x.w)) }), x.n ? h('span.wrow-n', { text: String(x.n) }) : null));
        }
      }
      if (!out.children.length) out.append(h('div.help-row', { text: 'No words found.' }));
    }, 220);
    inp.addEventListener('input', run); run();
    setTimeout(() => { if (GB.isWide()) inp.focus(); }, 50);
  }

  // ---------- note editor (subject, text, #topics, question switch) ----------
  GB.noteEdit = function (n, ctx) {
    n = Object.assign({ type: 'note', tags: [] }, n);
    const isNew = !n.id;
    const subj = h('input.ne-subject', { type: 'text', value: n.subject || '', placeholder: 'subject' });
    const txt = h('textarea.ne-text', { placeholder: n.type === 'quest' ? 'your question' : 'your note' }); txt.value = n.text || '';
    const isQ = h('input', { type: 'checkbox' }); isQ.checked = n.type === 'quest';
    const tags = (n.tags || []).slice(); const chips = h('div.ne-chips');
    const tagIn = h('input.ne-tagin', { type: 'text', placeholder: '#topic', list: 'gbTopics' });
    const dl = h('datalist#gbTopics', null, GB.notes.allTopics().map(t => h('option', { value: t })));
    function drawChips() { chips.innerHTML = ''; tags.forEach((t, i) => chips.append(h('span.chip', null, '#' + t, h('button.chip-x', { title: 'Remove', onclick: () => { tags.splice(i, 1); drawChips(); } }, '×')))); }
    function addTag() { const v = tagIn.value.replace(/^#+/, '').trim(); if (v && !tags.some(t => t.toLowerCase() === v.toLowerCase())) tags.push(v); tagIn.value = ''; drawChips(); }
    tagIn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
    tagIn.addEventListener('change', addTag);
    drawChips();
    const showQ = n.type === 'note' || n.type === 'quest';
    const body = h('div.ne', null,
      n.ref ? h('div.ne-ref', null, h('span.nc-chip', { text: n.ref.label + ' »' }), n.quote ? h('div.nc-quote', { text: GB.ut(n.quote) }) : null) : null,
      showQ ? h('label.ne-q', null, isQ, h('span', { text: 'Mark as question' })) : null,
      subj, txt, h('div.ne-tags', null, chips, tagIn, dl));
    const buttons = [];
    if (!isNew) buttons.push({ label: 'Delete', onClick: () => { GB.ui.confirm('Delete', 'Delete this ' + (GB.notes.TYPES[n.type] || 'note').toLowerCase() + '?', 'Delete').then(async ok => { if (ok) { await GB.notes.remove(n.id); d.close(); afterSave(); } }); return false; } });
    if (n.ref) buttons.push({ label: 'Open text', onClick: () => { setTimeout(() => openNote(n), 10); } });
    buttons.push({ label: 'Cancel', value: null }, { label: 'OK', onClick: () => { save(); } });
    const d = GB.ui.dialog({ title: isNew ? (n.type === 'quest' ? 'Add Question' : n.type === 'note' ? 'Add Note' : 'Edit') : 'Edit ' + (GB.notes.TYPES[n.type] || 'note'), body, buttons, cls: 'noteedit' });
    async function save() {
      addTag();
      if (showQ) n.type = isQ.checked ? 'quest' : 'note';
      n.subject = subj.value.trim(); n.text = txt.value.trim(); n.tags = tags;
      await GB.notes.save(n); afterSave();
    }
    function afterSave() { refreshAll(); if (GB.reader && GB.reader.refreshNotes) GB.reader.refreshNotes(); if (ctx && ctx.onSave) ctx.onSave(n); }
    setTimeout(() => (n.ref && !n.text ? txt : subj).focus(), 40);
    return d;
  };
  GB.restoreUI = () => { const i = $('#fileRestore'); i.value = ''; i.click(); };
  GB.doRestore = async file => {
    let obj; try { obj = JSON.parse(await file.text()); } catch (e) { GB.ui.toast('This file is not a notes backup'); return; }
    if (!obj || !Array.isArray(obj.notes)) { GB.ui.toast('This file is not a notes backup'); return; }
    const mode = await GB.ui.dialog({ title: 'Restore notes', text: obj.notes.length + ' notes in ' + file.name + '. Merge them with your notes, or replace your notes with them?', buttons: [{ label: 'Cancel', value: null }, { label: 'Replace', value: 'replace' }, { label: 'Merge', value: 'merge' }] }).result;
    if (!mode) return;
    if (mode === 'replace') {
      const w = await GB.ui.prompt('Type replace to confirm: your current notes will be overwritten', '');
      if (w == null) return; if (String(w).trim().toLowerCase() !== 'replace') { GB.ui.toast('Not replaced: the word did not match'); return; }
    }
    const n = await GB.notes.restore(obj, mode === 'replace'); GB.ui.toast(n + ' notes restored'); refreshAll();
  };
})(window.GB);
