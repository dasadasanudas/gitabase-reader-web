#!/usr/bin/env python3
"""Build the GitHub Pages site of Gitabase Reader web.

  python tools/build_site.py [--site site] [--databases databases] [--library-cache DIR --key KEY]

1. App: the app files at the repo root (index.html, sw.js, manifest.webmanifest, css/, js/, fonts/, img/).
   If release/gitabase-reader-web.zip exists it is unpacked first and the files at the repo root are laid
   over it, so code updates can be committed as plain files while fonts and images stay in the zip.
2. Library: every database in databases/ is indexed and cut into chunks by tools/prepare_library.py, into
   site/library with catalog.json. With --library-cache the prepared library is kept between runs and reused
   while KEY (a hash of the database pointers) is unchanged, so Git LFS is pulled only after a change.
3. sw.js gets a build stamp and the list of fonts / toolbar images to keep for offline use.
"""
import argparse, hashlib, json, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

APP_FILES = ['index.html', 'sw.js', 'manifest.webmanifest']
APP_DIRS = ['css', 'js', 'fonts', 'img']
ZIP = Path('release/gitabase-reader-web.zip')
HERE = Path(__file__).resolve().parent

def is_new_app_index(p):
    try: head = Path(p).read_text(encoding='utf-8', errors='ignore')[:6000]
    except OSError: return False
    return 'js/app.js' in head and 'js/db.js' in head

def new_app_present():
    return ZIP.exists() or (is_new_app_index('index.html') and Path('js/app.js').exists())

def unpack_zip(site, tmp):
    """Unpack the app part of the release zip into site/ and its tools into tmp/."""
    with zipfile.ZipFile(ZIP) as z:
        names = [n for n in z.namelist() if not n.endswith('/')]
        idx = sorted((n for n in names if n.endswith('index.html') and n.count('/') <= 1), key=len)
        if not idx: raise SystemExit(f'{ZIP}: no index.html inside')
        root = idx[0][:-len('index.html')]
        for n in names:
            if not n.startswith(root): continue
            rel = n[len(root):]; top = rel.split('/')[0]
            if rel in APP_FILES or top in APP_DIRS: dst = site / rel
            elif top == 'tools' and rel.endswith('.py'): dst = tmp / rel
            else: continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            with z.open(n) as src, open(dst, 'wb') as out: shutil.copyfileobj(src, out)
    print(f'app: unpacked {ZIP}')

def copy_app(site):
    for f in APP_FILES:
        p = Path(f)
        if p.exists() and (f != 'index.html' or is_new_app_index(p)): shutil.copy2(p, site / f)
    for d in APP_DIRS:
        if Path(d).is_dir(): shutil.copytree(d, site / d, dirs_exist_ok=True)
    if not is_new_app_index(site / 'index.html'): raise SystemExit('app: no Gitabase Reader web index.html found')

def check_real(dbdir):
    for p in sorted(Path(dbdir).glob('*')):
        if p.suffix.lower() not in ('.db', '.gitabase', '.sqlite', '.sqlite3'): continue
        with open(p, 'rb') as f: head = f.read(40)
        if head.startswith(b'version https://git-lfs'):
            raise SystemExit(f'{p} is only a Git LFS pointer: the checkout needs LFS (or the LFS quota is used up)')

def run_prepare(prep, dbdir, out):
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(prep), str(dbdir), str(out)], check=True)

def build_library(site, dbdir, prep, cache=None, key=None):
    out = site / 'library'
    if not Path(dbdir).is_dir():
        out.mkdir(parents=True, exist_ok=True); (out / 'catalog.json').write_text('{"version": 1, "files": []}'); return
    if cache:
        cache = Path(cache); lib = cache / 'library'; stamp = cache / 'key.txt'
        if key and stamp.exists() and stamp.read_text().strip() == key and (lib / 'catalog.json').exists():
            print('library: reusing the prepared library from the cache')
        else:
            check_real(dbdir); shutil.rmtree(cache, ignore_errors=True); cache.mkdir(parents=True)
            run_prepare(prep, dbdir, lib)
            if key: stamp.write_text(key)
        shutil.rmtree(out, ignore_errors=True); shutil.copytree(lib, out)
    else:
        check_real(dbdir); run_prepare(prep, dbdir, out)

def stamp_sw(site):
    sw = site / 'sw.js'
    if not sw.exists(): return
    h = hashlib.sha256()
    for p in sorted(site.rglob('*')):
        rel = p.relative_to(site)
        if p.is_file() and rel.parts[0] not in ('library', 'export') and p.name != 'sw.js':
            h.update(rel.as_posix().encode()); h.update(p.read_bytes())
    assets = sorted(p.relative_to(site).as_posix() for d in ('fonts', 'img/tb') if (site / d).is_dir() for p in (site / d).iterdir() if p.is_file())
    s = sw.read_text(encoding='utf-8')
    s = s.replace("'__BUILD__'", "'" + h.hexdigest()[:12] + "'").replace('/*__ASSETS__*/', ', '.join(json.dumps(a) for a in assets))
    sw.write_text(s, encoding='utf-8')
    print('sw.js: build', h.hexdigest()[:12], '·', len(assets), 'assets')

def build(site='site', dbdir='databases', cache=None, key=None):
    site = Path(site); site.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        if ZIP.exists(): unpack_zip(site, tmp)
        copy_app(site)
        prep = HERE / 'prepare_library.py'
        if not prep.exists(): prep = tmp / 'tools' / 'prepare_library.py'
        if not prep.exists(): raise SystemExit('tools/prepare_library.py is missing')
        build_library(site, dbdir, prep, cache, key)
    stamp_sw(site)
    print('site ready:', site)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--site', default='site'); ap.add_argument('--databases', default='databases')
    ap.add_argument('--library-cache'); ap.add_argument('--key')
    a = ap.parse_args()
    build(a.site, a.databases, a.library_cache, a.key)

if __name__ == '__main__': main()
