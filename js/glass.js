/* Gitabase Reader web: the Glass theme (Sam's LGX Liquid Glass kit, js/lgx.bundle.js, loaded only when Glass is on).
   Glass is the default look. It needs a Chromium browser (Chrome, Edge, Brave, Opera, Samsung Internet), WebGL2 on a real GPU
   and a reasonably fast device; anywhere else the app quietly uses the default green (Tulasi).
   Honest glass only: the kit refracts the wallpaper, so glass is drawn only where the wallpaper (or other glass) is behind it:
   the tab rail and the sidebar on desktop, the home panel, its header and the tab bar on phones. The reading page stays paper;
   menus, sheets and dialogs over text use a frosted blur instead (css/glass.css).
   Link overrides for testing: ?glass=1 forces it on, ?glass=0 forces it off. */
'use strict';
(function (GB) {
  const { h } = GB;
  const H = document.documentElement;
  const SLOW = 'gb-glass-slow';
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
    if ((navigator.hardwareConcurrency || 8) < 4) why.push('cpu');
    if (navigator.deviceMemory && navigator.deviceMemory < 4) why.push('memory');
    if (navigator.connection && navigator.connection.saveData) why.push('data saver');
    if (matchMedia('(prefers-reduced-transparency: reduce)').matches) why.push('reduce transparency');
    try {
      const g = document.createElement('canvas').getContext('webgl2');
      if (!g) why.push('webgl2');
      else {
        const d = g.getExtension('WEBGL_debug_renderer_info'); gpu = d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
        if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)) why.push('no gpu');
        const lc = g.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
      }
    } catch (e) { why.push('webgl2'); }
    try { if (localStorage.getItem(SLOW)) why.push('too slow'); } catch (e) {}
    if (Q === '1') why.length = 0;
    if (Q === '0') why.push('off by link');
    verdict = { ok: !why.length, why, gpu, forced: Q === '1' };
    return verdict;
  }
  const REASON = { browser: 'needs Chrome, Edge or another Chromium browser', cpu: 'this device is too slow for it', memory: 'this device is too slow for it', 'data saver': 'Data saver is on',
    'reduce transparency': 'Reduce transparency is on in your system settings', webgl2: 'this browser has no WebGL2', 'no gpu': 'no graphics chip is available', 'too slow': 'it was too slow here last time', 'off by link': 'turned off by the link' };

  // ---------- state ----------
  let lg = null, cv = null, on = false, sig = '', raf = 0, until = 0, walls = {}, wallKey = '', timings = [], ro = null, mo = null;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  const wantOn = () => GB.prefs.accent === 'glass' && check().ok;

  function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('could not load ' + src)); document.head.append(s); }); }
  function wall(night) {
    const k = night ? 'night' : 'day'; if (walls[k]) return walls[k];
    // wallpapers ship inside js/glass-walls.js (data URLs): same file online and offline, and WebGL can always read them
    return walls[k] = (window.GB_GLASS_WALLS ? Promise.resolve() : loadScript('js/glass-walls.js')).then(() => new Promise((ok, no) => {
      const im = new Image(); im.decoding = 'async'; im.onload = () => ok(im); im.onerror = () => no(new Error('wallpaper'));
      im.src = window.GB_GLASS_WALLS[k]; }));
  }

  async function start() {
    if (on) return; on = true; H.classList.add('glass');
    try {
      const night = !!GB.prefs.night;
      const [, im] = await Promise.all([window.LGX ? null : loadScript('js/lgx.bundle.js'), wall(night)]);
      if (!on) return;
      if (!cv) {
        cv = h('canvas#glassFx', { 'aria-hidden': 'true' }); document.body.prepend(cv);
        cv.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('lost'); });
      }
      cv.hidden = false;
      if (!lg) lg = new window.LGX.LiquidGlass(cv, { appearance: night ? 'dark' : 'light' });
      setWall(night, im); observe(); kick(400);
    } catch (e) { console.warn('Glass is off:', e); fail('error'); }
  }
  function stop() {
    if (!on) return; on = false; H.classList.remove('glass', 'glass-live'); unobserve();
    if (cv) cv.hidden = true; sig = '';
  }
  function fail(kind) {
    stop();
    if (kind === 'slow' || kind === 'lost') { try { localStorage.setItem(SLOW, kind); } catch (e) {} verdict = null; }
    if (GB.prefs.accent === 'glass' && GB.ui && GB.ui.toast) GB.ui.toast('Glass is off on this device, using Tulasi green', 3500);
    GB.applyAccent && GB.applyAccent();
  }
  function setWall(night, im) {
    const k = night ? 'night' : 'day'; if (wallKey === k) return;
    wallKey = k; lg.appearance = night ? 'dark' : 'light'; lg.setBackdrop(im, 'cover'); sig = '';
  }

  // ---------- which surfaces are glass ----------
  function rect(el) {
    if (!el || !el.isConnected) return null;
    const b = el.getBoundingClientRect(); if (b.width < 12 || b.height < 12) return null;
    if (b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight) return null;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    return { x: Math.round(b.left * 2) / 2, y: Math.round(b.top * 2) / 2, w: Math.round(b.width * 2) / 2, h: Math.round(b.height * 2) / 2, radius: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, b.height / 2, b.width / 2) };
  }
  function surfaces() {
    const S = [], desk = H.classList.contains('desk'), reading = document.body.classList.contains('reading');
    const add = (el, style) => { const r = rect(el); if (r) { r.style = style; S.push(r); } };
    if (desk) {
      add(document.getElementById('rail'), 'regular');
      add(document.getElementById('left'), 'regular');
    } else if (!reading) {
      add(document.getElementById('left'), 'regular');
      const top = GB.left && GB.left.top && GB.left.top(); add(top && top.el && top.el.querySelector(':scope > .hdr'), 'regular');
      if (document.body.classList.contains('at-home')) add(document.getElementById('rail'), 'regular');
    }
    return S;
  }

  // ---------- drawing: only when a surface moved or changed ----------
  function frame(now) {
    raf = 0; if (!on || !lg) return;
    const W = Math.round(innerWidth * dpr()), Hh = Math.round(innerHeight * dpr());
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; sig = ''; }
    const night = !!GB.prefs.night;
    if ((night ? 'night' : 'day') !== wallKey && !frame.busy) { frame.busy = true; wall(night).then(im => { frame.busy = false; if (on) { try { setWall(night, im); } catch (e) { fail('error'); return; } kick(50); } }).catch(() => { frame.busy = false; fail('error'); }); }
    const S = surfaces(); const s = W + 'x' + Hh + '|' + wallKey + '|' + JSON.stringify(S);
    if (s !== sig) {
      sig = s; const t0 = performance.now();
      try { lg.render(S, dpr()); } catch (e) { console.warn('Glass render failed:', e); fail('error'); return; }
      if (timings.length < 4) { lg.gl.finish(); timings.push(performance.now() - t0); if (timings.length === 4 && !check().forced) { const m = timings.slice(1).sort((a, b) => a - b)[1]; if (m > 70) { fail('slow'); return; } } }
      H.classList.add('glass-live');
    }
    if (now < until) raf = requestAnimationFrame(frame);
  }
  // keep checking for a short while (layout transitions move things without a DOM change)
  function kick(ms) { until = Math.max(until, performance.now() + (ms || 0)); if (!raf && on) raf = requestAnimationFrame(frame); }
  const onLayout = () => kick(320);
  function observe() {
    window.addEventListener('resize', onLayout); window.addEventListener('gb:layout', onLayout); document.addEventListener('gb:pref', onLayout);
    if (!ro) ro = new ResizeObserver(onLayout);
    for (const id of ['app', 'rail', 'left', 'reader']) { const e = document.getElementById(id); if (e) ro.observe(e); }
    if (!mo) mo = new MutationObserver(onLayout);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    mo.observe(document.getElementById('left'), { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
    mo.observe(document.getElementById('rail'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  function unobserve() {
    window.removeEventListener('resize', onLayout); window.removeEventListener('gb:layout', onLayout); document.removeEventListener('gb:pref', onLayout);
    if (ro) ro.disconnect(); if (mo) mo.disconnect();
  }

  // ---------- public ----------
  GB.glass = {
    check, active: () => on, sync: () => (wantOn() ? start() : stop()),
    reason() { const v = check(); return v.ok ? '' : (REASON[v.why[0]] || v.why[0]); },
    retry() { try { localStorage.removeItem(SLOW); } catch (e) {} verdict = null; timings = []; }
  };
  document.addEventListener('gb:pref', e => { if (e.detail && e.detail.k === 'accent' && !GB.prefs.accentPicked) { GB.prefs.accentPicked = true; GB.savePrefs(); } });
  const sa = GB.setAccent;
  GB.setAccent = function (k) { GB.prefs.accentPicked = true; if (k === 'glass') GB.glass.retry(); sa(k); };
  const aa = GB.applyAccent;
  GB.applyAccent = function () { aa(); GB.glass.sync(); };
})(window.GB);
