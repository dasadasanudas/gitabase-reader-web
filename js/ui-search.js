/* Gitabase Reader web: fast search. When library/catalog.json lists a prebuilt word index for a file (tools/gb_index.py),
   searches are answered from a few small gzip shards instead of walking the 500 MB file's full-text blocks:
   single words, word beginnings (adhikar*), AND / OR / NOT, "search in this book", and phrases (the index finds the
   texts holding every word of the phrase; the results page then keeps only the texts where the words stand together,
   checked on the very text it shows). "Closest words first" and files without an index use the original reader.
   Result rows: ref shards say where each text is (shown at once), loc.gz says which file chunks hold its row (fetched
   in parallel before the database reads them, so a cold results page is one round of downloads, not thirty). */
'use strict';
(function (root) {
  const BIT = { 1: 1, 5: 2, 6: 4, 7: 8 }, ALL = 14, MAXSHARDS = 16;
  const NO = new Error('fast search: not applicable');
  const dirs = new Map(), shards = new Map();
  const TD = new TextDecoder();

  async function gunzip(buf) {
    if (typeof DecompressionStream === 'undefined') throw NO;
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  function vr(b, st) { let v = 0, m = 1, c; do { c = b[st.p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  function parseShard(b) {
    const st = { p: 0 }, terms = new Map();
    while (st.p < b.length) {
      const n = vr(b, st), t = TD.decode(b.subarray(st.p, st.p + n)); st.p += n;
      const nd = vr(b, st), nb = vr(b, st); terms.set(t, { off: st.p, len: nb, n: nd }); st.p += nb;
    }
    return { b, terms };
  }
  function lastLE(arr, t) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
  const hasPhrase = n => !!n && (n.t === 'term' ? n.tokens.length > 1 : n.t === 'not' ? hasPhrase(n.a) || hasPhrase(n.b) : (n.kids || []).some(hasPhrase));

  function makeEngine(base, fetchFn) {
    const get = fetchFn || ((u) => fetch(u));
    const key = u => base + u;
    async function dir() {
      if (!dirs.has(base)) { const p = get(base + 'dir.json').then(r => { if (!r.ok) throw NO; return r.json(); }); dirs.set(base, p); p.catch(() => dirs.delete(base)); }
      return dirs.get(base);
    }
    async function shard(i) {
      const k = key(i);
      if (!shards.has(k)) {
        const p = get(base + 's' + String(i).padStart(4, '0') + '.gz').then(async r => { if (!r.ok) throw NO; return parseShard(await gunzip(await r.arrayBuffer())); });
        shards.set(k, p); p.catch(() => shards.delete(k));
        if (shards.size > 24) shards.delete(shards.keys().next().value);
      }
      return shards.get(k);
    }
    // term -> Map(docid -> {m: mask, h: tf})
    async function postings(tok, prefix, want, noTf) {
      const d = await dir(), out = new Map();
      if (!tok) return out;
      if (prefix && tok.length < 2) throw NO;
      let i = lastLE(d.first, tok); if (i < 0) { if (!prefix) return out; i = 0; }
      const list = [i];
      if (prefix) { while (i + 1 < d.n && d.first[i + 1].startsWith(tok)) { list.push(++i); if (list.length > MAXSHARDS) throw NO; } }
      const sh = await Promise.all(list.map(shard));
      for (const s of sh) {
        for (const [t, e] of s.terms) {
          if (prefix ? !t.startsWith(tok) : t !== tok) continue;
          const st = { p: e.off }, end = e.off + e.len; let doc = 0;
          while (st.p < end) {
            const v = vr(s.b, st), m = v % 16, tf = vr(s.b, st); doc += (v - m) / 16;
            const mm = m & want; if (!mm) continue;
            const o = out.get(doc); if (o) { o.m |= mm; o.h += noTf ? 0 : tf; } else out.set(doc, { m: mm, h: noTf ? 0 : tf });
          }
        }
      }
      return out;
    }
    // neg: inside the excluded part of a NOT. A phrase there can't be decided from the index, so it excludes nothing
    // (the candidates stay a superset; the results page checks every candidate against the full query).
    async function ev(n, want, neg) {
      if (n.t === 'term') {
        if (n.tokens.length !== 1) {
          if (neg) return new Map();
          const ks = n.tokens.map((t, i) => ({ t: 'term', tokens: [t], prefix: !!n.prefix && i === n.tokens.length - 1, cols: n.cols }));
          return ev({ t: 'and', kids: ks }, want, neg);
        }
        let w = want, noTf = false;
        if (n.cols) { w = 0; for (const c of n.cols) w |= BIT[c] || 0; if (!w) throw NO; noTf = n.cols.length === 1 && n.cols[0] === 1; }
        return postings(n.tokens[0], !!n.prefix, w, noTf);
      }
      if (n.t === 'or') {
        const res = new Map();
        for (const m of await Promise.all(n.kids.map(k => ev(k, want, neg)))) for (const [d, x] of m) { const o = res.get(d); if (o) { o.m |= x.m; o.h += x.h; } else res.set(d, { m: x.m, h: x.h }); }
        return res;
      }
      if (n.t === 'and') {
        const lists = await Promise.all(n.kids.map(k => ev(k, want, neg)));
        if (neg && n.kids.some(hasPhrase)) return new Map();   // an AND holding an undecidable phrase excludes nothing for sure
        lists.sort((a, b) => a.size - b.size);
        const res = new Map();
        for (const [d, x] of lists[0]) {
          let m = x.m, h = x.h, ok = true;
          for (let i = 1; i < lists.length; i++) { const o = lists[i].get(d); if (!o) { ok = false; break; } m |= o.m; h += o.h; }
          if (ok) res.set(d, { m, h });
        }
        return res;
      }
      if (n.t === 'not') {
        const [a, b] = await Promise.all([ev(n.a, want, neg), ev(n.b, 15, !neg)]);
        if (neg) return a;                                       // NOT inside NOT: keep the superset simple
        for (const d of b.keys()) a.delete(d);
        return a;
      }
      throw NO;
    }
    async function search(ast, cols) {
      const d = await dir(); let want = 0;
      if (cols && cols.length) { for (const c of cols) { if (!(c in BIT) || !d.cols.includes(BIT[c])) throw NO; want |= BIT[c]; } } else want = ALL;
      const m = await ev(ast, want, false), out = [];
      for (const [doc, x] of m) {
        const pc = {}; for (const c of [5, 6, 7]) if (x.m & BIT[c]) pc[c] = 1;
        out.push([doc, Math.max(1, x.h), pc, null]);
      }
      out.sort((a, b) => a[0] - b[0]);
      if (hasPhrase(ast)) out.verify = { ast, cols: cols && cols.length ? cols.slice() : [5, 6, 7] };   // candidates: check each row
      return out;
    }
    return { search, dir };
  }

  // ---- exact check of one row against a query (phrases, word beginnings, AND / OR / NOT), same tokens as the index
  const isTok = c => c >= 0x80 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  function toks(s) {   // = GBFTS.toks in db.js and the build's tokenizer: ASCII letters/digits and all non-ASCII are word characters
    const out = []; let cur = '';
    for (const ch of String(s == null ? '' : s)) { const c = ch.codePointAt(0); if (isTok(c)) cur += c < 128 ? ch.toLowerCase() : ch; else if (cur) { out.push(cur); cur = ''; } }
    if (cur) out.push(cur); return out;
  }
  function rowToks(R) { if (!R._tk) R._tk = { 1: toks(R.b), 5: toks(R.txt && R.txt[5]), 6: toks(R.txt && R.txt[6]), 7: toks(R.txt && R.txt[7]) }; return R._tk; }
  function hitIn(arr, n) {
    const k = n.tokens.length, last = k - 1;
    for (let i = 0; i + k <= arr.length; i++) {
      let ok = true;
      for (let j = 0; j < k; j++) { const t = arr[i + j], q = n.tokens[j]; if (!(j === last && n.prefix ? t.startsWith(q) : t === q)) { ok = false; break; } }
      if (ok) return true;
    }
    return false;
  }
  function matches(n, R, cols) {
    if (n.t === 'term') { const T = rowToks(R); return (n.cols || cols).some(c => T[c] && hitIn(T[c], n)); }
    if (n.t === 'and') return n.kids.every(k => matches(k, R, cols));
    if (n.t === 'or') return n.kids.some(k => matches(k, R, cols));
    if (n.t === 'not') return matches(n.a, R, cols) && !matches(n.b, R, [1, 5, 6, 7]);
    return false;
  }

  // ---- per-file extras next to the word index: dir.json, ref shards, row chunk map
  async function dirOf(base) {
    if (!dirs.has(base)) { const p = fetch(base + 'dir.json').then(r => { if (!r.ok) throw NO; return r.json(); }); dirs.set(base, p); p.catch(() => dirs.delete(base)); }
    return dirs.get(base);
  }
  function fileOf(D) { const lib = root.GB.lib; return D && D.rec && (lib.catalog && lib.catalog.files || []).find(x => 'h:' + x.id === D.rec.id) || null; }
  function idxBase(f) { return new URL('../' + f.search.dir, new URL(f.base, document.baseURI)).href; }
  const refShards = new Map();
  async function refShard(base, i) {
    const k = base + 'r' + i;
    if (!refShards.has(k)) {
      const p = (async () => {
        const r = await fetch(base + 'r' + String(i).padStart(4, '0') + '.gz'); if (!r.ok) throw NO;
        const lines = TD.decode(await gunzip(await r.arrayBuffer())).split('\n'), m = new Map(); let prev = null;
        for (let k2 = 0; k2 < lines.length; k2++) {
          const f = lines[k2].split('\t'); let doc, v;
          if (!prev) { doc = +f[0]; v = f.slice(1, 5).map(x => (x === '~' ? '' : x)); }
          else { doc = prev[0] + (f[0] ? +f[0] : 1); v = [0, 1, 2, 3].map(j => (f[j + 1] === '' || f[j + 1] === undefined ? prev[1][j] : f[j + 1] === '~' ? '' : f[j + 1])); }
          m.set(doc, v); prev = [doc, v];
        }
        return m;
      })();
      refShards.set(k, p); p.catch(() => refShards.delete(k));
    }
    return refShards.get(k);
  }
  // docid -> {b, s, c, t} for the given ids (only the shards they fall in are fetched); null when the file has none
  async function refsFor(D, ids) {
    const f = fileOf(D); if (!f || !f.search) return null;
    const base = idxBase(f), d = await dirOf(base); if (!d.refs || !d.refs.n) return null;
    const need = new Set(); for (const id of ids) { const i = lastLE(d.refs.first, id); if (i >= 0) need.add(i); }
    const maps = await Promise.all(Array.from(need).map(i => refShard(base, i))), out = new Map();
    for (const id of ids) for (const m of maps) { const v = m.get(id); if (v) { out.set(id, { b: v[0], s: v[1], c: v[2], t: v[3] }); break; } }
    return out;
  }
  const locs = new Map(), asked = new Set();
  async function locMap(base, chunkSize) {
    if (!locs.has(base)) locs.set(base, (async () => {
      const d = await dirOf(base); if (!d.loc || d.chunk !== chunkSize) return null;
      const r = await fetch(base + (d.locv === 2 ? 'loc2.gz' : 'loc.gz')); if (!r.ok) return null;
      const b = await gunzip(await r.arrayBuffer()), st = { p: 0 }, doc = [], at = [], cs = [];
      let id = 0, prevc = 0;
      if (d.locv === 2) {
        while (st.p < b.length) {
          id += vr(b, st); const k = vr(b, st), z = vr(b, st); let c = prevc + (z % 2 ? -(z + 1) / 2 : z / 2); prevc = c;
          doc.push(id); at.push(cs.length); cs.push(c); for (let i = 1; i < k; i++) { c += vr(b, st); cs.push(c); }
        }
      } else {
        while (st.p < b.length) { id += vr(b, st); const c0 = vr(b, st), sp = vr(b, st); doc.push(id); at.push(cs.length); for (let c = c0; c <= c0 + sp; c++) cs.push(c); }
      }
      at.push(cs.length);
      return { doc, at, cs, hot: d.hot || [] };
    })().catch(() => null));
    return locs.get(base);
  }
  async function fetchChunks(f, list) {
    const cb = new URL(f.base, document.baseURI).href;
    const todo = Array.from(new Set(list)).filter(c => !asked.has(cb + c)).sort((a, b) => a - b); todo.forEach(c => asked.add(cb + c));
    let next = 0;
    const lane = async () => { while (next < todo.length) { const c = todo[next++]; try { const r = await fetch(cb + String(c).padStart(5, '0') + '.bin'); if (!r.ok) throw 0; await r.arrayBuffer(); } catch (e) { asked.delete(cb + c); } } };
    await Promise.all(Array.from({ length: Math.min(12, todo.length) }, lane));
    return todo.length;
  }
  // what every row lookup in this file reads first (schema, upper b-tree): fetched while the word index is being read
  async function warm(D) {
    try { const f = fileOf(D); if (!f || !f.search) return; const m = await locMap(idxBase(f), f.chunkSize); if (m && m.hot.length) note('warm ' + await fetchChunks(f, m.hot)); } catch (e) {}
  }
  async function prefetchRows(D, ids) {
    const f = fileOf(D); if (!f || !f.search) return;
    const m = await locMap(idxBase(f), f.chunkSize); if (!m) return;
    const want = m.hot.slice();
    for (const id of ids) {
      let lo = 0, hi = m.doc.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (m.doc[mid] < id) lo = mid + 1; else { if (m.doc[mid] === id) k = mid; hi = mid - 1; } }
      if (k < 0) continue;
      for (let i = m.at[k]; i < m.at[k + 1]; i++) want.push(m.cs[i]);
    }
    note('prefetch ' + ids.length + ' rows: ' + await fetchChunks(f, want) + ' chunks');
  }
  if (root.GB && root.GB.lib && root.GB.lib.q && typeof document !== 'undefined') {
    const q0 = root.GB.lib.q;
    root.GB.lib.q = async function (D, sql, bind) {
      const isRows = Array.isArray(bind) && bind.length > 0 && /FROM textindex_content WHERE docid IN/.test(sql);
      if (isRows) { try { await prefetchRows(D, bind); } catch (e) { console.warn('row prefetch skipped', e); } }
      const t0 = performance.now();
      try { const r = await q0.apply(this, arguments); if (isRows) note('rows ' + (r && r.length) + ' ' + Math.round(performance.now() - t0) + 'ms ' + String(D.name || '').slice(0, 12)); return r; }
      catch (e) { note('qERR ' + String(e && e.message || e).slice(0, 90)); throw e; }
    };
  }

  // ?dbg in the address shows what the search is doing in the page title (no console needed)
  const dbg = typeof location !== 'undefined' && /[?&]dbg\b/.test(location.search), trace = [];
  function note(s) { if (!dbg) return; trace.push(s); document.title = trace.slice(-6).join(' | '); }
  if (dbg) {
    window.addEventListener('unhandledrejection', e => note('REJECT ' + String(e.reason && e.reason.message || e.reason).slice(0, 80)));
    window.addEventListener('error', e => note('ERR ' + String(e.message).slice(0, 80)));
  }

  const engines = new Map();
  function engineFor(dbId) {
    const lib = root.GB && root.GB.lib; if (!lib || !lib.catalog) return null;
    const D = Array.from(lib.dbs.values()).find(x => x.num === dbId); const f = fileOf(D); if (!f || !f.search) return null;
    const base = idxBase(f);
    if (!engines.has(base)) engines.set(base, makeEngine(base, null));
    const e = engines.get(base); e.D = D; return e;
  }
  if (typeof GBDB !== 'undefined' && typeof document !== 'undefined') {
    const orig = GBDB.fts;
    GBDB.fts = async function (dbId, ast, cols, distAst) {
      if (!distAst) {
        try {
          const e = engineFor(dbId);
          if (e) { const t0 = performance.now(), r = await e.search(ast, cols); if (r.length) warm(e.D); r.fastMs = Math.round(performance.now() - t0); note('fts ' + r.length + (r.verify ? '?' : '') + ' ' + r.fastMs + 'ms'); return r; }
        } catch (err) { if (err !== NO) console.warn('fast search failed, using the file index', err); }
      }
      return orig.apply(GBDB, arguments);
    };
  }

  // ================= results page (replaces the one in ui-extra.js; same look) =================
  // Every file is searched at once; rows show their place in the book straight away (ref shards) and their text as soon
  // as it arrives; phrase candidates are checked on their text before they are shown; a newer search stops an older one.
  const GB = root.GB;
  if (GB && GB.search && typeof document !== 'undefined') {
    const S = GB.search, lib = GB.lib, L = GB.left, { h } = GB;
    const devCls = s => (/[\u0900-\u097F]/.test(s || '') ? '.devui' : '');
    const COLS = { all: [5, 6, 7], verses: [6], comments: [7], sanskrit: [5] };
    const PLACE = { 5: 'synonyms', 6: 'translation', 7: 'purport' };
    let seq = 0;
    function bookOf(r) { const bk = r.D.books.find(b => b._id == r.b); return bk ? lib.books.find(x => x.parts.some(p => p.D === r.D && p.bookId == bk._id)) : null; }
    function fillText(el, r, needles) {
      let place = Object.keys(r.pc || {}).sort().map(k => PLACE[k]).filter(Boolean)[0];
      const col = place === 'purport' ? 7 : place === 'synonyms' ? 5 : 6;
      let text = r.txt ? GB.stripTags(r.txt[col] || '') : '';
      if ((!place || !text) && r.txt) { for (const c of [6, 7, 5]) { const t = GB.stripTags(r.txt[c] || ''); if (needles.some(n => GB.fold(t).includes(GB.fold(n)))) { text = t; place = PLACE[c]; break; } } if (!text) text = GB.stripTags(r.txt[6] || r.txt[7] || ''); }
      const pl = el.querySelector('.sr-place'); if (pl) pl.remove();
      const en = el.querySelector('.sr-entry'); const nw = h('div.sr-entry' + devCls(text), { html: GB.render.snippet(GB.ut(text), needles) });
      if (place) el.insertBefore(h('div.sr-place', { text: place }), en);
      en.replaceWith(nw); el.classList.remove('wait');
    }
    function resultRow(r, needles) {
      const B = bookOf(r);
      if (!B) return h('div.sr-row.dim', { text: 'Text from a book that is not in your library' });
      const ch = lib.findChapter(B, r.s, r.c);
      const el = h('div.sr-row' + (ch ? '' : '.dim') + (r.txt ? '' : '.wait'), { onclick: ch ? async () => { const rows = await lib.chapterTexts(B, ch); const i = lib.findTextIndex(rows, r.t); if (i >= 0) GB.reader.open(B, ch, i, { needles, noAsk: true }); } : null },
        h('div.sr-top', null, h('span.sr-title', { text: lib.label(B, r.s, r.c, r.t) }), r.hits > 1 ? h('span.sr-seq', { text: '×' + r.hits }) : null),
        h('div.sr-sub' + devCls(ch && ch.title), { text: GB.ut(ch ? ch.title : '') }),
        h('div.sr-entry', { text: r.txt ? '' : '…' }));
      if (r.txt) fillText(el, r, needles);
      return el;
    }
    async function loadText(D, rs) {
      const fts = rs.filter(r => r.docid != null && !r.txt), plain = rs.filter(r => r.docid == null && !r.txt);
      if (fts.length) {
        const rows = await lib.q(D, 'SELECT docid, c1book_id AS b, c2song AS s, c3ch_no AS c, c4txt_no AS t, c5translit AS c5, c6transl2 AS c6, c7comment AS c7 FROM textindex_content WHERE docid IN (' + fts.map(() => '?').join(',') + ')', fts.map(r => r.docid));
        const m = new Map(rows.map(x => [x.docid, x])); fts.forEach(r => { const x = m.get(r.docid); if (x) Object.assign(r, { b: x.b, s: x.s, c: x.c, t: x.t, txt: { 5: x.c5, 6: x.c6, 7: x.c7 } }); else r.gone = true; });
      }
      if (plain.length) {
        const rows = await lib.q(D, 'SELECT _id, transl1 AS c5, transl2 AS c6, comment AS c7 FROM texts WHERE _id IN (' + plain.map(() => '?').join(',') + ')', plain.map(r => r.textId));
        const m = new Map(rows.map(x => [x._id, x])); plain.forEach(r => { const x = m.get(r.textId); if (x) r.txt = { 5: x.c5, 6: x.c6, 7: x.c7 }; });
      }
    }
    S.run = async function (o) {
      o = Object.assign({ sort: 'none', scope: 'all' }, o);
      const my = ++seq;
      const hist = await GB.store.kvGet('searchHistory', []); await GB.store.kvSet('searchHistory', [o.q].concat(hist.filter(x => x !== o.q)).slice(0, 30));
      const needles = o.exact ? [o.q.replace(/"/g, '')] : GBFTS.needles(o.q);
      const count = h('span.sr-count', { text: '…' });
      const pg = GB.page({ kind: 'search', title: 'Search results', subtitle: o.q + (o.book ? '  ·  ' + o.book.title : ''), cls: 'searchpage',
        actions: [count, GB.hbtn('search', 'New search', () => S.dialog({ book: o.book, q: o.q }))] });
      const top = L.top(); if (top && top.kind === 'search') L.replaceTop(pg); else L.push(pg);
      const list = h('div.sr-list'); pg.body.append(list);
      const status = h('div.loading-row', { text: 'Searching…' }); pg.body.append(status);
      const live = () => my === seq && pg.body.isConnected;
      const results = []; let t0 = performance.now();
      try {
        const parts = []; for (const B of (o.book ? [o.book] : lib.books)) for (const p of B.parts) parts.push({ B, p });
        const byD = new Map(); for (const x of parts) { if (!byD.has(x.p.D)) byD.set(x.p.D, []); byD.get(x.p.D).push(x); }
        let done = 0; const nD = byD.size;
        const per = await Promise.all(Array.from(byD).map(async ([D, xs]) => {
          const out = [];
          try {
            if (GB.prefs.useIndex && D.hasFts) {
              let ast = GBFTS.parse(o.q, { entityMode: D.entityMode, exact: o.exact }); if (!ast) return out; const userAst = ast;
              if (o.book) ast = { t: 'and', kids: [ast, { t: 'or', kids: xs.map(x => ({ t: 'term', tokens: [String(x.p.bookId)], cols: [1] })) }] };
              const r = await GBDB.fts(D.num, ast, COLS[o.scope], o.sort === 'dist' ? userAst : null) || [];
              for (const [docid, hits, pc, dist] of r) out.push({ D, docid, hits, pc, dist, verify: r.verify || null });
            } else {
              const words = o.exact ? [o.q.replace(/"/g, '')] : needles; if (!words.length) return out;
              const colsSql = { all: ['transl2', 'comment', 'transl1', 'translit'], verses: ['transl2'], comments: ['comment'], sanskrit: ['transl1', 'translit'] }[o.scope];
              const conds = words.map(() => '(' + colsSql.map(c => 'x.' + c + ' LIKE ?').join(' OR ') + ')').join(' AND ');
              const bind = []; words.forEach(w => colsSql.forEach(() => bind.push('%' + w + '%')));
              let bsql = ''; if (o.book) { bsql = ' AND n.book_id IN (' + xs.map(() => '?').join(',') + ')'; xs.forEach(x => bind.push(x.p.bookId)); }
              const rows = await lib.q(D, 'SELECT n._id AS id, n.book_id AS b, n.song AS s, n.ch_no AS c, n.txt_no AS t FROM textnums n JOIN texts x ON x._id = n._id WHERE ' + conds + bsql + ' ORDER BY n._id LIMIT 3000', bind);
              for (const r of rows) out.push({ D, textId: r.id, b: r.b, s: r.s, c: r.c, t: r.t, hits: 1, pc: {} });
            }
          } finally { done++; if (live() && done < nD) status.textContent = 'Searching… ' + done + ' of ' + nD + ' files'; }
          return out;
        }));
        for (const a of per) for (const r of a) results.push(r);
      } catch (e) { console.error(e); if (live()) status.textContent = GB.errMsg(e, 'Search failed'); return; }
      if (!live()) return;
      note('all files ' + Math.round(performance.now() - t0) + 'ms');
      const dv = r => (r.dist == null ? 1e9 : r.dist);
      if (o.sort === 'count') results.sort((a, b) => b.hits - a.hits);
      else if (o.sort === 'dist') results.sort((a, b) => (dv(a) - dv(b)) || (b.hits - a.hits));
      const checking = results.some(r => r.verify);
      let shown = 0, next = 0, kept = 0;
      const setCount = () => { count.textContent = checking && next < results.length ? kept + '+' : String(checking ? kept : results.length); };
      if (!checking) setCount(); status.textContent = checking ? 'Checking phrases…' : 'Loading texts…';
      if (!results.length) { status.remove(); count.textContent = '0'; list.append(h('div.help-row', { text: 'Nothing found. Try fewer words, add * for word variants, or switch the search index off to find parts of words.' })); return; }
      const more = h('button.btn.more', { text: 'Show more', onclick: () => page() });
      async function page() {
        more.remove(); if (!status.isConnected) pg.body.append(status);
        let added = 0;
        while (live() && added < 40 && next < results.length) {
          const batch = results.slice(next, next + (checking ? 30 : 40)); next += batch.length;
          const byD = new Map(); batch.forEach(r => { if (!byD.has(r.D)) byD.set(r.D, []); byD.get(r.D).push(r); });
          if (!checking) {   // place in the book first (ref shards), text when it comes
            await Promise.all(Array.from(byD).map(async ([D, rs]) => { try { const m = await refsFor(D, rs.filter(r => r.docid != null && r.b == null).map(r => r.docid)); if (m) rs.forEach(r => { const x = m.get(r.docid); if (x && r.b == null) Object.assign(r, x); }); } catch (e) {} }));
            if (!live()) return;
            for (const r of batch) { r.el = r.b != null ? resultRow(r, needles) : null; if (r.el) list.append(r.el); }
            shown += batch.length; added += batch.length; if (status.isConnected) { status.remove(); }
          }
          const t1 = performance.now();
          // texts in two waves: the first screenful, then the rest (each row is a few 256 KB chunks of its file)
          for (const wave of checking ? [batch] : [batch.slice(0, 12), batch.slice(12)]) {
            if (!wave.length) continue;
            const wD = new Map(); wave.forEach(r => { if (!wD.has(r.D)) wD.set(r.D, []); wD.get(r.D).push(r); });
            await Promise.all(Array.from(wD).map(async ([D, rs]) => {
              try { await loadText(D, rs); } catch (e) { console.warn('rows', e); }
              if (!live() || checking) return;
              for (const r of rs) {
                if (r.el && r.txt) fillText(r.el, r, needles);
                else if (r.el && r.gone) { r.el.classList.add('dim'); r.el.querySelector('.sr-entry').textContent = ''; }
              }
            }));
            if (!live()) return;
          }
          note('texts ' + batch.length + ' ' + Math.round(performance.now() - t1) + 'ms');
          if (checking) {
            const ok = batch.filter(r => r.txt && (!r.verify || matches(r.verify.ast, r, r.verify.cols)));
            for (const r of ok) list.append(resultRow(r, needles));
            kept += ok.length; added += ok.length; shown += batch.length; setCount();
          } else {   // rows without a ref shard: shown once their text is in
            for (const r of batch) if (!r.el && r.txt) { r.el = resultRow(r, needles); list.append(r.el); }
          }
        }
        if (!live()) return;
        status.remove();
        if (checking && !kept && next >= results.length) { count.textContent = '0'; list.append(h('div.help-row', { text: 'Nothing found with these words next to each other. Untick Exact phrase to find texts that have all of them.' })); return; }
        if (next < results.length) list.append(more);
      }
      page();
    };
  }
  // a few seconds after start, read every file's small dir.json, so the first search needs one round of downloads, not two
  if (typeof document !== 'undefined' && root.GB && root.GB.lib) setTimeout(() => {
    try { for (const f of (root.GB.lib.catalog && root.GB.lib.catalog.files) || []) if (f.search) dirOf(idxBase(f)).catch(() => {}); } catch (e) {}
  }, 4000);
  root.GBSearchFast = { makeEngine, NO, matches };
  if (typeof module !== 'undefined') module.exports = { makeEngine, NO, gunzip, matches, hasPhrase, _t: { locMap, refShard } };
})(typeof window !== 'undefined' ? window : globalThis);
