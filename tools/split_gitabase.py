#!/usr/bin/env python3
"""Convert Gitabase SQLite files into a small manifest and per-chapter databases.

Used by the original Pages workflow. Once the new Gitabase Reader web app is in the repo (its index.html at the
root, or release/gitabase-reader-web.zip) this hands over to tools/build_site.py, which builds the new site
(app files + chunked library with catalog.json) instead of the per-chapter files.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import zipfile
from pathlib import Path

def table_columns(db, name):
    return [x[1] for x in db.execute(f'PRAGMA table_info("{name}")')]

def ident(name):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise ValueError(f"unsafe identifier {name!r}")
    return '"' + name + '"'

def generate(src_path, output, name):
    src = sqlite3.connect(f"file:{Path(src_path).resolve()}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    tables = {r["name"]: r["sql"] for r in src.execute(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")}
    if not {"books", "chapters", "textnums", "texts"} <= tables.keys():
        raise ValueError(f"{src_path} is not a supported Gitabase database")
    books = [dict(r) for r in src.execute("SELECT * FROM books ORDER BY sort, _id")]
    result = {"name": name, "books": []}
    base = output / re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-")
    base.mkdir(parents=True, exist_ok=True)

    for book in books:
        bid = book["_id"]
        chapters = [dict(r) for r in src.execute(
            "SELECT * FROM chapters WHERE book_id=? ORDER BY CAST(song AS INTEGER), number", (bid,))]
        outbook = {"title": book.get("title") or "Untitled",
                   "code": book.get("type") or "", "chapters": []}
        for idx, ch in enumerate(chapters):
            canto, number = ch.get("song"), ch["number"]
            nums = [dict(r) for r in src.execute(
                "SELECT * FROM textnums WHERE book_id=? AND COALESCE(CAST(song AS TEXT),'')=COALESCE(CAST(? AS TEXT),'') AND ch_no=? ORDER BY text_seq_no",
                (bid, canto, number))]
            if not nums:
                continue
            ids = [r["_id"] for r in nums]
            fn = base / f"book-{bid}-chapter-{idx}.db"
            if fn.exists(): fn.unlink()
            dst = sqlite3.connect(fn)
            supported = ["android_metadata", "books", "songs", "chapters", "textnums",
                         "texts", "eind", "meanings", "links", "textrefs",
                         "image_nums", "images", "lettersbytopic", "textindex"]
            for table in supported:
                if table in tables:
                    try: dst.execute(tables[table])
                    except sqlite3.Error as err: raise ValueError(f"{table}: {err}") from err

            def copy_rows(table, rows):
                if table not in tables: return
                cols = table_columns(src, table)
                sql = f'INSERT INTO {ident(table)} ({",".join(map(ident, cols))}) VALUES ({",".join("?" for _ in cols)})'
                dst.executemany(sql, [tuple(row[c] for c in cols) for row in rows])

            def by_ids(table, key, values):
                if table not in tables or key not in table_columns(src, table) or not values:
                    return []
                rows = []
                for start in range(0, len(values), 400):
                    batch = values[start:start+400]
                    rows.extend(src.execute(f'SELECT * FROM {ident(table)} WHERE {ident(key)} IN ({",".join("?" for _ in batch)})', batch))
                return rows

            copy_rows("books", [book])
            copy_rows("chapters", [ch])
            copy_rows("textnums", nums)
            copy_rows("texts", by_ids("texts", "_id", ids))
            if "android_metadata" in tables:
                copy_rows("android_metadata", src.execute("SELECT * FROM android_metadata"))
            if "songs" in tables:
                copy_rows("songs", src.execute("SELECT * FROM songs WHERE book_id=? AND CAST(song AS TEXT)=CAST(? AS TEXT)", (bid, canto)))
            for table in ["eind", "meanings", "textrefs"]:
                copy_rows(table, by_ids(table, "txt_id", ids))
            if "image_nums" in tables and "images" in tables:
                cols = table_columns(src, "image_nums")
                book_col = "book_id" if "book_id" in cols else "bid" if "bid" in cols else None
                song_col = "song" if "song" in cols else "sid" if "sid" in cols else None
                chap_col = "ch_no" if "ch_no" in cols else "cid" if "cid" in cols else None
                if book_col and chap_col and "image_id" in cols:
                    q = f'SELECT * FROM image_nums WHERE {ident(book_col)}=? AND {ident(chap_col)}=?'
                    args = [bid, number]
                    if song_col:
                        q += f" AND COALESCE(CAST({ident(song_col)} AS TEXT),'')=COALESCE(CAST(? AS TEXT),'')"
                        args.append(canto)
                    rows = list(src.execute(q, args))
                    copy_rows("image_nums", rows)
                    image_col = "image_id" if "image_id" in table_columns(src, "images") else "_id"
                    copy_rows("images", by_ids("images", image_col, [r["image_id"] for r in rows]))
            if "links" in tables and "meanings" in tables:
                words = set()
                for row in by_ids("meanings", "txt_id", ids):
                    for col in ["link", "word"]:
                        if col in row.keys() and row[col]: words.add(row[col])
                col = "link" if "link" in table_columns(src, "links") else "word"
                copy_rows("links", by_ids("links", col, list(words)))
            if "textindex" in tables and "_id" in table_columns(src, "textindex"):
                copy_rows("textindex", by_ids("textindex", "_id", ids))
            dst.commit()
            dst.close()
            outbook["chapters"].append({
                "canto": str(canto or ""), "chapter": number,
                "title": ch.get("title") or f"Chapter {number}",
                "path": fn.relative_to(output).as_posix(), "bytes": fn.stat().st_size})
        if outbook["chapters"]:
            result["books"].append(outbook)
    src.close()
    return result

def export_databases(paths, site):
    """Optional: publish zipped copies of the source databases under site/export/.

    Only runs when release/export-db.txt lists database file names (one per line, '#' lines ignored,
    'all' exports every input). Each file is cut into 48 MB slices, every slice in its own zip, plus
    parts.txt with sizes and sha256 so the pieces can be joined and verified.
    """
    flag = Path("release/export-db.txt")
    if not flag.exists():
        return
    wanted = [l.strip() for l in flag.read_text(encoding="utf-8").splitlines()
              if l.strip() and not l.strip().startswith("#")]
    if not wanted:
        return
    exp = site / "export"
    exp.mkdir(parents=True, exist_ok=True)
    slice_size = 48 * 1024 * 1024
    listing = []
    for path in paths:
        p = Path(path)
        if "all" not in wanted and p.name not in wanted:
            continue
        whole = hashlib.sha256()
        with open(p, "rb") as f:
            i = 0
            while True:
                buf = f.read(slice_size)
                if not buf:
                    break
                whole.update(buf)
                zname = f"{p.stem}.part{i:02d}.zip"
                with zipfile.ZipFile(exp / zname, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
                    z.writestr(f"{p.name}.part{i:02d}", buf)
                listing.append(f"{zname}\t{len(buf)}\t{hashlib.sha256(buf).hexdigest()}")
                i += 1
        listing.append(f"{p.name}\t{p.stat().st_size}\t{whole.hexdigest()}")
    (exp / "parts.txt").write_text("\n".join(listing) + "\n", encoding="utf-8")
    print(f"Exported {len(listing)} entries to {exp}")

def _slice_zip(path, exp, listing, slice_size=48 * 1024 * 1024):
    whole = hashlib.sha256()
    with open(path, "rb") as f:
        i = 0
        while True:
            buf = f.read(slice_size)
            if not buf:
                break
            whole.update(buf)
            zname = f"{path.stem}.part{i:02d}.zip"
            with zipfile.ZipFile(exp / zname, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
                z.writestr(f"{path.name}.part{i:02d}", buf)
            listing.append(f"{zname}\t{len(buf)}\t{hashlib.sha256(buf).hexdigest()}")
            i += 1
    listing.append(f"{path.name}\t{path.stat().st_size}\t{whole.hexdigest()}")

def _subset(src_path, out_path, code, opts=None):
    """Rows of one book (books.type == code) plus its word and reference tables.

    opts (from 'key=value' words after the code in release/fetch-external.txt):
      texts=_id,transl1   columns of texts to keep ('all' keeps every column; default _id,transl1)
      all=t1,t2           tables copied whole, without the book filter
      skip=t1,t2          tables left out
    """
    opts = opts or {}
    text_cols = opts.get("texts", "_id,transl1")
    whole = {t for t in opts.get("all", "").split(",") if t}
    skip = {t for t in opts.get("skip", "").split(",") if t}
    if out_path.exists(): out_path.unlink()
    dst = sqlite3.connect(out_path)
    dst.execute("ATTACH DATABASE ? AS s", (str(src_path),))
    tables = {r[0]: r[1] for r in dst.execute("SELECT name, sql FROM s.sqlite_master WHERE type='table' AND sql IS NOT NULL")}
    cols = {t: [c[1] for c in dst.execute(f'PRAGMA s.table_info("{t}")')] for t in tables}
    bcol = "type" if "type" in cols.get("books", []) else None
    bids = [r[0] for r in dst.execute(f'SELECT _id FROM s.books WHERE "{bcol}" = ?', (code,))] if bcol else []
    dst.execute("CREATE TABLE gbweb_ids (_id INTEGER PRIMARY KEY)")
    if bids:
        dst.execute(f'INSERT INTO gbweb_ids SELECT _id FROM s.textnums WHERE book_id IN ({",".join("?" * len(bids))})', bids)
    bl = ",".join(str(int(b)) for b in bids) or "-1"
    report = []
    for t, sql in tables.items():
        if t.startswith(("sqlite_", "textindex")) or "VIRTUAL" in sql.upper(): continue
        if t in skip: continue
        c = cols[t]
        try:
            dst.execute(sql.replace(f'CREATE TABLE "{t}"', f'CREATE TABLE main."{t}"', 1) if f'CREATE TABLE "{t}"' in sql else sql)
        except sqlite3.Error:
            dst.execute(f'CREATE TABLE main."{t}" AS SELECT * FROM s."{t}" WHERE 0')
        n = dst.execute(f'SELECT count(*) FROM s."{t}"').fetchone()[0]
        if t in whole: where = ""
        elif t == "books": where = ""
        elif t == "texts": where = " WHERE _id IN (SELECT _id FROM gbweb_ids)"
        elif "book_id" in c: where = f" WHERE book_id IN ({bl})"
        elif "txt_id" in c: where = " WHERE txt_id IN (SELECT _id FROM gbweb_ids)"
        elif "thisBookWeb" in c: where = " WHERE thisBookWeb = " + repr(code)
        elif n < 3000000: where = ""
        else: report.append(f"{t}: skipped ({n} rows)"); continue
        if t == "texts":
            keep = list(c) if text_cols == "all" else [x for x in text_cols.split(",") if x in c]
            dst.execute(f'INSERT INTO main.texts ({",".join(keep)}) SELECT {",".join(keep)} FROM s.texts{where}')
        else:
            dst.execute(f'INSERT INTO main."{t}" SELECT * FROM s."{t}"{where}')
        cnt = dst.execute('SELECT count(*) FROM main."%s"' % t).fetchone()[0]
        report.append(f"{t}: {cnt} of {n}")
    dst.commit(); dst.execute("DETACH DATABASE s"); dst.execute("VACUUM"); dst.close()
    return report

def fetch_external(site):
    """Optional: release/fetch-external.txt lists 'URL CODE [key=value ...]' lines (a published gitabase package,
    a book code and _subset options; tag=NAME names the output). The package is downloaded during the build; for each
    database inside, the rows of book CODE plus the word and reference tables are copied into a compact SQLite,
    published as zip slices under site/export/ (listed in external.txt)."""
    flag = Path("release/fetch-external.txt")
    if not flag.exists():
        return
    jobs = [l.split() for l in flag.read_text(encoding="utf-8").splitlines() if l.strip() and not l.strip().startswith("#")]
    if not jobs:
        return
    import shutil, tempfile, urllib.request
    exp = site / "export"; exp.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp()); listing = []
    for job in jobs:
        url, code = job[0], (job[1] if len(job) > 1 else "SB")
        opts = dict(w.split("=", 1) for w in job[2:] if "=" in w)
        tag = re.sub(r"[^A-Za-z0-9_-]+", "_", opts.get("tag", f"{code}_subset"))
        try:
            zpath = tmp / "package.zip"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (gitabase-reader-web build)"})
            with urllib.request.urlopen(req, timeout=900) as r, open(zpath, "wb") as f:
                shutil.copyfileobj(r, f)
            with zipfile.ZipFile(zpath) as z:
                for n in z.namelist():
                    if not n.lower().endswith((".db", ".gitabase", ".sqlite")): continue
                    z.extract(n, tmp); sp = tmp / n
                    op = tmp / (re.sub(r"[^A-Za-z0-9_-]+", "_", Path(n).stem) + f"_{tag}.db")
                    rep = _subset(sp, op, code, opts); sp.unlink()
                    listing.append("# " + n + ": " + "; ".join(rep))
                    _slice_zip(op, exp, listing); op.unlink()
            zpath.unlink()
        except Exception as err:
            listing.append(f"# {url}: failed: {err}")
    with open(exp / "external.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(listing) + "\n")
    print(f"External export: {len(listing)} lines")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("databases", nargs="+")
    ap.add_argument("--out", default="site/library")
    args = ap.parse_args()
    out = Path(args.out)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import build_site
    except ImportError:
        build_site = None
    if build_site and build_site.new_app_present():
        build_site.build(site=out.parent, dbdir=Path(args.databases[0]).parent)
        export_databases(args.databases, out.parent)
        fetch_external(out.parent)
        return
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"version": 1, "databases": []}
    names = set()
    for path in args.databases:
        name = Path(path).stem
        key = re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-")
        if not key or key in names: raise ValueError(f"Duplicate or unusable filename: {name}")
        names.add(key)
        manifest["databases"].append(generate(path, out, name))
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Created {sum(len(b['chapters']) for d in manifest['databases'] for b in d['books'])} chapter files in {out}")
    export_databases(args.databases, out.parent)
    fetch_external(out.parent)

if __name__ == "__main__":
    main()
