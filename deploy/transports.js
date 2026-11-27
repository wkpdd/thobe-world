/**
 * How the deploy tool reaches the application root on the host. Three ways,
 * one interface, all paths relative to the application root:
 *
 *   read(rel)              → text, or null when the file does not exist
 *   write(rel, text)       → create or replace a small text file
 *   upload(rel, localFile) → create or replace a (large) file
 *   close()
 *
 * - cpanel: cPanel's UAPI (Fileman) over HTTPS. Works from anywhere that can
 *   open https://cpanel.<domain>, including a Claude cloud session.
 * - ftp:    FTP with TLS (FTPS) by default. For a PC or a CI runner; a Claude
 *   cloud session cannot open FTP connections.
 * - local:  a folder on this machine (tests, rehearsals).
 */
import { mkdirSync, openAsBlob, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { Readable, Writable } from 'node:stream';

export function localTransport({ dir }) {
  const full = (rel) => join(dir, ...rel.split('/'));
  return {
    describe: `local folder ${dir}`,
    async read(rel) {
      return existsSync(full(rel)) ? readFileSync(full(rel), 'utf8') : null;
    },
    async write(rel, text) {
      mkdirSync(dirname(full(rel)), { recursive: true });
      writeFileSync(full(rel), text);
    },
    async upload(rel, file) {
      mkdirSync(dirname(full(rel)), { recursive: true });
      copyFileSync(file, full(rel));
    },
    async close() {},
  };
}

const MISSING = /no such file|does not exist|not exist|cannot find|not found|ENOENT|n’existe pas|n'existe pas/iu;

/**
 * cPanel UAPI. Authentication, in order of preference:
 *   - CPANEL_USER + CPANEL_TOKEN  → "Authorization: cpanel user:token" (cPanel → Security → Manage API Tokens)
 *   - CPANEL_USER + CPANEL_PASSWORD → HTTP Basic
 *   - auth: 'proxy' → no header: a Claude cloud session's proxy adds the saved credential.
 */
export function cpanelTransport({ url, user, token, password, auth, appDir, fetchImpl = fetch, timeoutMs = 600_000 }) {
  if (!url) throw new Error('CPANEL_URL is missing (e.g. https://cpanel.example.dz or https://server.host.com:2083)');
  if (!appDir) throw new Error('APP_DIR is missing (the application root, e.g. thobe-world)');
  const base = url.replace(/\/+$/u, '');
  const parsed = new URL(base);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('CPANEL_URL must start with https:// (the login would otherwise travel in clear text)');
  }
  const headers = {};
  if (auth !== 'proxy') {
    if (user && token) headers.authorization = `cpanel ${user}:${token}`;
    else if (user && password) headers.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    else throw new Error('cPanel credentials missing: set CPANEL_USER with CPANEL_TOKEN (or CPANEL_PASSWORD), or CPANEL_AUTH=proxy');
  }
  const split = (rel) => {
    const full = posix.join(appDir, rel);
    return { dir: posix.dirname(full), file: posix.basename(full) };
  };

  async function call(func, body, { allowMissing = false } = {}) {
    const response = await fetchImpl(`${base}/execute/Fileman/${func}`, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) throw new Error(`cPanel refused the login (HTTP ${response.status}): check the cPanel user and token/password`);
    if (response.status >= 300 && response.status < 400) throw new Error(`cPanel answered a redirect (HTTP ${response.status} → ${response.headers.get('location')}): check CPANEL_URL and the login`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`cPanel answered something that is not the API (HTTP ${response.status}): ${text.slice(0, 160).replace(/\s+/gu, ' ')}`);
    }
    if (json.status !== 1) {
      const message = [...(json.errors ?? []), ...(json.messages ?? [])].join(' ') || 'unknown error';
      if (allowMissing && MISSING.test(message)) return null;
      throw new Error(`cPanel Fileman::${func}: ${message}`);
    }
    return json;
  }

  return {
    describe: `cPanel ${base} → ~/${appDir}`,
    async read(rel) {
      const { dir, file } = split(rel);
      const json = await call('get_file_content', new URLSearchParams({ dir, file, from_charset: 'utf-8', to_charset: 'utf-8' }), { allowMissing: true });
      return json === null ? null : String(json.data?.content ?? '');
    },
    async write(rel, text) {
      const { dir, file } = split(rel);
      await call('save_file_content', new URLSearchParams({ dir, file, content: text, from_charset: 'utf-8', to_charset: 'utf-8', fallback: '1' }));
    },
    async upload(rel, localFile) {
      const { dir, file } = split(rel);
      const form = new FormData();
      form.set('dir', dir);
      form.set('overwrite', '1');
      form.set('file-1', await openAsBlob(localFile), file);
      const json = await call('upload_files', form);
      const failed = Number(json.data?.failed ?? 0);
      if (failed > 0) throw new Error(`cPanel upload failed: ${(json.data?.uploads ?? []).map((u) => u.reason).join(' ')}`);
    },
    async close() {},
  };
}

/**
 * FTP / FTPS with basic-ftp (a dev dependency: only the machine that deploys needs it).
 * FTP_HOST may be an IP address: the TLS certificate is then checked against
 * `tlsServername` (the server's name, e.g. server123.host.dz) instead of the IP.
 */
export async function ftpTransport({ host, port, user, password, secure = true, tlsServername, appDir }) {
  if (!host || !user || !password) throw new Error('FTP_HOST, FTP_USER and FTP_PASSWORD are required for DEPLOY_METHOD=ftp');
  const { Client } = await import('basic-ftp');
  const client = new Client(60_000);
  const secureOptions = tlsServername ? { servername: tlsServername } : undefined;
  try {
    await client.access({ host, port: Number(port ?? 21), user, password, secure, secureOptions });
  } catch (error) {
    client.close();
    throw explainFtpError(error, { host, tlsServername });
  }
  const root = appDir ?? '';
  const remote = (rel) => (root ? posix.join(root, rel) : rel);
  const ensureParent = async (rel) => {
    const parent = posix.dirname(remote(rel));
    if (parent === '.' || parent === '') return;
    const here = await client.pwd();
    try {
      await client.ensureDir(parent);
    } finally {
      await client.cd(here);
    }
  };
  // basic-ftp runs one command at a time on the control connection.
  let chain = Promise.resolve();
  const serial = (job) => {
    const run = chain.then(job, job);
    chain = run.catch(() => {});
    return run;
  };
  return {
    describe: `FTP${secure ? 'S' : ''} ${user}@${host} → ${root || '(login folder)'}`,
    read: (rel) =>
      serial(async () => {
        const chunks = [];
        const sink = new Writable({
          write(chunk, _enc, done) {
            chunks.push(chunk);
            done();
          },
        });
        try {
          await client.downloadTo(sink, remote(rel));
        } catch (error) {
          if (error.code === 550) return null;
          throw error;
        }
        return Buffer.concat(chunks).toString('utf8');
      }),
    write: (rel, text) =>
      serial(async () => {
        await ensureParent(rel);
        await client.uploadFrom(Readable.from([Buffer.from(text, 'utf8')]), remote(rel));
      }),
    upload: (rel, file) =>
      serial(async () => {
        await ensureParent(rel);
        await client.uploadFrom(file, remote(rel));
      }),
    close: () => serial(async () => client.close()),
  };
}

/** Turn TLS and login failures into what to change in .deploy.env. */
function explainFtpError(error, { host, tlsServername }) {
  if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    const names = String(error.cert?.subjectaltname ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('DNS:'))
      .map((n) => n.slice(4));
    // The name is NOT offered as a line to copy: on a hostile network the certificate could be an
    // attacker's. The owner takes the server name from cPanel or the host, then compares.
    return new Error(
      `the FTP server's certificate is for ${names.join(', ') || error.cert?.subject?.CN || 'another name'}, not for « ${tlsServername ?? host} ».\n`
        + '  Find your server\'s name in cPanel (General Information → « Server Name » / « Shared IP »'
        + ' or the hosting welcome email). Only if it is one of the names above, add to .deploy.env:\n'
        + '    FTP_TLS_SERVERNAME=<that server name>',
    );
  }
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED'].includes(error.code)) {
    return new Error(`the FTP server's certificate is not trusted (${error.code}). Ask the host for the server's FTP name and set FTP_HOST or FTP_TLS_SERVERNAME to it.`);
  }
  if (error.code === 530) return new Error('the FTP server refused the login (530): check FTP_USER and FTP_PASSWORD');
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return new Error(`cannot reach the FTP server ${host}:${error.port ?? 21} (${error.code}): check FTP_HOST and FTP_PORT`);
  }
  return error;
}

/** The transport the settings ask for. */
export async function openTransport(settings) {
  switch (settings.method) {
    case 'cpanel':
      return cpanelTransport(settings.cpanel);
    case 'ftp':
      return ftpTransport(settings.ftp);
    case 'local':
      return localTransport({ dir: settings.local.dir });
    default:
      throw new Error(`DEPLOY_METHOD must be cpanel, ftp or local (got « ${settings.method ?? ''} »)`);
  }
}
