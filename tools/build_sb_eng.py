"""Build the English Srimad-Bhagavatam gitabase from the BBT text source (github.com/iskconpress/books, folder sb/).

usage: python3 build_sb_eng.py <books-dir> <out.db> [hindi-sb.db ...]

Cantos 5-10 of the source carry no Devanagari; the optional Hindi gitabase(s) fill it in by canto.chapter.verse.

Same schema and conventions as the other gitabase files the app reads (gitabase_gita_eng.db): Gaura/Balaram text form
(a i u s n with macron/acute precomposed, dot-below letters decomposed, anusvara m + U+0301, guttural nasal n-acute),
every non-ASCII character as a numeric HTML entity, word-for-word as "<A HREF=gb://pro/x/slug>word</A> &#8212; meaning;",
an fts3 index textindex(_id, book_id, song, ch_no, txt_no, translit(=synonyms), transl2, comment). One book, cantos as songs.
"""
import os, re, sys, sqlite3, unicodedata

SRC, OUT = sys.argv[1], sys.argv[2]
SB = os.path.join(SRC, 'sb')

# ---------- text form ----------
def gb_form(s):
    s = unicodedata.normalize('NFC', s)
    s = s.replace('\u1e41', 'm\u0301').replace('\u1e43', 'm\u0301').replace('\u1e40', 'M\u0301').replace('\u1e42', 'M\u0301')
    s = s.replace('\u1e45', '\u0144').replace('\u1e44', '\u0143')
    out = []
    for ch in s:
        c = ord(ch)
        out.append(unicodedata.normalize('NFD', ch) if 0x1E00 <= c <= 0x1EFF else ch)
    return ''.join(out)

def ent(s):
    return ''.join(ch if ord(ch) < 128 else '&#%d;' % ord(ch) for ch in s)

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def enc(s):          # plain text -> stored form
    return ent(gb_form(esc(s)))

def ascii_fold(s):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode())

CC_LILA = {'adi': '1', 'madhya': '2', 'antya': '3'}

def inline(s):
    """DokuWiki inline markup -> gitabase HTML (already entity-encoded)."""
    links = []
    def link(m):
        target = m.group(1); label = m.group(2) if m.group(2) is not None else target.split(':')[-1]
        label = label.strip('[]')
        parts = target.split(':')
        href = None
        if parts and parts[0] == 'books' and len(parts) >= 3:
            book = parts[1]; nums = parts[2:]
            if book == 'cc' and nums and nums[0] in CC_LILA: nums = [CC_LILA[nums[0]]] + nums[1:]
            if all(re.fullmatch(r'\d+(-\d+)?', n) for n in nums): href = 'gb://' + book + '/' + '/'.join(nums)
        elif parts and parts[0] == 'synonyms' and len(parts) >= 3:
            w = parts[-1]; slug = ascii_fold(w)
            if slug: href = 'gb://pro/' + slug[0] + '/' + slug
        links.append((href, label))
        return '\x00%d\x00' % (len(links) - 1)
    s = re.sub(r'\[\[([^\]|]+)(?:\|((?:\[[^\]]*\]|[^\]])*))?\]\]', link, s)
    s = re.sub(r'\(\((.*?)\)\)', '', s)                 # footnotes
    s = s.replace('\\\\ ', '\n').replace('\\\\', '\n').replace('---', '\u2014').replace('--', '\u2013')
    s = enc(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(https?):(?=//)', lambda m: m.group(1) + '\x02', s)
    s = re.sub(r'//(.+?)//', r'<i>\1</i>', s)
    s = s.replace('//', '').replace('\x02', ':')
    s = s.replace('\n', '<br />')
    def unlink(m):
        href, label = links[int(m.group(1))]
        lab = inline(label) if '[[' in label else enc(label)
        return '<A HREF="%s">%s</A>' % (href, lab) if href else lab
    s = re.sub(r'\x00(\d+)\x00', unlink, s)
    return s

def plain(s):
    s = re.sub(r'\[\[[^\]|]+\|((?:\[[^\]]*\]|[^\]])*)\]\]', lambda m: m.group(1).strip('[]'), s)
    s = re.sub(r'\[\[([^\]]+)\]\]', r'\1', s)
    s = re.sub(r'\(\((.*?)\)\)', '', s)
    return re.sub(r'\*\*|//', '', s).replace('\\\\', ' ')

# ---------- one verse file ----------
SEC = re.compile(r'^=====\s*(Text|Texts|Synonyms|Translation|Purport)\s*=====\s*$', re.M)

def blocks(body):
    """paragraphs, '> ' quotes and '  * ' lists -> HTML (encoded)"""
    out, para, quote, items = [], [], [], []
    def flush():
        if para: out.append('<P>' + inline(' '.join(para)) + '</P>'); para.clear()
        if quote: out.append('<blockquote>' + '<br />'.join(inline(q) for q in quote) + '</blockquote>'); quote.clear()
        if items: out.append('<ul>' + ''.join('<li>' + inline(i) + '</li>' for i in items) + '</ul>'); items.clear()
    for line in body.split('\n'):
        t = line.rstrip()
        if not t.strip(): flush(); continue
        if t.startswith('>'):
            if para or items: f = quote[:]; quote.clear(); flush(); quote.extend(f)
            quote.append(t.lstrip('>').strip()); continue
        m = re.match(r'^\s{2,}[*-]\s+(.*)$', t)
        if m:
            if para or quote: flush()
            items.append(m.group(1)); continue
        if t.startswith('<WRAP') or t.startswith('</WRAP') or t.startswith('{{') or t.startswith('~~'): continue
        if quote or items: flush()
        para.append(t.strip())
    flush()
    return ''.join(out)

def parse_verse(path):
    raw = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    m = re.search(r'^======\s*(.+?)\s*======\s*$', raw, re.M)
    head = raw[m.end():] if m else raw
    secs = {}; pos = [(x.group(1), x.start(), x.end()) for x in SEC.finditer(head)]
    pre = head[:pos[0][1]] if pos else head
    for k, (name, a, b) in enumerate(pos):
        end = pos[k + 1][1] if k + 1 < len(pos) else len(head)
        secs['Text' if name == 'Texts' else name] = head[b:end].strip('\n')
    dev = [l.lstrip('>').strip() for l in pre.split('\n') if l.startswith('>')]
    tl = [l.lstrip('>').strip() for l in secs.get('Text', '').split('\n') if l.startswith('>')]
    if not tl and secs.get('Text'): tl = [l.strip() for l in secs['Text'].split('\n') if l.strip()]
    syn = secs.get('Synonyms', '').strip()
    tr = re.sub(r'^\*\*(.*)\*\*$', r'\1', ' '.join(secs.get('Translation', '').split()), flags=re.S)
    pp = secs.get('Purport', '').strip()
    return dev, tl, syn, tr, pp

def syn_html(s):
    if not s: return ''
    s = ' '.join(s.split())
    out = []
    for part in re.split(r';\s*(?![^\[]*\]\])', s):
        if '---' in part:
            w, mean = part.split('---', 1); out.append(inline(w.strip()) + ' &#8212; ' + inline(mean.strip()))
        elif part.strip(): out.append(inline(part.strip()))
    return '<P>' + '; '.join(out) + '</P>'

def num_key(name):
    m = re.match(r'(\d+)', name); return (int(m.group(1)) if m else 1 << 30, name)

def title_of(path, fallback):
    if not os.path.exists(path): return fallback
    raw = open(path, encoding='utf-8').read()
    m = re.search(r'^======\s*(.+?)\s*======\s*$', raw, re.M)
    return m.group(1).strip() if m else fallback

# ---------- build ----------
if os.path.exists(OUT): os.remove(OUT)
db = sqlite3.connect(OUT); c = db.cursor()
c.executescript('''
CREATE TABLE "android_metadata" ("locale" TEXT DEFAULT 'en_US');
CREATE TABLE books (_id INTEGER PRIMARY KEY, sort INTEGER, author TEXT, title TEXT, desc TEXT, type TEXT, levels NUMERIC, hasSanskrit INTEGER DEFAULT 0, hasPurport INTEGER DEFAULT 1, hasColorStructure INTEGER DEFAULT 0, isSongBook INTEGER DEFAULT 0, text_size INTEGER, purport_size INTEGER, text_begin_raw INTEGER, text_end_raw INTEGER);
CREATE TABLE chapters (_id INTEGER PRIMARY KEY, book_id NUMERIC, book TEXT, song TEXT, number NUMERIC, title TEXT, desc TEXT, colorBackgnd VARCHAR(10), colorForegnd VARCHAR(10), text_size INTEGER DEFAULT 0, purport_size INTEGER DEFAULT 0, prev_size_t INTEGER DEFAULT 0, prev_size_p INTEGER DEFAULT 0);
CREATE TABLE songs (_id INTEGER PRIMARY KEY, book_id NUMERIC, song TEXT, sort NUMERIC, songname TEXT, colorBackgnd VARCHAR(10), colorForegnd VARCHAR(10), text_size INTEGER, purport_size INTEGER);
CREATE TABLE texts (_id INTEGER PRIMARY KEY, sanskrit TEXT, translit TEXT, translit_srch TEXT, transl1 TEXT, transl2 TEXT, comment TEXT);
CREATE TABLE textnums (_id INTEGER PRIMARY KEY, book_id NUMERIC, song NUMERIC, ch_no NUMERIC, txt_no TEXT, preview TEXT, haspurport INTEGER DEFAULT 1, url TEXT, service1 TEXT, service2 TEXT, text_seq_no INTEGER, text_offset INTEGER, text_size INTEGER);
CREATE TABLE links (_id INTEGER PRIMARY KEY, link TEXT, word TEXT, text TEXT);
CREATE TABLE meanings (_id INTEGER PRIMARY KEY, txt_id NUMERIC, name TEXT, word TEXT, wordt TEXT, link TEXT, txtname TEXT);
CREATE VIRTUAL TABLE textindex USING fts3(_id NUMBER , book_id TEXT  , song TEXT  , ch_no TEXT  , txt_no TEXT  , translit TEXT  , transl2 TEXT , comment TEXT  );
''')
c.execute("INSERT INTO android_metadata VALUES ('en_US')")
tid = 0; chid = 0; seq = 0; offset = 0; book_t = book_p = 0
cantos = sorted([d for d in os.listdir(SB) if os.path.isdir(os.path.join(SB, d)) and d.isdigit()], key=int)
for ci, canto in enumerate(cantos):
    ctitle = title_of(os.path.join(SB, canto + '.txt'), 'Canto ' + canto)
    cname = re.sub(r'^Canto\s+\d+\s*:\s*', '', ctitle)
    song_t = song_p = 0
    cdir = os.path.join(SB, canto)
    chapters = sorted([d for d in os.listdir(cdir) if os.path.isdir(os.path.join(cdir, d)) and d.isdigit()], key=int)
    for chn in chapters:
        chdir = os.path.join(cdir, chn); chid += 1
        cht = title_of(os.path.join(cdir, chn + '.txt'), 'Chapter ' + chn)
        ch_t = ch_p = 0; prev_t, prev_p = book_t, book_p
        for fn in sorted([f for f in os.listdir(chdir) if f.endswith('.txt')], key=num_key):
            no = fn[:-4]
            if not re.fullmatch(r'\d+(-\d+)?', no): continue
            dev, tl, syn, tr, pp = parse_verse(os.path.join(chdir, fn))
            tid += 1; seq += 1
            sanskrit = '<br />'.join(dev)
            translit = ''.join('<P>' + enc(l) + '</P>' for l in tl)
            srch = ''.join('<P>' + ascii_fold(l.replace(' ', '\x01')).replace('\x01', ' ') + '</P>' for l in tl)
            transl1 = syn_html(syn)
            transl2 = '<P>' + inline(tr) + '</P>' if tr else ''
            comment = blocks(pp) if pp else ''
            preview = ' '.join(plain(tr).split())[:400]
            size = len(transl2); psize = len(comment)
            c.execute('INSERT INTO texts VALUES (?,?,?,?,?,?,?)', (tid, sanskrit, translit, srch, transl1, transl2, comment))
            c.execute('INSERT INTO textnums VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (tid, 1, int(canto), int(chn), no, preview, 1 if comment else 0, 'sb/%s/%s/%s/en' % (canto, chn, no), '', '', seq, offset, size + psize))
            c.execute('INSERT INTO textindex(docid, _id, book_id, song, ch_no, txt_no, translit, transl2, comment) VALUES (?,?,?,?,?,?,?,?,?)', (tid, tid, '1', canto, chn, no, transl1, transl2, comment))
            offset += size + psize; ch_t += size; ch_p += psize
        c.execute('INSERT INTO chapters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (chid, 1, 'SB', canto, int(chn), unicodedata.normalize('NFC', cht), '', '', '', ch_t, ch_p, prev_t, prev_p))
        song_t += ch_t; song_p += ch_p; book_t += ch_t; book_p += ch_p
    c.execute('INSERT INTO songs VALUES (?,?,?,?,?,?,?,?,?)', (ci + 1, 1, canto, int(canto), unicodedata.normalize('NFC', cname), '', '', song_t, song_p))
c.execute('INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (1, 20, '', 'Śrīmad-Bhāgavatam', '', 'SB', 3, 1, 1, 0, 0, book_t, book_p, 1, tid))
c.executescript('CREATE INDEX idx_textnums_loc ON textnums (book_id, song, ch_no, text_seq_no); CREATE INDEX idx_chapters_loc ON chapters (book_id, song, number);')
filled = 0
for hp in sys.argv[3:]:
    try:
        h = sqlite3.connect('file:' + hp + '?mode=ro', uri=True)
        hb = h.execute("SELECT _id FROM books WHERE upper(type) = 'SB' OR title LIKE '%भागवत%' LIMIT 1").fetchone()
        if not hb: continue
        rows = h.execute('SELECT n.song, n.ch_no, n.txt_no, t.sanskrit FROM textnums n JOIN texts t ON t._id = n._id WHERE n.book_id = ? AND t.sanskrit IS NOT NULL AND t.sanskrit <> ""', (hb[0],))
        dev = {(str(a), str(b), str(cn)): d for a, b, cn, d in rows}
        for _id, a, b, cn in c.execute('SELECT n._id, n.song, n.ch_no, n.txt_no FROM textnums n JOIN texts t ON t._id = n._id WHERE t.sanskrit = ""').fetchall():
            d = dev.get((str(a), str(b), str(cn)))
            if d: db.execute('UPDATE texts SET sanskrit = ? WHERE _id = ?', (d, _id)); filled += 1
        h.close()
    except Exception as e:
        print('skip', hp, e)
db.commit(); c.execute("INSERT INTO textindex(textindex) VALUES('optimize')"); db.commit()
db.execute('VACUUM'); db.close()
print('devanagari filled', filled); print('cantos', len(cantos), 'chapters', chid, 'texts', tid, 'bytes', os.path.getsize(OUT))
