"""Catalogue metadata for Gitabase Reader web.

build_meta(con) returns everything the reader normally learns by opening a database and running about ten
small queries (tables and columns, books, songs, chapters, language samples, image counts). It is stored in
catalog.json, so the browser can show the library without opening any of the big files; a file is only opened
(lazily, once) when someone actually reads from it. The SQL here mirrors js/library.js openDb exactly.
Anything that fails returns None, and the reader then falls back to opening the file the old way.
"""
import sqlite3

def _val(v):
    if isinstance(v, (bytes, bytearray, memoryview)): return None
    return v

def _rows(con, sql, binds=()):
    cur = con.execute(sql, binds)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, (_val(v) for v in r))) for r in cur.fetchall()]

def build_meta(con):
    try:
        con.row_factory = None
        tables, idx = {}, []
        for name, typ, sql in con.execute("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view','index')").fetchall():
            if typ == 'index': idx.append(str(sql or '')); continue
            # the browser's SQLite has no fts3 module, so a virtual table reads as having no columns there
            if sql and str(sql).lstrip().upper().startswith('CREATE VIRTUAL'): tables[name] = []; continue
            try: tables[name] = [r[1] for r in con.execute('PRAGMA table_info("%s")' % name)]
            except sqlite3.Error: tables[name] = []
        if idx: tables['__idx'] = idx
        has = lambda t, c=None: t in tables and (c is None or c in tables[t])
        if not has('books'): return None
        meta = {'v': 1, 'tables': tables}
        locale = ''
        try:
            r = con.execute('SELECT locale FROM android_metadata LIMIT 1').fetchone()
            locale = (r[0] if r else '') or ''
        except sqlite3.Error: pass
        meta['locale'] = locale
        bc = tables['books']
        meta['books'] = _rows(con, 'SELECT ' + ','.join('"%s"' % c for c in bc) + ' FROM books ORDER BY sort, _id')
        sample = []
        try: sample = [r[0] for r in con.execute('SELECT substr(transl2,1,400) AS t FROM texts WHERE length(transl2) > 20 LIMIT 6 OFFSET 3')]
        except sqlite3.Error: pass
        meta['sample'] = [s for s in sample if s]
        ent = False
        try:
            r = con.execute("SELECT translit || comment AS t FROM texts WHERE length(comment) > 50 LIMIT 1 OFFSET 5").fetchone()
            import re
            ent = bool(r and r[0] and re.search(r'&#\d+;', r[0]))
        except sqlite3.Error: pass
        meta['entityMode'] = ent
        meta['songs'] = _rows(con, 'SELECT * FROM songs ORDER BY book_id, sort, _id') if has('songs') else []
        meta['chapters'] = _rows(con, 'SELECT _id, book_id, song, number, title, text_size, purport_size, prev_size_t, prev_size_p FROM chapters ORDER BY book_id, _id') if has('chapters') else []
        fts = False
        try: con.execute('SELECT level, idx, start_block, leaves_end_block, end_block, root FROM textindex_segdir').fetchall(); fts = True
        except sqlite3.Error: pass
        meta['hasFts'] = fts
        img = []
        if has('image_nums'):
            try:
                b = 'bid' if has('image_nums', 'bid') else 'book_id'
                k = 'kind' if has('image_nums', 'kind') else '1'
                img = _rows(con, 'SELECT %s AS b, %s AS k, count(*) AS n FROM image_nums GROUP BY 1, 2' % (b, k))
            except sqlite3.Error: img = []
        meta['imgRows'] = img
        # ebooks without chapter rows (TLC, NOD ...): their chapters are built from the text rows, so ship that list too
        noch = {}
        if has('textnums', 'book_id'):
            have = set()
            if has('chapters', 'book_id'):
                try: have = {r[0] for r in con.execute('SELECT DISTINCT book_id FROM chapters')}
                except sqlite3.Error: pass
            for b in meta['books']:
                if b.get('_id') in have or str(b.get('_id')) in {str(x) for x in have}: continue
                try:
                    noch[str(b['_id'])] = [list(r) for r in con.execute('SELECT song, ch_no, count(*) AS n FROM textnums WHERE book_id IN (?, ?) GROUP BY song, ch_no ORDER BY song, ch_no', (b['_id'], str(b['_id'])))]
                except sqlite3.Error: pass
        meta['noch'] = noch
        return meta
    except Exception as e:
        print('meta skipped:', e)
        return None
