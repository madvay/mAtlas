import { mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const buildDirectory = new URL('../.test-build/', import.meta.url);
const temporaryDirectory = new URL('../.test-tmp/', import.meta.url);
const typeScriptCli = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
async function adjacentTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await adjacentTests(path));
    else if (entry.name.endsWith('.test.mjs')) files.push(relative(root, path));
  }
  return files;
}
const testFiles = [
  ...await adjacentTests(join(root, 'src')),
  ...await adjacentTests(join(root, 'scripts'))
].sort();

await rm(buildDirectory, { recursive: true, force: true });
await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(temporaryDirectory, { recursive: true });
let status = 1;
try {
  const testEnvironment = {
    ...process.env,
    TMPDIR: fileURLToPath(temporaryDirectory),
    TMP: fileURLToPath(temporaryDirectory),
    TEMP: fileURLToPath(temporaryDirectory)
  };
  const typeScript = spawnSync(process.execPath, [typeScriptCli, '-p', 'tsconfig.test.json'], { stdio: 'inherit', env: testEnvironment });
  if (typeScript.status !== 0) {
    status = typeScript.status ?? 1;
  } else {
    const tests = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...testFiles], { stdio: 'inherit', env: testEnvironment });
    status = tests.status ?? 1;
  }
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
}
process.exit(status);
