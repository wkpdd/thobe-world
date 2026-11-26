// FTPS to a server reached by its IP address, whose certificate carries a name
// (the usual shared-hosting case): refused with the name to set, then working
// once FTP_TLS_SERVERNAME is set. Needs openssl and pyftpdlib + pyOpenSSL
// (FTP_TEST_PYTHON points at that python).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, tempDir } from './helpers.js';

const python = process.env.FTP_TEST_PYTHON ?? 'python3';
const ready = spawnSync(python, ['-c', 'import pyftpdlib, OpenSSL'], { stdio: 'ignore' }).status === 0
  && spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
const transports = fileURLToPath(new URL('../../deploy/transports.js', import.meta.url));

const SERVER = `
import sys
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import TLS_FTPHandler
from pyftpdlib.servers import FTPServer
home, port, cert, key = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
auth = DummyAuthorizer(); auth.add_user('shop', 'secret', home, perm='elradfmwMT')
TLS_FTPHandler.certfile = cert; TLS_FTPHandler.keyfile = key
TLS_FTPHandler.tls_control_required = True; TLS_FTPHandler.tls_data_required = True
TLS_FTPHandler.authorizer = auth; TLS_FTPHandler.passive_ports = range(40000, 40100)
FTPServer(('127.0.0.1', port), TLS_FTPHandler).serve_forever()
`;

/** Run ftpTransport in a child that trusts our test CA (as a PC trusts the host's real CA). */
function tryFtp(ca, options) {
  const script = `
    const { ftpTransport } = await import(${JSON.stringify(transports)});
    try {
      const t = await ftpTransport(${JSON.stringify(options)});
      await t.write('CURRENT', 'release-ftps\\n');
      console.log(JSON.stringify({ ok: true, read: await t.read('CURRENT') }));
      await t.close();
    } catch (error) { console.log(JSON.stringify({ ok: false, message: error.message })); }`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_EXTRA_CA_CERTS: ca }, encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(child.stdout.trim().split('\n').pop());
}

test('FTPS by IP address: the certificate name is asked for, then used', { skip: ready ? false : 'needs openssl, pyftpdlib and pyOpenSSL' }, async () => {
  const dir = tempDir('ftps');
  const home = join(dir, 'home');
  mkdirSync(join(home, 'thobe-world'), { recursive: true });
  const ssl = (args) => assert.equal(spawnSync('openssl', args, { cwd: dir, stdio: 'ignore' }).status, 0, `openssl ${args[0]}`);
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Test Hosting CA', '-keyout', 'ca.key', '-out', 'ca.pem']);
  ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=server1.host.test', '-keyout', 'server.key', '-out', 'server.csr']);
  writeFileSync(join(dir, 'ext.cnf'), 'subjectAltName=DNS:server1.host.test,DNS:*.host.test\n');
  ssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '2', '-extfile', 'ext.cnf', '-out', 'server.pem']);

  const port = await freePort();
  const ftpd = spawn(python, ['-c', SERVER, home, String(port), join(dir, 'server.pem'), join(dir, 'server.key')], { stdio: 'ignore' });
  try {
    const base = { host: '127.0.0.1', port, user: 'shop', password: 'secret', secure: true, appDir: 'thobe-world' };
    let first;
    for (let i = 0; i < 40; i += 1) {
      first = tryFtp(join(dir, 'ca.pem'), base);
      if (!/cannot reach/u.test(first.message ?? '')) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    assert.equal(first.ok, false);
    assert.match(first.message, /certificate is for server1\.host\.test, \*\.host\.test, not for « 127\.0\.0\.1 »/u);
    assert.match(first.message, /FTP_TLS_SERVERNAME=server1\.host\.test/u);

    const second = tryFtp(join(dir, 'ca.pem'), { ...base, tlsServername: 'server1.host.test' });
    assert.deepEqual(second, { ok: true, read: 'release-ftps\n' });

    const wrong = tryFtp(join(dir, 'ca.pem'), { ...base, tlsServername: 'server1.host.test', password: 'nope' });
    assert.match(wrong.message, /refused the login \(530\)/u);
  } finally {
    ftpd.kill();
  }
});
