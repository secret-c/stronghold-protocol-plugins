#!/usr/bin/env node
// Export one complete, uncompressed Windows version. Never reuse or remove a public dist directory.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MP = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT = path.dirname(MP);
const DIST = path.join(ROOT, 'dist');
const plugin = JSON.parse(fs.readFileSync(path.join(MP, 'plugin.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'MANIFEST.json'), 'utf8')).app;
const name = `Stronghold-Protocol-Windows-${app}-sp-mp-${plugin.version}`;
const dest = path.join(DIST, name);

const rootDirs = ['.github', 'docs', 'test', 'tools', 'scripts', 'types', 'server', 'shared', 'public', 'data', 'packs'];
const rootFiles = [
  '.dockerignore', '.git-blame-ignore-revs', '.gitattributes', '.gitignore', 'AGENTS.md', 'CHANGELOG.md',
  'CLAUDE.md', 'CONTRIBUTING.md', 'Dockerfile', 'eslint.config.js', 'jsconfig.json', 'LICENSE',
  'MANIFEST.json', 'NOTICE.md', 'package-lock.json', 'package.json', 'README.md',
  'THIRD-PARTY-NOTICES.md', 'UPDATE.json', '启动游戏.cmd',
];
const pluginDirs = ['base', 'client', 'docs', 'files', 'tools'];
const pluginFiles = ['plugin.json', 'hooks.mjs', 'start.mjs', 'start-windows.cmd', 'start.sh',
  'README.md', 'DEVELOPMENT.md', '安装说明-给朋友.md'];

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
async function file(from, to) {
  if (!(await fsp.stat(from)).isFile()) throw new Error(`Missing file: ${from}`);
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to);
}
async function tree(from, to, rel = '') {
  const st = await fsp.lstat(from);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Refusing linked source directory: ${from}`);
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === 'node_modules' || entry.name === '.cache' || entry.name === '.git'
      || entry.name === 'dist' || entry.name === 'sp-4-12-16'
      || next === 'data/local-assets.json' || entry.name.endsWith('.log')) continue;
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing linked source: ${src}`);
    if (entry.isDirectory()) await tree(src, dst, next);
    else if (entry.isFile()) await file(src, dst);
  }
}
async function copyDependencies(to) {
  const found = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'ls', '--omit=dev', '--all', '--parseable', '--silent'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (found.error || found.status !== 0) throw new Error(`Production dependencies unavailable: ${found.stderr || found.error}`);
  const deps = [...new Set(found.stdout.split(/\r?\n/).filter((p) => p && path.resolve(p) !== ROOT))];
  if (!deps.some((p) => p.endsWith(`${path.sep}node_modules${path.sep}ws`))) throw new Error('ws dependency missing');
  for (const dep of deps) {
    const src = path.resolve(dep), rel = path.relative(ROOT, src);
    if (!inside(path.join(ROOT, 'node_modules'), src) || !rel.startsWith(`node_modules${path.sep}`)) throw new Error(`Unexpected dependency: ${src}`);
    const dst = path.join(to, rel);
    if (!fs.existsSync(dst)) await tree(src, dst);
  }
  return deps.length;
}
async function main() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 22) throw new Error('Windows Node.js 22+ required');
  if (fs.existsSync(dest)) throw new Error(`Version directory already exists; refusing to modify: ${dest}`);
  const license = path.join(DIST, `node-license-v${process.versions.node}.txt`);
  const notice = fs.readFileSync(license, 'utf8');
  if (!notice.startsWith('Node.js is licensed for use as follows:') || notice.length < 100000) throw new Error(`Missing complete Node license: ${license}`);
  await fsp.mkdir(DIST, { recursive: true });
  const privateRoot = path.join(DIST, '.pack-work');
  await fsp.mkdir(privateRoot, { recursive: true });
  if (!(await fsp.lstat(privateRoot)).isDirectory() || (await fsp.lstat(privateRoot)).isSymbolicLink()) throw new Error('Unsafe private staging root');
  const work = await fsp.mkdtemp(path.join(privateRoot, 'run-'));
  const owner = randomUUID();
  await fsp.writeFile(path.join(work, '.export-owner'), owner, { flag: 'wx' });
  const stage = path.join(work, name);
  const output = path.join(stage, 'app');
  await fsp.mkdir(output, { recursive: true });
  console.log(`Exporting ${name} into private staging…`);
  for (const rel of rootFiles) await file(path.join(ROOT, rel), path.join(output, rel));
  for (const rel of rootDirs) await tree(path.join(ROOT, rel), path.join(output, rel), rel);
  const mpOut = path.join(output, 'sp-mp');
  for (const rel of pluginFiles) await file(path.join(MP, rel), path.join(mpOut, rel));
  for (const rel of pluginDirs) await tree(path.join(MP, rel), path.join(mpOut, rel), `sp-mp/${rel}`);
  const deps = await copyDependencies(output);
  await file(process.execPath, path.join(stage, 'node', 'node.exe'));
  await file(license, path.join(stage, 'node', 'LICENSE-node.txt'));
  for (const rel of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md']) await file(path.join(ROOT, rel), path.join(stage, rel));
  const launch = '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0app"\r\ncall "sp-mp\\start-windows.cmd" %*\r\n';
  await fsp.writeFile(path.join(stage, '启动游戏.cmd'), launch, 'utf8');
  const readme = `# 卫戍协议：盟约 · 完整开发与游玩版\n\n双击「启动游戏.cmd」；浏览器会自动打开。保留启动窗口，结束时在窗口按 Ctrl+C 或关闭窗口。若端口已被旧游戏占用，请关闭旧窗口，或使用 --port 3001 启动。\n\n此目录包含本体 ${app}、sp-mp ${plugin.version}、源码/文档/测试、游戏素材、生产依赖、Windows x64 Node.js ${process.versions.node} 及完整许可。日常修改请在 app 根目录进行，随后运行 node sp-mp/tools/assemble.mjs 和 node sp-mp/tools/build-tree.mjs；sp-mp/files 是生成发行副本。\n\n非官方同人项目，仅限非商业使用；素材版权归原权利人。详见 LICENSE、NOTICE.md、THIRD-PARTY-NOTICES.md、node/LICENSE-node.txt。\n`;
  await fsp.writeFile(path.join(stage, '使用说明.md'), readme, 'utf8');
  if (fs.existsSync(dest)) throw new Error(`Version directory appeared during export: ${dest}`);
  if (!inside(privateRoot, stage) || path.dirname(stage) !== work || (await fsp.readFile(path.join(work, '.export-owner'), 'utf8')) !== owner) throw new Error('Staging ownership check failed');
  await fsp.rename(stage, dest);
  console.log(`Exported ${dest}; production dependencies: ${deps}; Node ${process.versions.node}.`);
  // The empty private work directory is intentionally retained; no public directory is ever cleaned.
}
main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
