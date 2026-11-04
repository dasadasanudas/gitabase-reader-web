/* Gitabase Reader web: the Glass theme. Real refraction of the live page: toolbars, the phone tab bar, the Aa panel,
   sheets and menus float over the content, and whatever scrolls under them (verses, covers, lists) bends at their rim,
   is softly blurred inside and lit along the edge.
   How: each glass surface gets its own SVG lens filter, sized to it, used as `backdrop-filter: url(#id)`. Chromium is the
   only engine that runs SVG filters on the backdrop, and on current Chrome an image map (feImage) arrives blank there,
   so the displacement map is built inside the filter from primitives: a rounded rect (blurred + thresholded), a thin edge
   window, and a Sobel gradient per axis (inward shift = the folded rim that reads as thick glass). Blur and saturation
   live inside the same filter (a url() next to blur() loses the bend). No clip-path on ancestors, no blend modes.
   Where it can't run well (not Chromium, no GPU, slow or low-memory device, data saver, reduce transparency) the app
   uses the default green (Tulasi) without glass. Link overrides: ?glass=1 forces it on, ?glass=0 off. */
'use strict';
(function (GB) {
  const H = document.documentElement, NS = 'http://www.w3.org/2000/svg';
  const Q = new URLSearchParams(location.search).get('glass');
  let verdict = null;

  // ---------- can this device run it? ----------
  function check() {
    if (verdict) return verdict;
    const why = []; let gpu = '';
    const ua = navigator.userAgent || '', brands = ((navigator.userAgentData && navigator.userAgentData.brands) || []).map(b => b.brand).join(' ');
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const chromium = /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/.test(brands) || (/\bChrome\/\d/.test(ua) && !/\b(Firefox|FxiOS|CriOS|EdgiOS)\b/.test(ua) && !ios);
    if (!chromium) why.push('browser');
    if (!(window.CSS && CSS.supports && CSS.supports('backdrop-filter', 'url(#a)'))) why.push('browser');
    if ((navigator.hardwareConcurrency || 8) < 4) why.push('cpu');
    if (navigator.deviceMemory && navigator.deviceMemory < 4) why.push('memory');
    if (navigator.connection && navigator.connection.saveData) why.push('data saver');
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) why.push('reduce transparency');
    try {
      const g = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      if (!g) why.push('no gpu');
      else {
        const d = g.getExtension('WEBGL_debug_renderer_info'); gpu = d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
        if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)) why.push('no gpu');
        const lc = g.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
      }
    } catch (e) { why.push('no gpu'); }
    if (Q === '1') why.length = 0;
    if (Q === '0') why.push('off by link');
    verdict = { ok: !why.length, why: Array.from(new Set(why)), gpu, forced: Q === '1' };
    return verdict;
  }
  const REASON = { browser: 'needs Chrome, Edge or another Chromium browser', cpu: 'this device is too slow for it', memory: 'this device is too slow for it', 'data saver': 'Data saver is on',
    'reduce transparency': 'Reduce transparency is on in your system settings', 'no gpu': 'no graphics chip is available', 'off by link': 'turned off by the link' };

  // ---------- lens filters ----------
  // kind: bar (toolbars, tab bar: crisp, light frost) | panel (Aa panel, sheets, menus: heavier frost so their own text reads)
  const KIND = { bar: { blur: 2.2, sat: 1.6, k: 1.25 }, panel: { blur: 5, sat: 1.7, k: 1 } };
  const SURF = [
    ['#reader .rd-head', 'bar'], ['#left .page > .hdr', 'bar'], ['#rail', 'bar', () => !H.classList.contains('desk')],
    ['.sheet', 'panel'], ['.popmenu', 'panel']
  ];
  let defs = null, on = false, seq = 0, ro = null, mo = null, raf = 0;
  const tracked = new Map();   // element -> { id, sig, filter }
  function host() {
    if (defs && defs.isConnected) return defs;
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('width', '0'); s.setAttribute('height', '0');
    s.setAttribute('color-interpolation-filters', 'sRGB'); s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(NS, 'defs'); s.append(defs); document.body.append(s); return defs;
  }
  const f = n => (Math.round(n * 100) / 100).toString();
  function lensMarkup(w, hgt, r, kind, dpr) {
    const K = KIND[kind] || KIND.bar;
    const rr = Math.max(4, Math.min(r || hgt / 2, hgt / 2, w / 2));
    const sShape = Math.max(2, rr * 0.55);                          // blur that rounds the rect's corners to ~ the CSS radius
    const sEdge = Math.max(2.4, Math.min(6, hgt * 0.085));          // thin window along the rim
    const scale = Math.max(34, Math.min(74, hgt * 1.3)) * K.k;     // how far the rim folds the backdrop inward
    const pad = Math.ceil(scale / 2 + sShape * 2 + 6);
    const div = f(1.2 / (sEdge * dpr));                            // Sobel runs on device pixels
    return '<feFlood flood-color="#000" result="bg"/>' +
      '<feFlood flood-color="#fff" x="0" y="0" width="' + f(w) + '" height="' + f(hgt) + '" result="rect"/>' +
      '<feComposite in="rect" in2="bg" operator="over" result="mask"/>' +
      '<feGaussianBlur in="mask" stdDeviation="' + f(sShape) + '" result="soft"/>' +
      '<feComponentTransfer in="soft" result="shape"><feFuncR type="linear" slope="40" intercept="-19.5"/><feFuncG type="linear" slope="40" intercept="-19.5"/><feFuncB type="linear" slope="40" intercept="-19.5"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>' +
      '<feGaussianBlur in="shape" stdDeviation="' + f(sEdge) + '" result="edgeSoft"/>' +
      '<feComponentTransfer in="edgeSoft" result="edge"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>' +
      '<feConvolveMatrix in="edge" order="3" kernelMatrix="1 0 -1 2 0 -2 1 0 -1" divisor="' + div + '" bias="0.5" preserveAlpha="true" edgeMode="duplicate" result="gx"/>' +
      '<feConvolveMatrix in="edge" order="3" kernelMatrix="1 2 1 0 0 0 -1 -2 -1" divisor="' + div + '" bias="0.5" preserveAlpha="true" edgeMode="duplicate" result="gy"/>' +
      '<feColorMatrix in="gx" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>' +
      '<feColorMatrix in="gy" values="0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>' +
      '<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="map"/>' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="' + f(K.blur) + '" result="blurred"/>' +
      '<feComponentTransfer in="blurred" result="opaque"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>' +
      '<feColorMatrix in="opaque" type="saturate" values="' + f(K.sat) + '" result="source"/>' +
      '<feDisplacementMap in="source" in2="map" scale="' + f(scale) + '" xChannelSelector="R" yChannelSelector="G"/>' +
      '|' + pad;
  }
  function attach(el, kind) {
    const b = el.getBoundingClientRect(); if (b.width < 8 || b.height < 8) return;
    const cs = getComputedStyle(el), r = parseFloat(cs.borderTopLeftRadius) || 0, dpr = window.devicePixelRatio || 1;
    const sig = Math.round(b.width) + 'x' + Math.round(b.height) + 'r' + Math.round(r) + 'd' + dpr + kind;
    let t = tracked.get(el);
    if (t && t.sig === sig && t.filter.isConnected) return;
    if (!t) { t = { id: 'gbLens' + (++seq), filter: null, sig: '' }; tracked.set(el, t); if (ro) ro.observe(el); }
    const [markup, pad] = lensMarkup(b.width, b.height, r, kind, dpr).split('|');
    if (!t.filter || !t.filter.isConnected) { t.filter = document.createElementNS(NS, 'filter'); t.filter.id = t.id; host().append(t.filter); }
    const F = t.filter;
    F.setAttribute('filterUnits', 'userSpaceOnUse'); F.setAttribute('primitiveUnits', 'userSpaceOnUse');
    F.setAttribute('x', -pad); F.setAttribute('y', -pad); F.setAttribute('width', Math.ceil(b.width) + 2 * pad); F.setAttribute('height', Math.ceil(b.height) + 2 * pad);
    F.innerHTML = markup; t.sig = sig;
    // re-assign so Chrome picks up the rebuilt filter
    el.style.backdropFilter = 'none'; void el.offsetWidth; el.style.backdropFilter = 'url(#' + t.id + ')';
    el.classList.add('lg', 'lg-' + kind);
  }
  function detach(el) {
    const t = tracked.get(el); if (!t) return;
    if (t.filter) t.filter.remove(); tracked.delete(el); if (ro) ro.unobserve(el);
    el.style.backdropFilter = ''; el.classList.remove('lg', 'lg-bar', 'lg-panel');
  }
  function scan() {
    raf = 0; if (!on) return;
    const seen = new Set();
    for (const [sel, kind, when] of SURF) {
      if (when && !when()) continue;
      document.querySelectorAll(sel).forEach(el => { if (el.closest('.under') || el.hidden) return; seen.add(el); attach(el, kind); });
    }
    for (const el of Array.from(tracked.keys())) if (!seen.has(el) || !el.isConnected) detach(el);
  }
  const later = () => { if (!raf && on) raf = requestAnimationFrame(scan); };

  function start() {
    if (on) return; on = true; H.classList.add('glass');
    ro = ro || new ResizeObserver(later);
    mo = mo || new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('resize', later); window.addEventListener('gb:layout', later);
    later(); setTimeout(later, 300);
  }
  function stop() {
    if (!on) return; on = false; H.classList.remove('glass');
    if (mo) mo.disconnect(); window.removeEventListener('resize', later); window.removeEventListener('gb:layout', later);
    for (const el of Array.from(tracked.keys())) detach(el);
  }
  const wantOn = () => GB.prefs.accent === 'glass' && check().ok;

  // ---------- public ----------
  GB.glass = {
    check, active: () => on, sync: () => (wantOn() ? start() : stop()), lens: lensMarkup,
    reason() { const v = check(); return v.ok ? '' : (REASON[v.why[0]] || v.why[0]); },
    retry() { verdict = null; }
  };
  document.addEventListener('gb:pref', e => { if (e.detail && e.detail.k === 'accent' && !GB.prefs.accentPicked) { GB.prefs.accentPicked = true; GB.savePrefs(); } });
  const sa = GB.setAccent;
  GB.setAccent = function (k) { GB.prefs.accentPicked = true; if (k === 'glass') GB.glass.retry(); sa(k); };
  const aa = GB.applyAccent;
  GB.applyAccent = function () { aa(); GB.glass.sync(); };
})(window.GB);
