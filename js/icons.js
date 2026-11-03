/* Icon set. Home tabs use drawn icons in place of the APK's calligraphic letters (L F Q N T D);
   the rest of the UI keeps the APK's own PNG icons. All strokes use currentColor. */
'use strict';
(function (GB) {
  const S = (body, vb) => '<svg viewBox="' + (vb || '0 0 32 32') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  const P = {
    // L: My Library (books on a shelf)
    lib: S('<rect x="4.5" y="8" width="5.5" height="18" rx="1"/><rect x="10" y="5" width="5.5" height="21" rx="1"/><path d="M17.2 9.2l4.9-1.7 5.8 16.8-4.9 1.7z"/><path d="M4.5 12h5.5M10 9h5.5M10 22h5.5M4.5 22.5h5.5"/><path d="M2.5 27.5h27"/>'),
    // F: Favourite texts and quotes (the app's garland: a heart of beads)
    fav: S('<path d="M16 25.5C8.6 20.2 4.2 16 4.2 11.6a5.6 5.6 0 0 1 11.8-2.5 5.6 5.6 0 0 1 11.8 2.5c0 4.4-4.4 8.6-11.8 13.9z" stroke-width="2.7" stroke-dasharray="0 3.15"/><path d="M16 25.6v3.2M14.4 29.2h3.2" stroke-width="1.6"/>'),
    // Q: Questions (speech bubble with a question mark)
    quest: S('<path d="M6.5 5.5h19a2.5 2.5 0 0 1 2.5 2.5v11.5a2.5 2.5 0 0 1-2.5 2.5H14l-6 5v-5H6.5A2.5 2.5 0 0 1 4 19.5V8a2.5 2.5 0 0 1 2.5-2.5z"/><path d="M13.1 11.1a3 3 0 1 1 4.3 2.7c-.9.5-1.4 1.1-1.4 2v.5"/><circle cx="16" cy="18.9" r=".9" fill="currentColor" stroke="none"/>'),
    // N: Notes (page with lines and a quill)
    note: S('<path d="M7 4.5h11.5l6 6V27.5H7z"/><path d="M18.5 4.5v6h6"/><path d="M10.5 15h10M10.5 19h10M10.5 23h6"/><path d="M29 13.5c-2.8.6-5.6 3.6-7.6 8.3l-.8 2.4 2-1.5c3.3-2.4 5.5-5.6 6.4-9.2z" stroke-width="1.5"/>'),
    // T: Bookmark Topics (folder with a #tag)
    topic: S('<path d="M3.8 9.2A2.2 2.2 0 0 1 6 7h6.2l3 3H26a2.2 2.2 0 0 1 2.2 2.2v11.6A2.2 2.2 0 0 1 26 26H6a2.2 2.2 0 0 1-2.2-2.2z"/><path d="M14.2 13.5l-1.3 9M19.2 13.5l-1.3 9M11.6 16.3h9.2M11 19.8h9.2"/>'),
    // D: Gitabase Dictionary (open lexicon)
    dict: S('<path d="M16 8.8C13 6.9 9 6.4 3.5 6.9v17.6C9 24 13 24.6 16 26.5c3-1.9 7-2.5 12.5-2V6.9C23 6.4 19 6.9 16 8.8z"/><path d="M16 8.8v17.7"/><path d="M6.8 19.6l2.6-7.4 2.6 7.4M7.8 17.2h3.3"/><path d="M19.2 12.6h6M19.2 16h6M19.2 19.4h4"/>'),
    // other UI
    back: S('<path d="M20 6L10 16l10 10"/>'),
    fwd: S('<path d="M12 6l10 10-10 10"/>'),
    close: S('<path d="M8 8l16 16M24 8L8 24"/>'),
    more: S('<circle cx="16" cy="7" r="1.6" fill="currentColor"/><circle cx="16" cy="16" r="1.6" fill="currentColor"/><circle cx="16" cy="25" r="1.6" fill="currentColor"/>'),
    search: S('<circle cx="13.5" cy="13.5" r="8"/><path d="M19.5 19.5l7.5 7.5" stroke-width="2.6"/>'),
    history: S('<path d="M5.5 16a10.5 10.5 0 1 0 3.1-7.4"/><path d="M5 5.5v4.6h4.6"/><path d="M16 10v6.5l4.2 2.6"/>'),
    gear: S('<circle cx="16" cy="16" r="4"/><path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4M7.2 7.2l2.8 2.8M22 22l2.8 2.8M7.2 24.8L10 22M22 10l2.8-2.8"/><circle cx="16" cy="16" r="8.5"/>'),
    moon: S('<path d="M25.5 19.8A10.5 10.5 0 0 1 12.2 6.5a10.5 10.5 0 1 0 13.3 13.3z"/>'),
    sun: S('<circle cx="16" cy="16" r="5.5"/><path d="M16 3v3.5M16 25.5V29M3 16h3.5M25.5 16H29M6.8 6.8l2.5 2.5M22.7 22.7l2.5 2.5M6.8 25.2l2.5-2.5M22.7 9.3l2.5-2.5"/>'),
    plus: S('<path d="M16 6v20M6 16h20"/>'),
    check: S('<path d="M6 16.5l6.5 6.5L26 9.5"/>'),
    trash: S('<path d="M6 9h20M13 9V6h6v3M8.5 9l1.3 17h12.4L23.5 9"/><path d="M13.5 13.5v8.5M18.5 13.5v8.5"/>'),
    edit: S('<path d="M6 26l1.2-5.4L21.5 6.3a2.4 2.4 0 0 1 3.4 0l.8.8a2.4 2.4 0 0 1 0 3.4L11.4 24.8z"/><path d="M19 8.8l4.2 4.2"/>'),
    folder: S('<path d="M3.8 9.2A2.2 2.2 0 0 1 6 7h6.2l3 3H26a2.2 2.2 0 0 1 2.2 2.2v11.6A2.2 2.2 0 0 1 26 26H6a2.2 2.2 0 0 1-2.2-2.2z"/>'),
    file: S('<path d="M8 4h11l6 6v18H8z"/><path d="M19 4v6h6"/>'),
    upload: S('<path d="M16 21V6M9.5 12.5L16 6l6.5 6.5"/><path d="M6 22v4h20v-4"/>'),
    expand: S('<path d="M5 12V5h7M27 12V5h-7M5 20v7h7M27 20v7h-7"/>'),
    shrink: S('<path d="M12 5v7H5M20 5v7h7M12 27v-7H5M20 27v-7h7"/>'),
    swap: S('<path d="M6 11h19l-5-5M26 21H7l5 5"/>'),
    sync: S('<path d="M10 5v22M22 5v22"/><path d="M6.5 9.5L10 5.5l3.5 4M18.5 22.5l3.5 4 3.5-4"/>'),
    link: S('<path d="M13.5 18.5a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M18.5 13.5a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l1.5-1.5"/>'),
    open: S('<path d="M18 5h9v9M27 5L15 17"/><path d="M24 19v8H5V8h8"/>'),
    share: S('<circle cx="23" cy="7.5" r="3.5"/><circle cx="9" cy="16" r="3.5"/><circle cx="23" cy="24.5" r="3.5"/><path d="M12 14.2l8-4.6M12 17.8l8 4.6"/>'),
    copy: S('<rect x="10" y="10" width="16" height="17" rx="2"/><path d="M6 21V7a2 2 0 0 1 2-2h12"/>'),
    marker: S('<path d="M8 26h16"/><path d="M11.5 21.5l-1-4.5L21 6.5l4.5 4.5L15 21.5z"/><path d="M10.5 17l4.5 4.5"/>'),
    comment: S('<path d="M5 7h22v14H15l-6 5v-5H5z"/><path d="M10 12.5h12M10 16h8"/>'),
    quote: S('<path d="M7 21c0-5 1.8-8.4 5.5-10.5M7 21a3 3 0 1 0 3-3M18 21c0-5 1.8-8.4 5.5-10.5M18 21a3 3 0 1 0 3-3"/>'),
    tag: S('<path d="M5 5h10l12 12-10 10L5 15z"/><circle cx="10.5" cy="10.5" r="1.6"/>'),
    star: S('<path d="M16 4.5l3.5 7.2 7.9 1.1-5.7 5.6 1.4 7.9L16 22.6l-7.1 3.7 1.4-7.9-5.7-5.6 7.9-1.1z"/>'),
    vertical: S('<rect x="9" y="4" width="14" height="24" rx="2"/><path d="M16 9v14M13 12l3-3 3 3M13 20l3 3 3-3"/>'),
    horizontal: S('<rect x="4" y="9" width="24" height="14" rx="2"/><path d="M9 16h14M12 13l-3 3 3 3M20 13l3 3-3 3"/>'),
    image: S('<rect x="4" y="6" width="24" height="20" rx="2"/><circle cx="11" cy="12" r="2.2"/><path d="M4 23l7-7 5 5 4-4 8 8"/>'),
    font: S('<path d="M4 25l7-18 7 18M6.7 18.5h8.6"/><path d="M20 25l4.5-11 4.5 11M21.7 21h5.6"/>'),
    book: S('<path d="M7 5h15a3 3 0 0 1 3 3v19H10a3 3 0 0 1-3-3z"/><path d="M7 24a3 3 0 0 1 3-3h15"/>'),
    list: S('<path d="M11 8h16M11 16h16M11 24h16"/><circle cx="5.5" cy="8" r="1.3" fill="currentColor"/><circle cx="5.5" cy="16" r="1.3" fill="currentColor"/><circle cx="5.5" cy="24" r="1.3" fill="currentColor"/>'),
    info: S('<circle cx="16" cy="16" r="12"/><path d="M16 14.5v8"/><circle cx="16" cy="10" r="1.2" fill="currentColor" stroke="none"/>'),
    db: S('<ellipse cx="16" cy="7.5" rx="10" ry="3.5"/><path d="M6 7.5v17c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5v-17"/><path d="M6 13.5c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5M6 19.5c0 1.9 4.5 3.5 10 3.5s10-1.6 10-3.5"/>'),
    backup: S('<path d="M9 24a6 6 0 0 1-.6-12A8 8 0 0 1 24 10.5a5.5 5.5 0 0 1-.5 11"/><path d="M16 27V15M12 19l4-4 4 4"/>'),
    restore: S('<path d="M9 22a6 6 0 0 1-.6-12A8 8 0 0 1 24 8.5a5.5 5.5 0 0 1-.5 11"/><path d="M16 13v13M12 22l4 4 4-4"/>'),
    sanskrit: S('<path d="M5 9h22M10 9v4a4 4 0 0 0 8 0M18 9v15M13 18c2.5 0 4 1.6 4 3.5S15.5 25 13 25"/>'),
    wbw: S('<path d="M5 9h9M5 15h6M5 21h9M18 9h9M18 15h9M18 21h6"/>'),
    drawer: S('<path d="M5 8h22M5 16h22M5 24h22"/>')
  };
  GB.icons = { svg: name => P[name] || '', has: name => !!P[name] };
})(window.GB);
