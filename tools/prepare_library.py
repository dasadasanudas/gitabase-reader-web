#!/usr/bin/env python3
"""Prepare gitabase files for the hosted (GitHub Pages) Gitabase Reader.

For every .db / .gitabase in the input folder: copy it, add the indexes the reader uses (the Android app adds
the same ones on first open), VACUUM, then split the file into fixed-size chunks so the browser downloads only
the pages it reads. Writes <out>/catalog.json, which the app loads automatically when served over http(s).
Each catalog entry also carries "meta" (tables, books, songs, chapters ... see gb_meta.py), so the reader can
list the whole library without opening any database, and "search" (a prebuilt word index, see gb_index.py).

usage: python tools/prepare_library.py databases site/library [--chunk 262144]
"""
import json, os, re, shutil, sqlite3, sys, tempfile, hashlib, argparse, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from gb_meta import build_meta
except Exception as _e:   # the catalogue metadata is an extra: without it the reader opens each file itself
    print('gb_meta unavailable:', _e)
    build_meta = lambda con: None

try:
    from gb_index import build_index
except Exception as _e:   # the word index is an extra: without it search uses the file's own full-text index
    print('gb_index unavailable:', _e)
    build_index = None
INDEX_BUDGET = int(os.environ.get('GB_INDEX_MB', '160')) * 1048576   # all word indexes together, so the hosted site stays small
_index_used = 0

INDEXES = [
    ('textnums', ['book_id', 'song', 'ch_no', 'text_seq_no']),
    ('image_nums', ['bid', 'kind']), ('image_nums', ['book_id']), ('images', ['image_id']),
    ('meanings', ['name']), ('meanings', ['link']), ('meanings', ['txt_id']), ('links', ['link']), ('links', ['word']), ('eind', ['link']),
    ('textrefs', ['thisBookWeb', 'thisSong', 'thisChapter', 'thisTextNo']), ('textrefs', ['thisBook']), ('textrefs', ['txt_id']),
    ('chapters', ['book_id']), ('songs', ['book_id']),
]

def cols(con, table):
    try: return [r[1] for r in con.execute('PRAGMA table_info("%s")' % table)]
    except sqlite3.Error: return []

def strip(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)
    return s.replace('&nbsp;', ' ').replace('&amp;', '&')

def fold(s):
    return re.sub(r'[\u0300-\u036f]', '', unicodedata.normalize('NFD', s)).lower()

def build_wbw(con):
    """Word-by-word headword table for files without a meanings table: the same parse the reader does in the
    browser for local files, stored with an index so the hosted site never has to read every text."""
    if not cols(con, 'texts') or 'transl1' not in cols(con, 'texts'): return 0
    if cols(con, 'meanings'):
        try:
            if con.execute('SELECT 1 FROM meanings LIMIT 1').fetchone(): return 0
        except sqlite3.Error: pass
    con.execute('DROP TABLE IF EXISTS gbweb_wbw')
    con.execute('CREATE TABLE gbweb_wbw (k TEXT, f TEXT, txt_id INTEGER, mean TEXT)')
    cnt, out = {}, []
    for _id, t1 in con.execute("SELECT _id, transl1 FROM texts WHERE transl1 IS NOT NULL AND length(transl1) > 0 ORDER BY _id"):
        t = strip(str(t1 or ''))
        if '\u2014' not in t and ' - ' not in t: continue
        for part in re.split(r';\s*', t):
            m = re.split(r'\s*\u2014\s*|\s+-\s+', part)
            if len(m) < 2: continue
            words = unicodedata.normalize('NFC', m[0].strip())
            mean = re.sub(r'[.\u0964]+$', '', ' \u2014 '.join(m[1:]).strip())
            if not words or len(words) > 60: continue
            for w in [words] + (words.split('-') if '-' in words else []):
                k = w.strip().lower()
                if not k: continue
                cnt[k] = cnt.get(k, 0) + 1
                if cnt[k] > 3000: continue
                out.append((k, fold(k), _id, mean if w == words else words + ' \u2014 ' + mean))
    con.executemany('INSERT INTO gbweb_wbw VALUES (?,?,?,?)', out)
    con.execute('CREATE INDEX gbweb_wbw_k ON gbweb_wbw (k)')
    con.execute('CREATE INDEX gbweb_wbw_f ON gbweb_wbw (f)')
    return len(out)

def prepare(src, tmp):
    shutil.copyfile(src, tmp)
    con = sqlite3.connect(tmp)
    made = []
    for table, cs in INDEXES:
        have = cols(con, table)
        if not have or not all(c in have for c in cs): continue
        name = 'gbweb_%s_%s' % (table, '_'.join(cs))
        con.execute('CREATE INDEX IF NOT EXISTS "%s" ON "%s" (%s)' % (name, table, ', '.join('"%s"' % c for c in cs)))
        made.append(name)
    wbw = build_wbw(con)
    if wbw: made.append('gbweb_wbw(%d rows)' % wbw)
    con.commit()
    con.execute('PRAGMA journal_mode=DELETE')
    con.execute('VACUUM')
    books = [r[0] for r in con.execute('SELECT title FROM books ORDER BY sort, _id')] if cols(con, 'books') else []
    try: meta = build_meta(con)
    except Exception as e: print('meta skipped:', e); meta = None
    con.close()
    return made, books, meta

def main():
    global _index_used
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('--chunk', type=int, default=262144)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    files = []
    for name in sorted(os.listdir(a.src)):
        if not name.lower().endswith(('.db', '.gitabase', '.sqlite', '.sqlite3')): continue
        path = os.path.join(a.src, name)
        with open(path, 'rb') as f:
            if f.read(15) != b'SQLite format 3': print('skip (not SQLite):', name); continue
        fid = hashlib.sha1(name.encode()).hexdigest()[:10]
        tmp = os.path.join(tempfile.gettempdir(), 'gbweb_' + fid + '.db')
        made, books, meta = prepare(path, tmp)
        # chunk folders carry a content hash, so a changed file gets new URLs (no stale browser or offline cache)
        h = hashlib.sha256()
        with open(tmp, 'rb') as f:
            for blk in iter(lambda: f.read(1 << 20), b''): h.update(blk)
        digest = h.hexdigest()
        for x in os.listdir(a.out):
            if x == fid or x.startswith(fid + '-'): shutil.rmtree(os.path.join(a.out, x), ignore_errors=True)
        d = os.path.join(a.out, fid + '-' + digest[:12]); os.makedirs(d)
        size = os.path.getsize(tmp); n = 0
        with open(tmp, 'rb') as f:
            while True:
                b = f.read(a.chunk)
                if not b: break
                with open(os.path.join(d, '%05d.bin' % n), 'wb') as o: o.write(b)
                n += 1
        search = None
        if build_index:
            try:
                idir = d + '-idx'
                st = build_index(tmp, idir)
                if st and _index_used + st['bytes'] <= INDEX_BUDGET:
                    _index_used += st['bytes']
                    final = d + '-' + st['hash'] + '-idx'      # the folder name changes whenever the index does (browser cache)
                    os.rename(idir, final)
                    search = {'v': 1, 'dir': os.path.basename(final) + '/', 'shards': st['shards'], 'bytes': st['bytes'], 'docs': st['docs']}
                else:
                    shutil.rmtree(idir, ignore_errors=True)
                    if st: print('word index for %s skipped: %d bytes would exceed the budget' % (name, st['bytes']))
            except Exception as e:
                print('word index skipped:', e); shutil.rmtree(d + '-idx', ignore_errors=True)
        os.remove(tmp)
        rel = os.path.relpath(d, os.path.dirname(os.path.abspath(a.out))).replace(os.sep, '/')
        entry = {'id': fid, 'name': name, 'size': size, 'chunkSize': a.chunk, 'chunks': n, 'base': rel + '/', 'sha256': digest, 'books': books}
        if meta: entry['meta'] = meta
        if search: entry['search'] = search
        files.append(entry)
        print('%s: %d bytes, %d chunks, %d indexes, meta %s, word index %s, books: %s' % (name, size, n, len(made), 'yes' if meta else 'no', 'yes' if search else 'no', ', '.join(books)))
    with open(os.path.join(a.out, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'files': files}, f, ensure_ascii=False, indent=1)
    print('catalog:', len(files), 'file(s)')

if __name__ == '__main__': main()
