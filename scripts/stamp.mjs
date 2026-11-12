// Cache busting without a build step.
// Writes an import map into index.html that points every module at "<file>?v=<content hash>".
// A browser that gets the new index.html therefore fetches exactly the files that changed,
// and never mixes an old module with a new one.
//
//   node scripts/stamp.mjs          rewrite index.html
//   node scripts/stamp.mjs --check  exit 1 if index.html is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const MODULES = ['src/main.js', 'src/core.js', 'src/map.js', 'src/config.js', 'vendor/three.module.min.js'];
const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 8);

// Returns index.html as it should be for the current module files.
export function stamped(html = readFileSync(new URL('index.html', ROOT), 'utf8')) {
  const imports = {};
  for (const f of MODULES) imports['./' + f] = `./${f}?v=${sha(readFileSync(new URL(f, ROOT)))}`;
  const build = sha(Object.values(imports).join('|'));
  const block = `<!--stamp-->\n<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n<!--/stamp-->`;
  if (!/<!--stamp-->[\s\S]*?<!--\/stamp-->/.test(html) || !/<span id="build">[^<]*<\/span>/.test(html)) throw new Error('index.html is missing the stamp markers');
  return html
    .replace(/<!--stamp-->[\s\S]*?<!--\/stamp-->/, block)
    .replace(/<span id="build">[^<]*<\/span>/, `<span id="build">Build ${build}</span>`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('index.html', ROOT), current = readFileSync(path, 'utf8'), next = stamped(current);
  if (process.argv.includes('--check')) {
    if (current !== next) { console.error('index.html is out of date. Run: npm run stamp'); process.exit(1); }
    console.log('index.html is up to date');
  } else if (current !== next) { writeFileSync(path, next); console.log('index.html stamped'); }
  else console.log('index.html already up to date');
}
