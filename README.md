# Gitabase Reader

The reader opens directly from `index.html` in the offline download. Add your
own `.db` or `.gitabase` file in the app; the file stays in your browser.

## Publish your own online library

1. Enable GitHub Pages with **Settings > Pages > Build and deployment > GitHub Actions**.
2. Install Git LFS on your computer, clone the repository and run `git lfs install`.
3. Put your Gitabase files in `databases/`, then commit and push. The file rules
   in `.gitattributes` make files in that folder use LFS.
4. The "Publish reader" Actions workflow splits the files into one SQLite file
   per chapter and deploys the site and a small catalogue to Pages. On the site,
   choose **Online library**, then book, canto and chapter.

GitHub's normal repository limit is 100 MiB per file and browser uploads are
limited to 25 MiB. Use Git LFS from your computer, not the GitHub web upload,
for large databases. LFS and Actions have usage limits. GitHub Pages has a
1 GB published-site limit. Do not publish content unless you have the right
to make it public.

The online reader fetches its catalogue and the selected chapter, not the
whole original database. Opening another chapter currently means picking it
in Online library again: automatic cross-chapter fetching is not implemented.
Each fetched chapter is stored in the browser library, and can be removed
through Manage gitabases.

The hosted split files currently include text, chapter metadata, FTS when
present, and matching dictionary and image data where the schema supports it.
Some cross-reference and auxiliary table variants cannot yet be reconstructed
from the selected chapter and may not appear. Search on the hosted side covers
downloaded chapters, not the entire online library. For the original complete
database's full functionality, import the original file locally.

The splitter requires Python 3 with SQLite FTS3 support and no additional
dependencies. Run locally with:

```sh
python tools/split_gitabase.py databases/my-book.db --out site/library
```
