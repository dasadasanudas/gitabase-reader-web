/* Gitabase Reader web: text screen. One text per page (like the APK's WebViewPager) in a 3-slot pager that
   flows across chapters; vertical or horizontal (paged, tap zones) reading; side page buttons; chapter drawer;
   selection actions (+Highlight +Comment +Question +Quote); verse toolbar (favourite, compare, translate, refs, notes). */
'use strict';
(function (GB) {
  const { h, $, img } = GB;
  const lib = GB.lib, L = GB.left;
  const R = GB.reader = {};
  let root, el, head, prog, sbar, pager, slots, pagectl, loadingEl, drawer, scrim, emptyEl, selbar, hint;
  let cur = null, prevPos = null, nextPos = null, needles = null, sIdx = 0, sCount = 0, hz = false, ignore = 0, busy = false;
  const textCache = new Map();
  const N = () => (GB.prefs.night ? '_d' : '_o');
  R.current = () => cur;
  R.build = function () {
    root = $('#reader'); root.innerHTML = '';
    // let horizontal swipes pass through the text (vertical reading) and keep touch gestures for paging (horizontal reading)
    document.head.append(h('style', { text: '.rd-scroll{overscroll-behavior-y:contain;overscroll-behavior-x:auto;touch-action:pan-y pan-x}.rd-pager.hz .rd-scroll{touch-action:none}' }));
    emptyEl = h('div.rd-empty', null, img('splash_icon.png', 'rd-empty-img'), h('div.rd-empty-t', { text: 'Open a text from your library' }));
    head = h('header.hdr.rd-head');
    prog = h('div.rd-prog', null, h('i.p1'), h('i.p2'));
    sbar = h('div.rd-search', { hidden: true }, h('span.rs-q'), h('span.rs-n'),
      h('button.rs-b', { title: 'Previous', onclick: () => searchStep(-1) }, h('img.rs-up')), h('button.rs-b', { title: 'Next', onclick: () => searchStep(1) }, h('img.rs-dn')), h('button.rs-b', { title: 'Close', onclick: clearSearch }, h('img.rs-x')));
    pager = h('div.rd-pager'); slots = [0, 1, 2].map(() => h('div.rd-slot', null, h('div.rd-scroll')));
    pager.append(...slots);
    pagectl = h('div.rd-pagectl', null, h('button.pg-up', { title: 'Page up', onclick: () => pageStep(-1) }, h('img')), h('button.pg-x', { title: 'Hide page buttons', onclick: crossBtn }, h('img')), h('button.pg-dn', { title: 'Page down', onclick: () => pageStep(1) }, h('img')));
    const eL = h('button.rd-edge.l', { title: 'Previous text (←)', onclick: () => go(-1) }, img('ic_go_left.png')), eR = h('button.rd-edge.r', { title: 'Next text (→)', onclick: () => go(1) }, img('ic_go_right.png'));
    loadingEl = h('div.rd-loading', { hidden: true }, h('div.spinner'));
    scrim = h('div.rd-scrim', { hidden: true, onclick: closeDrawer }); drawer = h('div.rd-drawer');
    el = h('div.rd', { hidden: true }, head, prog, sbar, h('div.rd-stage', null, pager, pagectl, eL, eR, loadingEl), scrim, drawer);
    root.append(emptyEl, el);
    let t = null;
    pager.addEventListener('scroll', () => { if (ignore) return; clearTimeout(t); t = setTimeout(settle, 160); }, { passive: true });
    pager.addEventListener('click', onClick);
    pager.addEventListener('pointerdown', swipeStart); pager.addEventListener('pointerup', swipeEnd);
    document.addEventListener('selectionchange', GB.debounce(onSel, 200));
    setInterval(() => { if (cur && !el.hidden && document.visibilityState === 'visible' && (GB.isWide() || document.body.classList.contains('reading'))) GB.reading.addTime(cur.B, 15000); }, 15000);
    window.addEventListener('resize', GB.debounce(() => { if (cur) { center(); if (hz) hzLayout(); } }, 120));
    icons();
  };
  function icons() {
    const n = N();
    pagectl.querySelector('.pg-up img').src = 'img/ui/ic_page_up' + n + '.png'; pagectl.querySelector('.pg-x img').src = 'img/ui/ic_page_close' + n + '.png'; pagectl.querySelector('.pg-dn img').src = 'img/ui/ic_page_dn' + n + '.png';
    const d = GB.prefs.night ? '_d' : '';
    sbar.querySelector('.rs-up').src = 'img/ui/ic_srch_arrow_up' + d + '.png'; sbar.querySelector('.rs-dn').src = 'img/ui/ic_srch_arrow_down' + d + '.png'; sbar.querySelector('.rs-x').src = 'img/ui/ic_srch_arrow_cross' + d + '.png';
  }
  function show() { emptyEl.hidden = true; el.hidden = false; document.body.classList.add('reading'); pagectl.hidden = !GB.prefs.pageButtons; GB.screen.enter(); }
  R.close = function () { document.body.classList.remove('reading'); closeDrawer(); clearSel(); GB.screen.leave(); if (!GB.isWide()) { /* keep state for reopening */ } };
  const loading = on => { loadingEl.hidden = !on; };
  // ---------- open ----------
  function askMode(only) {
    return new Promise(res => {
      let settled = false;
      const sw = h('input.switch', { type: 'checkbox' });
      const opt = (m, label) => h('div.mode-opt', { onclick: () => { settled = true; d.close(m); res({ mode: m, fromStart: sw.checked }); } }, h('span.mode-ic', { html: GB.icons.svg(m) }), h('span', { text: label }));
      const body = h('div.modes', null, only !== 'horizontal' ? opt('vertical', 'Vertical scrolling') : null, only !== 'vertical' ? opt('horizontal', 'Horizontal scrolling') : null, h('div.mode-div'),
        h('label.mode-start', null, h('span', { text: 'Read book from start' }), sw),
        h('div.mode-hint', { text: 'Starting from the first page lets the book count as fully read when you finish, and appear in your Finished list as an achievement.' }));
      const d = GB.ui.dialog({ title: 'How would you like to read this book?', body, buttons: [{ label: 'CANCEL', value: null }], onClose: () => { if (!settled) res(null); } });
    });
  }
  R.open = async function (B, ch, i, opts) {
    opts = opts || {}; if (!B || !ch) return;
    let extra = null;
    const fixed = GB.prefs.fixedDirection !== false;
    if (!GB.reading.get(B) && !opts.noAsk) {
      const c = await askMode(fixed ? (isVerseBook(B) ? 'vertical' : 'horizontal') : null); if (!c) return;
      extra = { mode: c.mode, fromStart: c.fromStart };
      if (c.fromStart) { ch = B.chapters[0]; i = 0; }
    }
    needles = opts.needles || null; sIdx = 0; if (!needles) sbar.hidden = true;
    show(); loading(true); closeDrawer(); hideSelbar();
    try {
      const rows = await lib.chapterTexts(B, ch);
      if (!rows.length) { loading(false); GB.ui.toast('This chapter has no texts'); return; }
      i = Math.max(0, Math.min(i || 0, rows.length - 1));
      cur = { B, ch, i, row: rows[i], rows };
      const rd = GB.reading.get(B);
      hz = fixed ? !isVerseBook(B) : ((extra && extra.mode) || (rd && rd.mode) || GB.prefs.defaultLayout) === 'horizontal';
      await renderAll(opts);
      await GB.reading.touch(B, ch, i, rows[i], rows.length, extra);
      GB.history.add(B, ch, rows[i]); setHash(); GB.chapter.markCurrent(); syncHome();
      if (hz) maybeHint();
    } catch (e) { console.error(e); loading(false); GB.ui.toast(GB.errMsg(e, 'Could not open text'), 4000); }
    loading(false);
  };
  const isVerseBook = B => !!(B.hasSongs || B.hasSanskrit || ['BG', 'SB', 'CC'].includes(B.abbr));
  R.openSaved = async function (B, e) {
    if (!B) return; const ch = lib.findChapter(B, e.song, e.ch) || B.chapters[0]; if (!ch) return;
    const rows = await lib.chapterTexts(B, ch); const i = Math.max(0, lib.findTextIndex(rows, e.no));
    R.open(B, ch, i, { noAsk: true, scroll: e.scroll });
  };
  function syncHome() { if (GB.left.stack.length <= 1 && GB.home.tab === 'L' && GB.home.sub === 'reading') GB.home.render(); }
  R.rerender = async function () { icons(); if (!cur) return; const s = scrollOf(slots[1]); const top = s.scrollTop; await renderAll({}); scrollOf(slots[1]).scrollTop = top; };
  R.refreshNotes = () => R.rerender();
  const scrollOf = slot => slot.firstChild;
  async function getText(D, id) {
    const k = D.id + '|' + id; if (textCache.has(k)) return textCache.get(k);
    const t = await lib.text(D, id); textCache.set(k, t); if (textCache.size > 40) textCache.delete(textCache.keys().next().value); return t;
  }
  function sameWork(B) { return lib.books.filter(x => x !== B && ((B.compare && x.compare === B.compare) || (B.abbr && x.abbr === B.abbr))); }
  R.sameWork = sameWork;
  async function fillSlot(slot, pos, isCur, opts) {
    const sc = scrollOf(slot); sc.scrollTop = 0; sc.scrollLeft = 0;
    if (!pos) { sc.innerHTML = ''; slot.dataset.empty = '1'; return; }
    slot.dataset.empty = '';
    const B = cur.B, D = pos.ch.part.D;
    const t = await getText(D, pos.row.id);
    if (!t) { sc.innerHTML = '<div class="verse"><p>Text not found.</p></div>'; return; }
    const notes = GB.notes.forText(B, pos.ch, pos.row);
    const sw = sameWork(B);
    const v = GB.render.verse(t, { B, ch: pos.ch, row: pos.row, wbwHidden: R.wbwHidden, notes, needles: isCur ? needles : null, refs: 0,
      fav: notes.some(n => n.type === 'fav'), noteCount: notes.filter(n => n.type === 'note' || n.type === 'quest').length,
      compare: sw.length > 0, translate: sw.some(x => x.lang !== B.lang) });
    sc.innerHTML = ''; sc.append(v);
    if (isCur) {
      lib.refs(B, pos.ch, pos.row).then(list => { if (!list.length || cur.row !== pos.row) return; const tb = v.querySelector('#toolbar'); const notesIc = tb.querySelector('[data-act="notes"]');
        tb.insertBefore(h('span.tb_refs_wrap', null, h('img.tb_img', { src: 'img/tb/ic_refs' + N() + '.png', 'data-act': 'refs', title: 'References', draggable: 'false' }), h('span.nrefs', { text: String(list.length) })), notesIc); }).catch(() => {});
      if (needles) { sCount = v.querySelectorAll('.srch_res').length; showSearchBar(); }
      if (opts && opts.noteId) { const sp = v.querySelector('[data-note="' + opts.noteId + '"]'); if (sp) setTimeout(() => sp.scrollIntoView({ block: 'center' }), 60); }
      else if (opts && opts.scroll) setTimeout(() => { sc.scrollTop = opts.scroll * (sc.scrollHeight - sc.clientHeight); }, 30);
      sc.onscroll = GB.debounce(() => { if (cur && cur.row === pos.row && !hz) { GB.reading.set(B, { scroll: sc.scrollHeight > sc.clientHeight ? sc.scrollTop / (sc.scrollHeight - sc.clientHeight) : 0 }); pageNum(); } }, 400);
    }
  }
  async function renderAll(opts) {
    setHead(); pager.classList.toggle('hz', hz); el.classList.toggle('hzmode', hz);
    const [p, n] = await Promise.all([lib.neighbour(cur.B, cur.ch, cur.i, -1), lib.neighbour(cur.B, cur.ch, cur.i, 1)]);
    prevPos = p; nextPos = n;
    await fillSlot(slots[1], { ch: cur.ch, i: cur.i, row: cur.row }, true, opts);
    center(); progress();
    fillSlot(slots[0], prevPos); fillSlot(slots[2], nextPos);
    if (hz) hzLayout();
  }
  function center() { ignore++; pager.scrollLeft = slots[1].offsetLeft; requestAnimationFrame(() => requestAnimationFrame(() => { ignore--; })); }
  function settle() {
    const w = pager.clientWidth || 1; const idx = Math.round(pager.scrollLeft / w);
    if (idx <= 0) { if (prevPos) shift(-1); else center(); }
    else if (idx >= 2) { if (nextPos) shift(1); else center(); }
  }
  async function shift(dir) {
    if (busy) return; busy = true; hideSelbar();
    try {
      const old = { ch: cur.ch, i: cur.i, row: cur.row }; const target = dir > 0 ? nextPos : prevPos;
      if (dir > 0) { const s = slots.shift(); slots.push(s); pager.append(s); } else { const s = slots.pop(); slots.unshift(s); pager.prepend(s); }
      center();
      const rows = await lib.chapterTexts(cur.B, target.ch);
      cur = { B: cur.B, ch: target.ch, i: target.i, row: target.row, rows };
      // re-render the new current slot so search highlight / refs badge / scroll handler belong to it
      await fillSlot(slots[1], target, true, { scroll: hz ? 0 : (dir < 0 ? 0 : 0) });
      if (hz) { hzLayout(); if (dir < 0) hzGoLast(); }
      setHead(); progress();
      const nb = await lib.neighbour(cur.B, cur.ch, cur.i, dir);
      if (dir > 0) { prevPos = old; nextPos = nb; fillSlot(slots[2], nb); fillSlot(slots[0], old); }
      else { nextPos = old; prevPos = nb; fillSlot(slots[0], nb); fillSlot(slots[2], old); }
      GB.reading.touch(cur.B, cur.ch, cur.i, cur.row, rows.length); GB.history.add(cur.B, cur.ch, cur.row); setHash(); GB.chapter.markCurrent();
      const cp = L.top(); if (cp && cp.kind === 'chapter' && cp.ch !== cur.ch && GB.isWide()) GB.chapter.open(cur.B, cur.ch, cur.i);
    } finally { busy = false; }
  }
  function go(dir) {
    if (!cur || busy) return; const target = dir > 0 ? nextPos : prevPos; if (!target) return;
    if (hz) { shift(dir); return; }
    pager.scrollTo({ left: slots[1 + dir].offsetLeft, behavior: 'smooth' });
  }
  R.go = go;
  // ---------- title bar, progress ----------
  function refText() { const { B, ch, row } = cur; if (Number(ch.ch) === 0) { const pv = GB.ut(row.preview || '').slice(0, 60); return pv && pv !== ch.title ? (ch.title || '') + ' · ' + pv : (ch.title || pv); } return lib.label(B, ch.song, ch.ch, row.no).split(' ').pop() + ' ' + (ch.title || ''); }
  function setHead() {
    head.innerHTML = ''; const { B } = cur;
    head.append(h('button.hdr-logo', { title: 'Contents', onclick: openDrawer }, img('headermenuicon.png')),
      h('div.t2.rd-titles', { title: 'Show/Hide Sanskrit', onclick: () => { GB.setPref('showSanskrit', !GB.prefs.showSanskrit); R.rerender(); } },
        h('div.t2a', null, h('span.tri', { text: '▾' }), GB.ut(B.title)), h('div.t2b', { text: GB.ut(refText()) })));
    const right = h('div.hdr-right');
    if (!GB.isWide()) right.append(GB.hbtn('back', 'Back', () => GB.back(), 'rd-back'));
    right.append(GB.prefs.topRightIcon === 'bookmark' ? GB.hbtn('ic_bookmark.png', 'Create Bookmark', bookmark) : GB.hbtn('ic_screen_manager.png', 'Browsing History', () => GB.historyPage()));
    right.append(h('div.more-wrap', null, GB.hbtn('ic_more_actions.png', 'Menu', e => textMenu(e.currentTarget)), h('span.pagenum')));
    head.append(right); pageNum();
  }
  function progress() {
    const { B, ch, i, rows } = cur; const p = GB.reading.progressOf(B, ch, i, rows.length);
    prog.querySelector('.p1').style.width = (p * 100).toFixed(1) + '%';
    const p2 = prog.querySelector('.p2'); p2.hidden = !GB.prefs.doubleProgress; p2.style.width = ((i + 1) / rows.length * 100).toFixed(1) + '%';
    prog.classList.toggle('double', !!GB.prefs.doubleProgress);
  }
  function pageNum() {
    const pn = head.querySelector('.pagenum'); if (!pn || !GB.prefs.showPageNumbers || !cur) { if (pn) pn.textContent = ''; return; }
    const sc = scrollOf(slots[1]);
    if (hz) { const w = sc.clientWidth || 1; pn.textContent = (Math.round(sc.scrollLeft / w) + 1) + '/' + Math.max(1, Math.round(sc.scrollWidth / w)); }
    else { const hgt = sc.clientHeight || 1; pn.textContent = (Math.floor(sc.scrollTop / hgt) + 1) + '/' + Math.max(1, Math.ceil(sc.scrollHeight / hgt)); }
  }
  async function bookmark() { await GB.reading.touch(cur.B, cur.ch, cur.i, cur.row, cur.rows.length); GB.ui.toast('Bookmark set at ' + lib.label(cur.B, cur.ch.song, cur.ch.ch, cur.row.no)); }
  function textMenu(anchor) {
    const P = GB.prefs;
    GB.ui.menu(anchor, [
      { label: 'Create Bookmark', icon: 'ic_bookmark.png', onClick: bookmark },
      { label: 'Search', icon: 'cab_search.png', onClick: () => GB.search.dialog({ book: cur.B }) },
      { label: P.pageButtons ? 'Disable page by page reading' : 'Paginated reading mode', icon: 'ic_paged_scroll.png', onClick: () => { GB.setPref('pageButtons', !P.pageButtons); pagectl.hidden = !GB.prefs.pageButtons; } },
      { label: hz ? 'Vertical reading' : 'Horizontal reading', icon: hz ? 'vertical' : 'horizontal', onClick: toggleHz },
      { label: P.night ? 'Light Theme' : 'Night Mode', icon: P.night ? 'ic_sun.png' : 'ic_menu_night.png', onClick: GB.toggleNight },
      { label: 'Bookmarking', icon: 'ic_reading.png', sub: [{ label: 'Add to Reading List', icon: 'ic_reading.png', onClick: async () => { await bookmark(); } }] },
      { label: 'Notes', icon: 'ic_menu_comment.png', sub: [{ label: 'Add to favorites', icon: 'cab_fav.png', onClick: toggleFav }, { label: 'Add question/note', icon: 'ic_menu_comment.png', onClick: () => GB.noteEdit({ type: 'note', ref: GB.notes.ref(cur.B, cur.ch, cur.row) }) }, { label: 'Show all notes', icon: 'ic_menu_list.png', onClick: () => GB.bookNotes(cur.B) }] },
      { label: 'Research', icon: 'ic_menu_compare.png', sub: [{ label: 'Translate', icon: 'ic_menu_translate.png', onClick: () => GB.compare.selector(cur, 'translate') }, { label: 'Compare', icon: 'ic_menu_compare.png', onClick: () => GB.compare.selector(cur, 'compare') }, { label: 'Open in new window', icon: 'ic_chapter_link.png', onClick: () => window.open(deepLink(), '_blank') }] },
      { label: 'Text', icon: 'ic_copy.png', sub: [{ label: speaking() ? 'Stop reading aloud' : 'Read it Aloud', icon: 'ic_read_aloud.png', onClick: readAloud }, { label: 'Copy Text', icon: 'ic_copy.png', onClick: copyText }, { label: 'Copy link', icon: 'ic_url.png', onClick: async () => { await GB.copyText(deepLink()); GB.ui.toast('Link copied'); } }] },
      { label: 'Font', icon: 'font', sub: [{ label: 'Diakritics/Simple', icon: 'font', onClick: () => { GB.setPref('diacritics', !P.diacritics); GB.applyPrefs(); } }, { label: 'Increase font', icon: 'ic_action_inct.png', onClick: () => GB.fontStep(1) }, { label: 'Decrease font', icon: 'ic_menu_dec_font.png', onClick: () => GB.fontStep(-1) }] },
      { label: 'Library', icon: 'ic_menu_books.png', onClick: () => { L.home('L'); R.close(); } },
      { label: 'Settings', icon: 'ic_mmenu_settings.png', onClick: () => GB.settingsPage() }]);
  }
  async function toggleHz() {
    hz = !hz; await GB.reading.set(cur.B, { mode: hz ? 'horizontal' : 'vertical' }); GB.reading.map.get(cur.B.key) || (await GB.reading.touch(cur.B, cur.ch, cur.i, cur.row, cur.rows.length, { mode: hz ? 'horizontal' : 'vertical' }));
    await R.rerender(); if (hz) maybeHint();
  }
  const speaking = () => window.speechSynthesis && speechSynthesis.speaking;
  function readAloud() {
    if (!window.speechSynthesis) { GB.ui.toast('Reading aloud is not available in this browser'); return; }
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const v = scrollOf(slots[1]).querySelector('.verse'); const txt = ['#verseTransl2', '#versePurport'].map(s => { const e = v.querySelector(s); return e ? e.innerText : ''; }).join('\n\n');
    const u = new SpeechSynthesisUtterance(txt); u.lang = cur.B.lang === 'hin' ? 'hi-IN' : cur.B.lang === 'rus' ? 'ru-RU' : 'en-US'; speechSynthesis.speak(u);
  }
  async function copyText() {
    const v = scrollOf(slots[1]).querySelector('.verse'); const part = s => { const e = v.querySelector(s); return e && !e.hidden ? e.innerText.trim() : ''; };
    const t = [lib.label(cur.B, cur.ch.song, cur.ch.ch, cur.row.no), part('#verseSanskrit'), part('#verseTranslit'), part('#verseTransl2'), part('#versePurport')].filter(Boolean).join('\n\n');
    await GB.copyText(t); GB.ui.toast('Text copied');
  }
  function deepLink() { const { B, ch, row } = cur; return location.href.split('#')[0] + '#/' + encodeURIComponent(B.lang) + '/' + encodeURIComponent(B.abbr || B.title) + '/' + (B.hasSongs ? ch.song + '/' : '') + ch.ch + '/' + encodeURIComponent(row.no); }
  function setHash() { try { history.replaceState(history.state, '', deepLink()); } catch (e) {} }
  R.deepLink = () => cur ? deepLink() : '';
  // ---------- drawer (chapters) ----------
  function openDrawer() {
    const { B } = cur; drawer.innerHTML = '';
    drawer.append(h('div.dr-head', null, img(GB.prefs.night ? 'book_cover_d.png' : 'book_cover_o.png', 'dr-cover'), h('div.dr-meta', null, h('div.dr-author', { text: GB.ut(B.author) }), h('div.dr-title', { text: GB.ut(B.title) }))),
      h('div.dr-row.dr-lib', { onclick: () => { closeDrawer(); L.home('L'); R.close(); } }, h('span.dr-num', { html: GB.icons.svg('lib') }), h('span.dr-t', { text: 'Library' })));
    let lastSong = null;
    for (const ch of B.chapters) {
      if (B.hasSongs && ch.song !== lastSong) { lastSong = ch.song; const s = B.songs.find(x => x.song === ch.song); drawer.append(h('div.dr-song', { text: GB.ut((s && s.name) || ('Canto ' + ch.song)) })); }
      const on = ch === cur.ch;
      drawer.append(h('div.dr-row' + (on ? '.on' : ''), { onclick: () => { closeDrawer(); R.open(B, ch, 0, { noAsk: true }); if (GB.isWide()) GB.chapter.open(B, ch, 0); } }, h('span.dr-num', { text: String(ch.ch) }), h('span.dr-t', { text: GB.ut(ch.title) })));
    }
    drawer.classList.add('on'); scrim.hidden = false; GB.ui.pushEsc(closeDrawer);
    const on = drawer.querySelector('.dr-row.on'); if (on) on.scrollIntoView({ block: 'center' });
  }
  function closeDrawer() { if (!drawer || !drawer.classList.contains('on')) return; drawer.classList.remove('on'); scrim.hidden = true; GB.ui.popEsc(closeDrawer); }
  // ---------- page buttons / horizontal paging ----------
  function pageStep(dir) {
    if (!cur) return; const sc = scrollOf(slots[1]);
    if (hz) { const w = sc.clientWidth; const max = sc.scrollWidth - w; const x = Math.round(sc.scrollLeft / w) * w;
      if (dir > 0 && x >= max - 4) { go(1); return; } if (dir < 0 && x <= 4) { go(-1); return; }
      sc.scrollTo({ left: x + dir * w, behavior: 'smooth' }); setTimeout(pageNum, 350); return; }
    const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 3, atTop = sc.scrollTop <= 2;
    if ((dir > 0 && atEnd) || (dir < 0 && atTop)) { if (GB.prefs.pageButtonsCrossChapters) go(dir); return; }
    sc.scrollBy({ top: dir * sc.clientHeight * 0.9, behavior: 'smooth' });
  }
  R.pageStep = pageStep;
  function crossBtn() {
    if (GB.prefs.crossButton === 'close') { GB.back(); return; }
    GB.setPref('pageButtons', false); pagectl.hidden = true; GB.ui.toast('Page buttons hidden. Menu › Paginated reading mode shows them again');
  }
  function hzLayout() { const sc = scrollOf(slots[1]); const v = sc.querySelector('.verse'); if (!v) return; v.style.setProperty('--pw', sc.clientWidth + 'px'); pageNum(); }
  function hzGoLast() { const sc = scrollOf(slots[1]); requestAnimationFrame(() => { sc.scrollLeft = sc.scrollWidth; pageNum(); }); }
  async function maybeHint() {
    if (await GB.store.kvGet('hzHint', false)) return;
    if (hint) hint.remove();
    hint = h('div.hz-hint', { onclick: () => { hint.remove(); hint = null; GB.store.kvSet('hzHint', true); } },
      h('div.hz-z', { text: 'Tap to swipe left' }), h('div.hz-z.c', { text: 'Tap to show or hide the title bar' }), h('div.hz-z', { text: 'Tap to swipe right' }), h('img.hz-x', { src: 'img/ui/ic_horizontal_hint_close.svg' }));
    el.querySelector('.rd-stage').append(hint);
  }
  let sx = null, sy = null;
  // paged reading: swipe turns the page. Vertical reading: touch swipes are native (scroll snap); with a mouse, drag on the empty side margins
  let sTarget = null;
  let sLeft = 0;
  function swipeStart(e) { sTarget = e.target; sx = e.clientX; sy = e.clientY; sLeft = pager.scrollLeft; }
  function swipeEnd(e) {
    if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    const flick = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5;
    if (hz) { if (flick && getSelection().isCollapsed) { swipedAt = Date.now(); pageStep(dx < 0 ? 1 : -1); } return; }
    if (!flick || Math.abs(pager.scrollLeft - sLeft) > 8) return;            // the browser already scrolled the pager: nothing to add
    const margin = sTarget && sTarget.classList && (sTarget.classList.contains('rd-scroll') || sTarget.classList.contains('rd-slot'));
    if (e.pointerType !== 'mouse' || (margin && Math.abs(dx) > 100)) go(dx < 0 ? 1 : -1);
  }
  let swipedAt = 0;
  function hzTap(e) {
    if (Date.now() - swipedAt < 400 || !getSelection().isCollapsed) return;
    const r = pager.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width;
    if (x < 0.3) pageStep(-1); else if (x > 0.7) pageStep(1); else el.classList.toggle('nohead');
  }
  // ---------- clicks inside the verse ----------
  function onClick(e) {
    const act = e.target.closest('[data-act]'); if (act) { e.preventDefault(); doAct(act.dataset.act, act); return; }
    const hl = e.target.closest('[data-note]'); if (hl && getSelection().isCollapsed) { noteMenu(hl.dataset.note, e); return; }
    const a = e.target.closest('a[href]'); if (a) { e.preventDefault(); linkClick(a); return; }
    if (hz) hzTap(e);
  }
  async function toggleFav() {
    const ex = GB.notes.forText(cur.B, cur.ch, cur.row).find(n => n.type === 'fav');
    if (ex) { await GB.notes.remove(ex.id); GB.ui.toast('Removed from favourite texts'); }
    else { const v = scrollOf(slots[1]).querySelector('#verseTransl2'); await GB.notes.save({ type: 'fav', ref: GB.notes.ref(cur.B, cur.ch, cur.row), quote: v ? v.textContent.trim() : (cur.row.preview || ''), tags: [] }); GB.ui.toast('Added to favourite texts'); }
    R.rerender(); GB.refreshAll();
  }
  function doAct(act, node) {
    if (act === 'fav') return toggleFav();
    if (act === 'compare') return GB.compare.selector(cur, 'compare');
    if (act === 'translate') return GB.compare.selector(cur, 'translate');
    if (act === 'refs') return GB.refsSheet(cur);
    if (act === 'notes') return notesSheet();
    if (act === 'wbw') { R.wbwHidden = !R.wbwHidden; GB.store.kvSet('wbwHidden', R.wbwHidden); const v = node.closest('.verse'); const w = v.querySelector('#verseTranslWBW'); if (w) w.hidden = R.wbwHidden; node.src = 'img/tb/ic_' + (R.wbwHidden ? 'show' : 'hide') + '_wbw' + (GB.prefs.night ? '_d' : '') + '.png'; }
  }
  function notesSheet() {
    const list = GB.notes.forText(cur.B, cur.ch, cur.row); const box = h('div');
    if (!list.length) box.append(h('div.help-row', { text: 'No notes on this text yet. Select words in the text to highlight, comment or ask a question.' }));
    list.forEach(n => box.append(GB.noteCard(n)));
    box.append(h('div.sheet-actions', null, h('button.btn', { onclick: () => { s.close(); GB.noteEdit({ type: 'note', ref: GB.notes.ref(cur.B, cur.ch, cur.row) }); } }, GB.ico('comment'), h('span', { text: 'Add question/note' }))));
    const s = GB.ui.sheet({ title: 'Notes · ' + lib.label(cur.B, cur.ch.song, cur.ch.ch, cur.row.no), content: box });
  }
  function noteMenu(id, e) {
    const n = GB.notes.list.find(x => x.id === id); if (!n) return;
    GB.ui.menu(null, [{ header: true, label: GB.notes.TYPES[n.type] + (n.text ? ': ' + n.text.slice(0, 40) : '') },
      { label: n.type === 'highl' || n.type === 'quote' ? 'Add comment / topics' : 'Edit', icon: 'edit', onClick: () => GB.noteEdit(n) },
      { label: 'Remove', icon: 'trash', onClick: async () => { await GB.notes.remove(n.id); R.rerender(); GB.refreshAll(); } }], { at: { x: e.clientX, y: e.clientY + 8 } });
  }
  async function linkClick(a) {
    const href = a.getAttribute('href') || '', label = a.textContent.trim();
    const L = lib.parseLink(href, label, { song: cur.ch.song, ch: cur.ch.ch });
    if (L.kind === 'word') return GB.word.open(cur.ch.part.D, href, label);
    if (L.kind === 'text') {
      const r = L.abbr ? await lib.resolve(L.abbr, L.nums, cur.B.lang, L.lang) : await lib.resolveIn(cur.B, L.nums);
      if (r) return R.open(r.B, r.ch, r.i, { noAsk: true });
      GB.ui.toast(lib.linkName(L, cur.B) + ' is not in your library'); return;
    }
    if (L.kind === 'dead') { GB.ui.toast('This link has no target in the file'); return; }
    linkFallback(href);
  }
  function linkFallback(href) {
    const items = [{ header: true, label: href.length > 60 ? href.slice(0, 57) + '…' : href }, { label: 'Copy link', icon: 'copy', onClick: async () => { await GB.copyText(href); GB.ui.toast('Link copied'); } }];
    if (/^https?:/i.test(href)) items.push({ label: 'Open in browser', icon: 'open', onClick: () => window.open(href, '_blank', 'noopener') });
    if (navigator.share) items.push({ label: 'Share', icon: 'share', onClick: () => navigator.share({ url: href }).catch(() => {}) });
    GB.ui.menu(null, items, { at: { x: innerWidth / 2 - 130, y: innerHeight / 3 } });
  }
  // ---------- in-text search bar ----------
  function showSearchBar() {
    sbar.hidden = false; sbar.querySelector('.rs-q').textContent = needles.join(' '); sbar.querySelector('.rs-n').textContent = sCount ? (sIdx + 1) + '/' + sCount : '0';
    if (sCount) mark(0, true);
  }
  function mark(k, first) {
    const v = scrollOf(slots[1]); v.querySelectorAll('.srch_res_HL').forEach(x => x.classList.remove('srch_res_HL'));
    const t = v.querySelector('#srch_' + (k + 1)); if (!t) return; t.classList.add('srch_res_HL'); t.scrollIntoView({ block: first ? 'center' : 'nearest', behavior: first ? 'auto' : 'smooth' });
    sbar.querySelector('.rs-n').textContent = (k + 1) + '/' + sCount;
  }
  function searchStep(d) { if (!sCount) return; sIdx = (sIdx + d + sCount) % sCount; mark(sIdx); }
  function clearSearch() { needles = null; sbar.hidden = true; R.rerender(); }
  // ---------- selection actions ----------
  const BLOCK_SEL = '#verseSanskrit,#verseTranslit,#verseTranslWBW,#verseTransl2,#versePurport';
  function onSel() {
    const s = getSelection(); if (!s.rangeCount || s.isCollapsed || !cur) return hideSelbar();
    const r = s.getRangeAt(0); const node = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    if (!slots[1].contains(node) && !(node.closest && node.closest('.cmp-pane'))) return hideSelbar();
    if (!s.toString().trim()) return hideSelbar();
    // keep what was selected: on phones a tap on the action bar can collapse the selection before the click lands
    selCache = { a: selAnchor(), t: s.toString().trim() };
    showSelbar(r);
  }
  let selCache = null;
  const touchUI = () => matchMedia('(pointer: coarse)').matches || !GB.isWide();
  function clearSel() { try { getSelection().removeAllRanges(); } catch (e) {} selCache = null; hideSelbar(); }
  function selAnchor() {
    const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0);
    const sn = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const block = sn.closest(BLOCK_SEL) || (r.endContainer.parentNode && r.endContainer.parentNode.closest && r.endContainer.parentNode.closest(BLOCK_SEL)); if (!block) return null;
    let start = GB.render.offsetIn(block, r.startContainer, r.startOffset); if (start < 0 || !block.contains(r.startContainer)) start = 0;
    let end = block.contains(r.endContainer) ? GB.render.offsetIn(block, r.endContainer, r.endOffset) : block.textContent.length;
    const text = block.textContent; while (start < end && /\s/.test(text[start])) start++; while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return null;
    return { block: block.id, start, end, quote: text.slice(start, end) };
  }
  function showSelbar(range) {
    if (!selbar) {
      // desktop: a floating bar over the selection. Touch screens: the APK's contextual action bar across the top.
      const b = (label, fn, icon, cls) => h('button.sb-b' + (cls || ''), { onmousedown: e => e.preventDefault(), onclick: fn, title: label },
        icon ? (/\.png$/.test(icon) ? img(icon) : GB.ico(icon)) : null, h('span', { text: label }));
      selbar = h('div.selbar', { role: 'toolbar', 'aria-label': 'Selected text' },
        b('Done', clearSel, 'check', '.sb-done'),
        b('Copy', selCopy, 'copy', '.sb-copy'), b('+Highlight', () => addSel('highl'), 'cab_highl.png'), b('+Comment', () => addSel('note'), 'cab_comment.png'),
        b('+Question', () => addSel('quest'), 'qmark.png'), b('+Quote', () => addSel('quote'), 'ic_copy_quote.png'),
        h('button.sb-b.sb-more', { title: 'More', onmousedown: e => e.preventDefault(), onclick: e => selMore(e.currentTarget) }, GB.ico('more'), h('span.sb-ml', { text: 'More' })));
      $('#overlays').append(selbar);
    }
    const cab = touchUI();
    selbar.classList.toggle('cab', cab);
    if (selbar.hidden !== false) { selbar.hidden = false; GB.ui.pushEsc(clearSel); }
    if (cab) { selbar.style.left = selbar.style.top = ''; return; }
    const rc = range.getBoundingClientRect(); const bw = selbar.offsetWidth || 420, bh = selbar.offsetHeight || 44;
    let x = Math.max(6, Math.min(innerWidth - bw - 6, rc.left + rc.width / 2 - bw / 2)); let y = rc.top - bh - 10; if (y < 60) y = rc.bottom + 10;
    selbar.style.left = x + 'px'; selbar.style.top = Math.min(innerHeight - bh - 6, y) + 'px';
  }
  function hideSelbar() { if (selbar && !selbar.hidden) { selbar.hidden = true; GB.ui.popEsc(clearSel); } }
  async function addSel(type) {
    const a = selAnchor() || (selCache && selCache.a); if (!a) return; clearSel();
    const n = { type, ref: GB.notes.ref(cur.B, cur.ch, cur.row), anchor: { block: a.block, start: a.start, end: a.end }, quote: a.quote, tags: [] };
    if (type === 'note' || type === 'quest') { GB.noteEdit(n); return; }
    await GB.notes.save(n); R.rerender(); GB.refreshAll(); GB.ui.toast(type === 'quote' ? 'Added to favourite quotes' : 'Highlighted');
  }
  const selText = () => getSelection().toString().trim() || (selCache && selCache.t) || '';
  async function selCopy() { const t = selText(); clearSel(); await GB.copyText(t); GB.ui.toast('Copied'); }
  function selMore(anchor) {
    const t = selText(); const ref = lib.label(cur.B, cur.ch.song, cur.ch.ch, cur.row.no);
    GB.ui.menu(anchor, [
      { label: 'Copy with Ref', icon: 'copy', onClick: async () => { await GB.copyText('"' + t + '" (' + ref + ')'); GB.ui.toast('Copied'); } },
      { label: 'Copy with Link', icon: 'link', onClick: async () => { await GB.copyText('"' + t + '" (' + ref + ')\n' + deepLink()); GB.ui.toast('Copied'); } },
      { label: 'Search in this book', icon: 'search', onClick: () => GB.search.run({ q: t, book: cur.B }) },
      { label: 'Search in Gitabase', icon: 'search', onClick: () => GB.search.run({ q: t }) },
      { label: 'Select All', icon: 'list', onClick: () => { const v = scrollOf(slots[1]).querySelector('.verse'); const r = document.createRange(); r.selectNodeContents(v); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } },
      navigator.share ? { label: 'Share selected', icon: 'share', onClick: () => navigator.share({ text: '"' + t + '" (' + ref + ')' }).catch(() => {}) } : null].filter(Boolean));
  }
  // ---------- phones: full screen while reading (pr_hide_android_status_bar) and keep the screen on ----------
  GB.screen = (function () {
    let lock = null, want = false;
    async function wake() {
      if (!want || !GB.prefs.keepAwake || !navigator.wakeLock || document.visibilityState !== 'visible' || lock) return;
      try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch (e) { lock = null; }
    }
    function sleep() { if (lock) { lock.release().catch(() => {}); lock = null; } }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    return {
      enter() {
        want = true; wake();
        if (GB.prefs.hideStatusBar && !GB.isWide() && document.fullscreenEnabled && !document.fullscreenElement)
          document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      },
      leave() { want = false; sleep(); if (document.fullscreenElement && GB.prefs.hideStatusBar) document.exitFullscreen().catch(() => {}); },
      pref() { if (!want) return; if (GB.prefs.keepAwake) wake(); else sleep(); }
    };
  })();
  // keyboard
  R.key = function (e) {
    if (!cur || el.hidden) return false;
    if (!GB.isWide() && !document.body.classList.contains('reading')) return false;
    if (e.key === 'ArrowRight') { go(1); return true; } if (e.key === 'ArrowLeft') { go(-1); return true; }
    if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { pageStep(1); return true; } if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { pageStep(-1); return true; }
    return false;
  };
})(window.GB);
