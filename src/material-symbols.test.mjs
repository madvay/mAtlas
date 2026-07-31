import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sourceDirectories = [new URL('src/', root), new URL('scripts/', root)];
const textExtensions = new Set(['.css', '.html', '.mjs', '.ts']);
const legacyIconPattern = new RegExp(`${['material', 'icons'].join('-')}|${['Material', 'Icons'].join(' ')}`);

async function collectTextFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directoryUrl);
    if (entry.isDirectory()) files.push(...await collectTextFiles(entryUrl));
    else if (textExtensions.has(extname(entry.name))) files.push(entryUrl);
  }
  return files;
}

test('all application icon-font references use Material Symbols Outlined', async () => {
  const files = (await Promise.all(sourceDirectories.map(collectTextFiles))).flat();
  const legacyReferences = [];
  for (const fileUrl of files) {
    const source = await readFile(fileUrl, 'utf8');
    if (legacyIconPattern.test(source)) {
      legacyReferences.push(relative(new URL('.', root).pathname, fileUrl.pathname));
    }
  }
  assert.deepEqual(legacyReferences, []);

  const index = await readFile(new URL('src/index.html', root), 'utf8');
  assert.match(index, /family=Material\+Symbols\+Outlined&display=block/);

  const styles = await readFile(new URL('src/styles.css', root), 'utf8');
  assert.match(styles, /\.material-symbols-outlined\s*\{/);
  assert.match(styles, /font-family:\s*"Material Symbols Outlined"/);
  assert.match(styles, /font-feature-settings:\s*"liga"/);
  assert.match(styles, /font-variation-settings:\s*"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24/);
});
