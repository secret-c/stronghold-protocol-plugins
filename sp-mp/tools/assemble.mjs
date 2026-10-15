// Build sp-mp/files from the root project source. MANIFEST.json records the original 0.2.6 bytes;
// sp-mp/base keeps those bytes for future upstream rebases. The root is the only editable runtime source.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const original = JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).files;
const listOnly = process.argv.includes('--list');
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const source = (rel) => path.join(ROOT, ...rel.split('/'));
const output = (rel) => path.join(MP, 'files', ...rel.split('/'));
const baseline = (rel) => path.join(MP, 'base', ...rel.split('/'));
const put = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

function walk(dir, rel, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = `${rel}/${entry.name}`;
    if (rel === 'public' && ['assets', 'fonts', 'vendor', 'icons', 'dev'].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Runtime source must not be a link: ${next}`);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), next, out);
    else if (entry.isFile() && !entry.name.endsWith('.pre-rebase')) out.push(next);
  }
}

const runtime = [];
for (const dir of ['shared', 'server', 'public']) walk(source(dir), dir, runtime);
const overrides = runtime.filter((rel) => rel !== 'public/index.html' &&
  (!original[rel] || digest(source(rel)) !== original[rel].sha256));
// Never quietly treat an already edited root file as the pristine side of a rebase.
for (const rel of overrides) {
  if (original[rel] && (!fs.existsSync(baseline(rel)) || digest(baseline(rel)) !== original[rel].sha256)) {
    throw new Error(`Missing pristine baseline for ${rel}; restore sp-mp/base before assembling`);
  }
}
if (original['public/index.html'] && digest(source('public/index.html')) !== original['public/index.html'].sha256) {
  throw new Error('Root public/index.html must remain the uninjected upstream page');
}
if (listOnly) {
  console.log(`root source overrides (${overrides.length + 1} including derived index):`);
  for (const rel of overrides) console.log(`  ${rel}`);
  console.log('  public/index.html (injected at assemble time)');
  process.exit(0);
}

for (const rel of overrides) put(source(rel), output(rel));
const keep = new Set([...overrides, 'public/index.html']);
const outRoot = path.join(MP, 'files');
function prune(dir, rel = '') {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) prune(file, next);
    else if (entry.isFile() && !keep.has(next)) fs.rmSync(file);
  }
  if (rel && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}
prune(outRoot);

let index = fs.readFileSync(source('public/index.html'), 'utf8');
if (index.includes('/sp-mp/client/entry.js')) throw new Error('Root index is already injected');
const tags = '  <!-- sp-mp overlay -->\n  <link rel="stylesheet" href="/sp-mp/client/client.css" />\n  <script type="module" src="/sp-mp/client/entry.js"></script>\n';
if (index.includes('<script type="module" src="/js/main.js"')) {
  index = index.replace(/(\s*)<script type="module" src="\/js\/main\.js"/, `\n${tags}$1<script type="module" src="/js/main.js"`);
} else if (index.includes('</head>')) index = index.replace('</head>', `${tags}</head>`);
else throw new Error('Root index has no plugin injection point');
fs.mkdirSync(path.dirname(output('public/index.html')), { recursive: true });
fs.writeFileSync(output('public/index.html'), index);
if (!fs.existsSync(baseline('public/index.html'))) put(source('public/index.html'), baseline('public/index.html'));

const clientOut = path.join(MP, 'public', 'sp-mp', 'client');
fs.mkdirSync(clientOut, { recursive: true });
for (const entry of fs.readdirSync(path.join(MP, 'client'), { withFileTypes: true })) {
  if (entry.isFile()) put(path.join(MP, 'client', entry.name), path.join(clientOut, entry.name));
}
console.log(`overlay files: ${overrides.length + 1}; source: project root; client routed: ${fs.readdirSync(clientOut).length}`);
