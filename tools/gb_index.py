"""Compact word index for Gitabase Reader web.

The reader's own FTS3 reader has to walk b-tree blocks inside a 500 MB file, one 256 KB download at a time, for
every word of every query. This builds the same word -> documents map once, at build time, as small gzip shards
that the browser fetches in parallel (a typical word is one request of 20-200 KB).

Input: the file's textindex_content table (docid, c1book_id, c2song, c3ch_no, c4txt_no, c5translit, c6transl2, c7comment),
the very text the FTS index was built from (files without FTS get a view of that name, see prepare_library.py). Tokens
follow SQLite's "simple" tokenizer exactly (ASCII letters/digits and every non-ASCII character are word characters, only
ASCII is lower-cased), so a word means the same here as in FTS.

Output folder:
  dir.json   {"v":1,"cols":[1,5,6,7],"docs":N,"n":shards,"first":[first term of each shard],
              "loc":rows,"chunk":size,"locv":2,"hot":[chunks],"refs":{"n":shards,"first":[first docid of each]}}
  s0000.gz.. gzip of: repeat{ varint len, term(utf-8), varint ndocs, varint nbytes, postings }
             postings = repeat{ varint (docid_delta<<4 | colmask), varint tf }   colmask bits: 1=c1 2=c5 4=c6 8=c7
  loc2.gz    which file chunks hold each docid's row, and "hot" = chunks every row lookup needs (see gb_locmap.py;
             a new name, so an older app that reads the version-1 loc.gz finds nothing and simply skips its prefetch)
  r0000.gz.. where each docid is: one line per docid, "docid_delta TAB book TAB song TAB chapter TAB text", a field
             left empty when it is the same as the line before, "~" for a real empty value (the first line of a shard
             has the full docid), so a results page can show "SB 1.2.6 · chapter title" before the database is opened
Terms are sorted in UTF-16 code unit order (the order JavaScript compares strings in).
"""
import gzip, hashlib, json, os, re, sqlite3, time
from collections import Counter

TOK = re.compile('[0-9A-Za-z\u0080-\U0010ffff]+')
LOWER = {i: i + 32 for i in range(65, 91)}
COLS = [('c1book_id', 1), ('c5translit', 2), ('c6transl2', 4), ('c7comment', 8)]
REF_COLS = ['c1book_id', 'c2song', 'c3ch_no', 'c4txt_no']
SHARD = 190 * 1024
REF_SHARD = 4096                    # docids per reference shard (a few KB of gzip each)

def varint(n, out):
    while n > 127:
        out.append((n & 127) | 128); n >>= 7
    out.append(n)

def tokens(v):
    if v is None: return []
    if isinstance(v, (bytes, bytearray)): v = bytes(v).decode('utf-8', 'replace')
    return [t.translate(LOWER) for t in TOK.findall(str(v))]

def _field(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).replace('\t', ' ').replace('\n', ' ')

def build_index(db_path, out_dir, chunk=262144, log=print):
    con = sqlite3.connect(db_path)
    try: have = [r[1] for r in con.execute('PRAGMA table_info("textindex_content")')]
    except sqlite3.Error: have = []
    cols = [(c, b) for c, b in COLS if c in have]
    if not cols: return None
    key = 'docid' if 'docid' in have else 'rowid'      # a real FTS table: rowid; the view made for files without FTS: docid
    refc = REF_COLS if all(c in have for c in REF_COLS) else None
    sel = ', '.join('"%s"' % c for c, _ in cols) + (', ' + ', '.join('"%s"' % c for c in refc) if refc else '')
    posts = {}                      # term -> [bytearray, last docid, count]
    refs = []                       # (docid, book, song, chapter, text)
    docs = 0; t0 = time.time()
    for row in con.execute('SELECT %s, %s FROM textindex_content ORDER BY %s' % (key, sel, key)):
        docid = row[0]; docs += 1
        mask, tf = {}, {}
        for (c, bit), v in zip(cols, row[1:1 + len(cols)]):
            for t, n in Counter(tokens(v)).items():
                mask[t] = mask.get(t, 0) | bit
                if bit != 1: tf[t] = tf.get(t, 0) + n
        for t, m in mask.items():
            p = posts.get(t)
            if p is None: p = posts[t] = [bytearray(), 0, 0]
            varint(((docid - p[1]) << 4) | m, p[0]); varint(min(tf.get(t, 1), 100000), p[0])
            p[1] = docid; p[2] += 1
        if refc: refs.append((docid,) + tuple(_field(x) for x in row[1 + len(cols):]))
    log('index: %d docs, %d terms, %.0fs' % (docs, len(posts), time.time() - t0))
    con.close()
    os.makedirs(out_dir, exist_ok=True)
    terms = sorted(posts, key=lambda s: s.encode('utf-16-be', 'surrogatepass'))
    first, buf, n, total = [], bytearray(), 0, 0
    hsh = hashlib.sha1()
    def write(name, data):
        nonlocal total
        with open(os.path.join(out_dir, name), 'wb') as f: f.write(data)
        hsh.update(name.encode()); hsh.update(data); total += len(data)
    def flush():
        nonlocal buf, n
        if not buf: return
        write('s%04d.gz' % n, gzip.compress(bytes(buf), 9, mtime=0)); n += 1; buf = bytearray()
    for t in terms:
        p = posts[t]; tb = t.encode('utf-8', 'surrogatepass')
        if len(buf) and len(buf) + len(p[0]) > SHARD: flush()
        if not buf: first.append(t)
        varint(len(tb), buf); buf += tb; varint(p[2], buf); varint(len(p[0]), buf); buf += p[0]
        posts[t] = None
    flush()
    meta = {'v': 1, 'cols': [b for _, b in cols], 'docs': docs, 'n': n, 'first': first}
    if refs:                        # docid -> book, song, chapter, text number
        rfirst = []
        for k in range(0, len(refs), REF_SHARD):
            part = refs[k:k + REF_SHARD]; lines = []; prev = None
            for r in part:
                if prev is None: f = [str(r[0])] + [x if x != '' else '~' for x in r[1:]]
                else: f = [str(r[0] - prev[0]) if r[0] - prev[0] != 1 else ''] + [('~' if x == '' else x) if x != prev[i + 1] or i == 3 else '' for i, x in enumerate(r[1:])]
                lines.append('\t'.join(f)); prev = r
            write('r%04d.gz' % len(rfirst), gzip.compress('\n'.join(lines).encode('utf-8'), 9, mtime=0)); rfirst.append(part[0][0])
        meta['refs'] = {'n': len(rfirst), 'first': rfirst}
    try:                            # which file chunks hold each result row (loc.gz), so the browser can fetch them in parallel
        from gb_locmap import build_locmap
        lm = build_locmap(db_path, chunk)
        if lm:
            write('loc2.gz', gzip.compress(lm[0], 9, mtime=0)); meta['loc'] = lm[1]; meta['chunk'] = chunk; meta['locv'] = 2; meta['hot'] = lm[2]
    except Exception as e: log('row locations skipped: %s' % e)
    txt = json.dumps(meta, ensure_ascii=False, separators=(',', ':')); hsh.update(txt.encode('utf-8'))
    with open(os.path.join(out_dir, 'dir.json'), 'w', encoding='utf-8') as f: f.write(txt)
    log('index: %d shards, %d ref shards, %d hot chunks, %.1f MB gzip' % (n, len(meta.get('refs', {}).get('first', [])), len(meta.get('hot', [])), total / 1048576))
    return {'shards': n, 'bytes': total, 'docs': docs, 'terms': len(terms), 'hash': hsh.hexdigest()[:8]}
