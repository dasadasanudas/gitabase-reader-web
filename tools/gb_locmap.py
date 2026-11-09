"""Where each search-result row lives in the hosted file, so the browser can fetch the needed chunks in parallel.

Walks the b-tree of textindex_content in the final (VACUUMed) database file and, for every docid, finds the pages that hold
its row (the leaf page plus any overflow pages), then converts them to chunk numbers (chunk = file offset // chunk size).
Output (before gzip): repeat{ varint docid_delta, varint first_chunk, varint chunk_span }.
"""
import sqlite3, struct

def _varint(b, p):
    v = 0
    for i in range(9):
        c = b[p + i]
        if i == 8: return (v << 8) | c, p + 9
        v = (v << 7) | (c & 127)
        if not c & 128: return v, p + i + 1

def build_locmap(db_path, chunk):
    con = sqlite3.connect(db_path)
    r = con.execute("SELECT rootpage FROM sqlite_master WHERE type='table' AND name='textindex_content'").fetchone()
    con.close()
    if not r: return None
    root = r[0]
    f = open(db_path, 'rb'); hdr = f.read(100)
    ps = struct.unpack('>H', hdr[16:18])[0]; ps = 65536 if ps == 1 else ps
    U = ps - hdr[20]; X = U - 35; M = ((U - 12) * 32 // 255) - 23
    cache = {}
    def page(n):
        if n not in cache:
            if len(cache) > 4096: cache.clear()
            f.seek((n - 1) * ps); cache[n] = f.read(ps)
        return cache[n]
    out = []     # (docid, first page, last page)
    def walk(n):
        b = page(n); t = b[0]; nc = struct.unpack('>H', b[3:5])[0]
        if t == 5:
            right = struct.unpack('>I', b[8:12])[0]
            for i in range(nc):
                o = struct.unpack('>H', b[12 + 2 * i:14 + 2 * i])[0]
                walk(struct.unpack('>I', b[o:o + 4])[0])
            walk(right)
        elif t == 13:
            for i in range(nc):
                o = struct.unpack('>H', b[8 + 2 * i:10 + 2 * i])[0]
                P, o = _varint(b, o); rid, o = _varint(b, o)
                lo = hi = n
                if P > X:
                    K = M + ((P - M) % (U - 4)); local = K if K <= X else M
                    ov = struct.unpack('>I', b[o + local:o + local + 4])[0]; left = P - local
                    while ov and left > 0:
                        lo = min(lo, ov); hi = max(hi, ov)
                        nxt = struct.unpack('>I', page(ov)[:4])[0]; left -= (U - 4); ov = nxt
                out.append((rid, lo, hi))
        else:
            raise ValueError('unexpected b-tree page type %d' % t)
    walk(root)
    f.close()
    out.sort()
    buf = bytearray(); prev = 0
    def vi(n):
        while n > 127: buf.append((n & 127) | 128); n >>= 7
        buf.append(n)
    for rid, lo, hi in out:
        c0 = ((lo - 1) * ps) // chunk; c1 = (hi * ps - 1) // chunk
        vi(rid - prev); vi(c0); vi(c1 - c0); prev = rid
    return bytes(buf), len(out)
