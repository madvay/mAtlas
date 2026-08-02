import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const pages = new URL('../.pages/', import.meta.url);

await rm(pages, { recursive: true, force: true });
await mkdir(pages, { recursive: true });
await cp(dist, pages, { recursive: true });
await writeFile(new URL('./.nojekyll', pages), '');
console.log('Prepared GitHub Pages artifact in .pages/ with the interactive atlas, canonical field/domain/concept/view pages, Markdown equivalents, the published /data/ dataset, AI context files, and the semantic /directory/ page plus standalone /static/atlas.svg export.');
