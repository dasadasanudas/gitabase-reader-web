#!/usr/bin/env python3
"""Convert Gitabase SQLite files into a small manifest and per-chapter databases."""
import argparse
import json
import os
import re
import sqlite3
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("databases", nargs="+")
    ap.add_argument("--out", default="site/library")
    args = ap.parse_args()
    out = Path(args.out)
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

if __name__ == "__main__":
    main()
