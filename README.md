# Gitabase Reader · web

A web recreation of **Gitabase Reader 9** for Android: same library, book, chapter and text screens, the same
day/night themes, menus and settings, rebuilt from the APK. It reads the app's own gitabase files (`.db` /
`.gitabase`, SQLite) and works fully offline.

## Use it offline
1. Unzip and double-click `index.html` (Chrome, Edge or Firefox).
2. **L › My books › Add gitabase files**, or drop the files onto the window. Files are kept in this browser
   (IndexedDB) and read page by page, so even 190 MB gitabases open instantly and never load whole.
3. Notes, highlights, topics, reading list and history also stay in the browser. **Backup notes** saves a
   `.json`; **Restore from backup** can merge or replace (replace asks you to type `gopi`, like the app).

## Host it (GitHub Pages)
1. Put the gitabase files in `databases/` (Git LFS: `git lfs install`; `.gitattributes` already tracks `databases/**`).
2. Push to `main`, and set **Settings › Pages › Source: GitHub Actions**. The workflow copies the app into `site/`
   and runs `tools/prepare_library.py`, which adds the indexes the reader uses, VACUUMs, splits every file into
   256 KB chunks and writes `library/catalog.json`.
3. The hosted site loads that catalogue automatically (no manual adding there) and downloads only the chunks a
   screen needs. Test locally: `python tools/prepare_library.py databases library && python -m http.server`.

## What's inside
- Home tabs as icons: **L** library (Books / Reading / My books), **F** favourites (all / highlights / quotes /
  texts), **Q** questions, **N** notes (to texts / general), **T** topics (#tags, `a/b` = subtopic), **D** dictionary.
- Book screen with canto picker (All cantos), chapter cards, picture / card / diagram / fresco tabs; chapter text list.
- Text screen: one text per page flowing across chapters; vertical or horizontal (paged, tap zones) reading;
  "Read book from start" (Finished list); side page buttons that only scroll; chapter drawer; Sanskrit /
  word-by-word toggles (table or classic); selection: Copy, +Highlight, +Comment, +Question, +Quote and more.
- Reading direction is fixed by book type (Settings › Fixed direction by book type): books of verses scroll vertically, small
  books page horizontally; switch it off to choose per book. Swipe left/right changes the text (touch, or a mouse drag on the side
  margins) in vertical reading, and turns the page in horizontal reading.
- Verse toolbar: favourite garland, compare and translate (1 = full screen, 2 = side by side with swap,
  Sanskrit toggle, scroll sync, full screen), references (unresolvable ones stay dimmed; a reference opens the
  citing text at the place of the citation), notes.
- Word links open their occurrences (dictionary tables, or the books' word-by-word translations), 40 at a time.
- Citations in a text open the cited text: verse links inside the same book (`gb://pro../../../1/3/43/hi`; when a
  file's link drops the canto, the printed number wins), `gr://eng/texts/bg/7/14`-style links in whichever loaded
  gitabase has that book (the language being read first, then the link's), and a short message when the book is
  not in the library.
- Full-text search using the index inside the gitabase (JS reader for its FTS3 tables), with exact phrase, word
  variants (`adhikar*`), sorting and scope; switch the index off for a slower substring scan.
- Hindi typography: per-block script detection, Tiro Devanagari Hindi for prose, Tiro Devanagari Sanskrit for
  verse, Noto Serif Devanagari for bold, 0.94x size, roomy leading and paragraph spacing, never justified,
  no-break space before danda and before a visarga used as a colon. Toggle: Settings › Match the book's script.
- Keyboard: Left/Right previous/next text, PgUp/PgDn/Space scroll, Esc back.

## Publishing on GitHub Pages (github.com/dasadasanudas/gitabase-reader-web)
The repo's Pages workflow already runs `tools/split_gitabase.py`; that script now hands over to `tools/build_site.py` as soon as
this app is in the repo, and the site switches to it on the next push.

One-time step (the ClickUp GitHub connection can push text files but not fonts/images, and can't edit workflow files):
1. In the repo open the `release` folder, choose **Add file > Upload files**, drop in **this zip** as `gitabase-reader-web.zip`, commit.
   Every deploy unpacks it; files committed at the repo root (`js/`, `css/`, `index.html` …) override what is in the zip,
   so code updates can be pushed as plain files.
2. Optional, recommended: open `.github/workflows/pages.yml` on GitHub, edit, and paste the `pages.yml` from this zip
   (`.github/workflows/pages.yml`). It keeps the prepared library in the Actions cache, so updates that don't touch
   `databases/` stop re-downloading the 213 MB database from Git LFS (free LFS bandwidth is limited).
3. Databases: put `.db` / `.gitabase` files in `databases/` with git + LFS (web uploads stop at 25 MB).

The hosted site loads `library/catalog.json` by itself, reads only the chunks it needs, can be installed from the browser menu
("Install app" / "Add to Home screen") and keeps everything you have opened readable offline.

## Desktop and mobile view
Settings > General > Layout: **Automatic** (desktop view from 900 px wide, mobile view below), **Desktop view** (tabs, list and
text side by side) or **Mobile view** (one screen at a time, tabs at the bottom; on a wide screen it shows as a phone-width column).

## Credits
SQLite 3.54.1 WebAssembly (public domain). Fonts: Roboto, PT Sans Narrow, Tiro Devanagari Hindi/Sanskrit,
Noto Serif Devanagari (SIL OFL); Gaura Times, images and icons from Gitabase Reader.
