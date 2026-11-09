"""Compact word index for Gitabase Reader web.

The reader's own FTS3 reader has to walk b-tree blocks inside a 500 MB file, one 256 KB download at a time, for
every word of every query. This builds the same word -> documents map once, at build time, as small gzip shards
that the browser fetches in parallel (a typical word is one request of 20-200 KB).

Input: the file's textindex_content table (docid, c1book_id, c5translit, c6transl2, c7comment), the very text the
FTS index was built from (files without FTS get a view of that name, see prepare_library.py). Tokens follow SQLite's
"simple" tokenizer exactly (ASCII letters/digits and every non-ASCII character are word characters, only ASCII is
lower-cased), so a word means the same here as in FTS.

Output folder:
  dir.json   {"v":1,"cols":[1,5,6,7],"docs":N,"n":shards,"first":[first term of each shard]}
  s0000.gz.. gzip of: repeat{ varint len, term(utf-8), varint ndocs, varint nbytes, postings }
             postings = repeat{ varint (docid_delta<<4 | colmask), varint tf }   colmask bits: 1=c1 2=c5 4=c6 8=c7
Terms are sorted in UTF-16 code unit order (the order JavaScript compares strings in).
"""
import gzip, hashlib, json, os, re, sqlite3, time
from collections import Counter

TOK = re.compile('[0-9A-Za-z\u0080-\U0010ffff]+')
LOWER = {i: i + 32 for i in range(65, 91)}
COLS = [('c1book_id', 1), ('c5translit', 2), ('c6transl2', 4), ('c7comment', 8)]
SHARD = 190 * 1024

def varint(n, out):
    while n > 127:
        out.append((n & 127) | 128); n >>= 7
    out.append(n)

def tokens(v):
    if v is None: return []
    if isinstance(v, (bytes, bytearray)): v = bytes(v).decode('utf-8', 'replace')
    return [t.translate(LOWER) for t in TOK.findall(str(v))]

def build_index(db_path, out_dir, log=print):
    con = sqlite3.connect(db_path)
    try: have = [r[1] for r in con.execute('PRAGMA table_info("textindex_content")')]
    except sqlite3.Error: have = []
    cols = [(c, b) for c, b in COLS if c in have]
    if not cols: return None
    key = 'docid' if 'docid' in have else 'rowid'      # a real FTS table: rowid; the view made for files without FTS: docid
    sel = ', '.join('"%s"' % c for c, _ in cols)
    posts = {}                      # term -> [bytearray, last docid, count]
    docs = 0; t0 = time.time()
    for row in con.execute('SELECT %s, %s FROM textindex_content ORDER BY %s' % (key, sel, key)):
        docid = row[0]; docs += 1
        mask, tf = {}, {}
        for (c, bit), v in zip(cols, row[1:]):
            for t, n in Counter(tokens(v)).items():
                mask[t] = mask.get(t, 0) | bit
                if bit != 1: tf[t] = tf.get(t, 0) + n
        for t, m in mask.items():
            p = posts.get(t)
            if p is None: p = posts[t] = [bytearray(), 0, 0]
            varint(((docid - p[1]) << 4) | m, p[0]); varint(min(tf.get(t, 1), 100000), p[0])
            p[1] = docid; p[2] += 1
    log('index: %d docs, %d terms, %.0fs' % (docs, len(posts), time.time() - t0))
    con.close()
    os.makedirs(out_dir, exist_ok=True)
    terms = sorted(posts, key=lambda s: s.encode('utf-16-be', 'surrogatepass'))
    first, buf, n, total = [], bytearray(), 0, 0
    hsh = hashlib.sha1()
    def flush():
        nonlocal buf, n, total
        if not buf: return
        data = gzip.compress(bytes(buf), 9, mtime=0)
        with open(os.path.join(out_dir, 's%04d.gz' % n), 'wb') as f: f.write(data)
        hsh.update(data); total += len(data); n += 1; buf = bytearray()
    for t in terms:
        p = posts[t]; tb = t.encode('utf-8', 'surrogatepass')
        if len(buf) and len(buf) + len(p[0]) > SHARD: flush()
        if not buf: first.append(t)
        varint(len(tb), buf); buf += tb; varint(p[2], buf); varint(len(p[0]), buf); buf += p[0]
        posts[t] = None
    flush()
    meta = {'v': 1, 'cols': [b for _, b in cols], 'docs': docs, 'n': n, 'first': first}
    txt = json.dumps(meta, ensure_ascii=False, separators=(',', ':')); hsh.update(txt.encode('utf-8'))
    with open(os.path.join(out_dir, 'dir.json'), 'w', encoding='utf-8') as f: f.write(txt)
    log('index: %d shards, %.1f MB gzip' % (n, total / 1048576))
    return {'shards': n, 'bytes': total, 'docs': docs, 'terms': len(terms), 'hash': hsh.hexdigest()[:8]}
