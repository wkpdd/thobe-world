// Test doubles for the host: a Passenger stand-in, fake releases, a fake cPanel UAPI.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRelease } from '../../deploy/build.js';

const made = [];
process.on('exit', () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
export const tempDir = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `thobe-test-${name}-`));
  made.push(dir);
  return dir;
};

export async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/**
 * Like Passenger: runs the application root's app.cjs on `port` and starts it
 * again whenever it exits (Passenger would on the next request).
 */
export function passenger(root, port, env = {}) {
  let child = null;
  let stopped = false;
  const output = [];
  const launch = () => {
    if (stopped || !existsSync(join(root, 'app.cjs'))) {
      if (!stopped) setTimeout(launch, 300);
      return;
    }
    child = spawn(process.execPath, [join(root, 'app.cjs')], { cwd: root, env: { ...process.env, ...env, PORT: String(port), TW_BOOTSTRAP_LIBRARY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => output.push(String(d)));
    child.stderr.on('data', (d) => output.push(String(d)));
    child.on('exit', () => {
      child = null;
      if (!stopped) setTimeout(launch, 200);
    });
  };
  launch();
  return {
    output,
    async stop() {
      stopped = true;
      if (child) {
        const gone = new Promise((done) => child.once('exit', done));
        child.kill('SIGKILL');
        await gone;
      }
    },
  };
}

/** A tiny release: its server answers like the store (health, home, sync) or throws when `broken`. */
export function fakeRelease({ id, broken = false }) {
  const repo = tempDir('fake-repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fake', type: 'module' }));
  writeFileSync(join(repo, 'src', 'server.js'), broken
    ? "throw new Error('boom: this release is broken');\n"
    : `import http from 'node:http';
const port = process.env.PORT;
http.createServer((req, res) => {
  if (req.url.startsWith('/health')) {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, products: 3, orders: 0, release: process.env.TW_RELEASE, fallback: process.env.TW_RELEASE_FALLBACK === '1', images: 'webp', dataDir: process.env.DATA_DIR, cwd: process.cwd() }));
  }
  if (req.url.startsWith('/api/sync.php')) { res.statusCode = 401; res.setHeader('content-type', 'application/json'); return res.end('{"ok":false}'); }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body>shop</body></html>');
}).listen(port);
`);
  writeFileSync(join(repo, 'src', 'نص.txt'), 'arabic file name');
  const built = buildRelease({ repo, id, commit: 'test', install: false });
  return { id, commit: 'test', ...built };
}

export const settingsFor = (siteUrl, extra = {}) => ({ siteUrl, healthTimeoutMs: 20_000, healthIntervalMs: 300, lockSettleMs: 20, by: 'test', ...extra });

/** A fake cPanel: UAPI Fileman get_file_content / save_file_content / upload_files on a folder. */
export async function fakeCpanel(home, { user = 'shop', token = 'TOKEN123' } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const answer = (json, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== `cpanel ${user}:${token}`) {
      res.writeHead(401, { 'content-type': 'text/html' });
      return res.end('<html>Login</html>');
    }
    const func = req.url.split('/').pop();
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    const dir = resolve(home, String(form.get('dir')));
    if (!dir.startsWith(home)) return answer({ status: 0, errors: ['outside home'] });
    calls.push(`${func} ${String(form.get('dir'))}/${form.get('file') ?? form.get('file-1')?.name}`);
    if (func === 'get_file_content') {
      const file = join(dir, String(form.get('file')));
      if (!existsSync(file)) return answer({ status: 0, errors: [`The file “${file}” does not exist.`], data: null });
      return answer({ status: 1, errors: null, data: { content: readFileSync(file, 'utf8'), dir, filename: form.get('file') } });
    }
    if (func === 'save_file_content') {
      if (!existsSync(dir)) return answer({ status: 0, errors: [`The directory “${dir}” does not exist.`] });
      writeFileSync(join(dir, String(form.get('file'))), String(form.get('content')));
      return answer({ status: 1, errors: null, data: { path: dir } });
    }
    if (func === 'upload_files') {
      const blob = form.get('file-1');
      if (!existsSync(dir)) return answer({ status: 0, errors: ['no dir'], data: { failed: 1, uploads: [{ reason: 'no dir' }] } });
      writeFileSync(join(dir, blob.name), Buffer.from(await blob.arrayBuffer()));
      return answer({ status: 1, errors: null, data: { succeeded: 1, failed: 0, warned: 0, uploads: [{ file: blob.name, status: 1, reason: 'Upload of “x” succeeded.' }] } });
    }
    return answer({ status: 0, errors: ['unknown function'] });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${server.address().port}`, user, token, calls, close: () => new Promise((done) => server.close(done)) };
}
