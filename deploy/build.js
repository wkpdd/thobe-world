/**
 * Build a release package from the committed code: src/, public/, package.json
 * and the production node_modules installed for the server's platform (Linux
 * x64, glibc), so the host never needs « Run NPM Install » and a deploy from
 * Windows or a Mac still ships the right `sharp` binaries.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const MAGIC = 'TWPKG1\n';
export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
/** What a release contains, relative to the repository. Tests, design files and docs stay home. */
export const INCLUDE = ['package.json', 'package-lock.json', 'src', 'public'];

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Commit, branch and whether the included files have uncommitted changes. */
export function gitState(repo = REPO) {
  try {
    const commit = git(['rev-parse', '--short=8', 'HEAD'], repo);
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
    const dirty = git(['status', '--porcelain', '--', ...INCLUDE], repo) !== '';
    return { commit, branch, dirty };
  } catch {
    return { commit: 'nogit', branch: '', dirty: true };
  }
}

/** "20261126-142233-1a2b3c4d": sortable, unique per deploy, names the commit. */
export function releaseId(commit, dirty, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:]/gu, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${commit}${dirty ? '-dirty' : ''}`;
}

/** Every regular file under `dir` (symlinks and node_modules/.bin skipped), as posix paths. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === '.bin' && current.endsWith(`${sep}node_modules`)) continue;
        walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Pack `dir` into the format deploy/bootstrap.cjs unpacks. */
export function pack(dir) {
  const parts = [Buffer.from(MAGIC, 'latin1')];
  let files = 0;
  let bytes = 0;
  for (const rel of listFiles(dir)) {
    const full = join(dir, ...rel.split('/'));
    const content = readFileSync(full);
    const header = Buffer.from(JSON.stringify({ p: rel, m: lstatSync(full).mode & 0o777, s: content.length }), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    parts.push(length, header, content);
    files += 1;
    bytes += content.length;
  }
  const buffer = gzipSync(Buffer.concat(parts), { level: 9 });
  return { buffer, files, bytes, sha256: createHash('sha256').update(buffer).digest('hex') };
}

/**
 * Stage the release in a temp folder and pack it.
 * `install: false` skips npm (tests that build tiny fake releases).
 */
export function buildRelease({ repo = REPO, id, commit, install = true, log = () => {} } = {}) {
  const stage = mkdtempSync(join(tmpdir(), 'thobe-release-'));
  try {
    for (const item of INCLUDE) {
      const from = join(repo, item);
      if (existsSync(from)) cpSync(from, join(stage, item), { recursive: true });
    }
    if (install) {
      log('npm ci --omit=dev for linux-x64 (glibc)…');
      execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--os=linux', '--cpu=x64', '--libc=glibc'], {
        cwd: stage,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      const sharpBinary = join(stage, 'node_modules', '@img', 'sharp-linux-x64');
      if (!existsSync(sharpBinary)) throw new Error('npm did not install @img/sharp-linux-x64: photos would not be resized on the server');
    }
    writeFileSync(join(stage, 'release.json'), `${JSON.stringify({ id, commit, builtAt: new Date().toISOString(), builtWith: process.version }, null, 2)}\n`);
    const result = pack(stage);
    log(`packed ${result.files} files, ${(result.bytes / 1e6).toFixed(1)} MB → ${(result.buffer.length / 1e6).toFixed(1)} MB gzipped`);
    return result;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Write a package to disk (the transports upload files). */
export function savePackage(buffer, id) {
  const dir = mkdtempSync(join(tmpdir(), 'thobe-pkg-'));
  const file = join(dir, `release-${id}.twpkg`);
  writeFileSync(file, buffer);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
