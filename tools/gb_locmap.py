"""Which file chunks the browser needs to show search-result rows, so it can fetch them all in parallel.

The reader's SQLite reads a hosted file one chunk at a time, waiting for each download before it knows the next page
it wants (schema, then b-tree interior pages, then the row's leaf and overflow pages). On a slow connection that is
20+ round trips for one results page. This walks the same b-trees here, at build time, in the final (VACUUMed) file:

  hot      chunks every row lookup needs: the schema (sqlite_master) and the upper b-tree levels of the row tables
  per row  the chunks of its leaf page, its overflow pages and the interior page right above the leaf

Row tables: textindex_content (a real FTS content table), or for the view made for files without FTS
(prepare_library.py) the two tables it reads by rowid, textnums and texts.

loc2.gz (version 2, before gzip): repeat{ varint docid_delta, varint k, varint zigzag(c[0] - previous row's c[0]),
then k-1 varints c[i] - c[i-1] }  with c = the row's chunks in ascending order.
"""
import sqlite3, struct

def _varint(b, p):
    v = 0
    for i in range(9):
        c = b[p + i]
        if i == 8: return (v << 8) | c, p + 9
        v = (v << 7) | (c & 127)
        if not c & 128: return v, p + i + 1

class _File:
    def __init__(self, path):
        self.f = open(path, 'rb'); hdr = self.f.read(100)
        ps = struct.unpack('>H', hdr[16:18])[0]; self.ps = 65536 if ps == 1 else ps
        self.U = self.ps - hdr[20]; self.X = self.U - 35; self.M = ((self.U - 12) * 32 // 255) - 23
        self.cache = {}
    def page(self, n):
        b = self.cache.get(n)
        if b is None:
            if len(self.cache) > 8192: self.cache.clear()
            self.f.seek((n - 1) * self.ps); b = self.cache[n] = self.f.read(self.ps)
        return b
    def close(self): self.f.close()

def _overflow(F, b, o, P, n):
    """pages of the overflow chain of a cell whose payload (P bytes) starts at b[o]"""
    out = []
    if P > F.X:
        K = F.M + ((P - F.M) % (F.U - 4)); local = K if K <= F.X else F.M
        ov = struct.unpack('>I', b[o + local:o + local + 4])[0]; left = P - local
        while ov and left > 0:
            out.append(ov); left -= (F.U - 4); ov = struct.unpack('>I', F.page(ov)[:4])[0]
    return out

def _walk_table(F, root, rows, interior, leafparents):
    """rows[rowid] -> set of pages (leaf, overflow, parent interior); interior: all interior pages"""
    def walk(n, parent):
        b = F.page(n); off = 100 if n == 1 else 0; t = b[off]; nc = struct.unpack('>H', b[off + 3:off + 5])[0]
        if t == 5:
            interior.add(n)
            right = struct.unpack('>I', b[off + 8:off + 12])[0]
            for i in range(nc):
                o = struct.unpack('>H', b[off + 12 + 2 * i:off + 14 + 2 * i])[0]
                walk(struct.unpack('>I', b[o:o + 4])[0], n)
            walk(right, n)
        elif t == 13:
            if parent: leafparents.add(parent)
            for i in range(nc):
                o = struct.unpack('>H', b[off + 8 + 2 * i:off + 10 + 2 * i])[0]
                P, o = _varint(b, o); rid, o = _varint(b, o)
                s = rows.setdefault(rid, set()); s.add(n); s.update(_overflow(F, b, o, P, n))
                if parent: s.add(parent)
        else:
            raise ValueError('unexpected table b-tree page type %d' % t)
    walk(root, 0)

def _schema_pages(F):
    """every page of the sqlite_master table b-tree (root page 1), with overflow pages"""
    pages = set()
    def walk(n):
        pages.add(n); b = F.page(n); off = 100 if n == 1 else 0; t = b[off]; nc = struct.unpack('>H', b[off + 3:off + 5])[0]
        if t == 5:
            for i in range(nc):
                o = struct.unpack('>H', b[off + 12 + 2 * i:off + 14 + 2 * i])[0]
                walk(struct.unpack('>I', b[o:o + 4])[0])
            walk(struct.unpack('>I', b[off + 8:off + 12])[0])
        elif t == 13:
            for i in range(nc):
                o = struct.unpack('>H', b[off + 8 + 2 * i:off + 10 + 2 * i])[0]
                P, o = _varint(b, o); rid, o = _varint(b, o)
                pages.update(_overflow(F, b, o, P, n))
    walk(1)
    return pages

def row_tables(con):
    r = con.execute("SELECT type, rootpage FROM sqlite_master WHERE name='textindex_content'").fetchone()
    if not r: return []
    if r[0] == 'table': return [r[1]]
    roots = []
    for t in ('textnums', 'texts'):
        x = con.execute("SELECT rootpage, sql FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()
        if not x or not x[1] or not __import__('re').search(r'_id\s+INTEGER\s+PRIMARY\s+KEY', x[1], 2): return []
        roots.append(x[0])
    return roots

def build_locmap(db_path, chunk):
    con = sqlite3.connect(db_path); roots = row_tables(con); con.close()
    if not roots: return None
    F = _File(db_path)
    rows, interior, leafparents = {}, set(), set()
    for root in roots: _walk_table(F, root, rows, interior, leafparents)
    schema = _schema_pages(F)
    ps = F.ps; F.close()
    def chunks(pages):
        out = set()
        for p in pages:
            a = ((p - 1) * ps) // chunk; z = (p * ps - 1) // chunk
            out.update(range(a, z + 1))
        return out
    hot = sorted(chunks(schema | (interior - leafparents)))
    buf = bytearray(); prev = 0; prevc = 0
    def vi(n):
        while n > 127: buf.append((n & 127) | 128); n >>= 7
        buf.append(n)
    for rid in sorted(rows):
        c = sorted(chunks(rows[rid]) - set(hot)) or [hot[0] if hot else 0]
        vi(rid - prev); vi(len(c)); d = c[0] - prevc; vi(d * 2 if d >= 0 else -d * 2 - 1)
        for i in range(1, len(c)): vi(c[i] - c[i - 1])
        prev = rid; prevc = c[0]
    return bytes(buf), len(rows), hot

def read_locmap(b):
    """inverse of the loc.gz encoding (tests)"""
    out = {}; p = 0; rid = 0; prevc = 0
    def rv():
        nonlocal p
        v = 0; m = 1
        while True:
            c = b[p]; p += 1; v += (c & 127) * m; m *= 128
            if not c & 128: return v
    while p < len(b):
        rid += rv(); k = rv(); z = rv(); d = z // 2 if z % 2 == 0 else -(z + 1) // 2
        c = [prevc + d]
        for _ in range(k - 1): c.append(c[-1] + rv())
        out[rid] = c; prevc = c[0]
    return out
