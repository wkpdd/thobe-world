// The website dashboard's content: slides, launches, « notify me », the launch
// rules on orders, and the dashboard's login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentStore, parseAlgiers, safeLink, toAlgiersInput } from '../../src/content.js';
import { launchRefusal } from '../../src/launches.js';
import { AdminAuth } from '../../src/admin/auth.js';

const store = (now = new Date('2026-12-01T12:00:00Z')) => new ContentStore({ dir: mkdtempSync(join(tmpdir(), 'tw-content-')), now: () => now });
const IMG = 'm-0123456789abcdef.jpg';

test('dates typed in the dashboard are Algiers time (UTC+1), both ways', () => {
  assert.equal(parseAlgiers('2026-12-24T20:00'), '2026-12-24T19:00:00.000Z');
  assert.equal(toAlgiersInput('2026-12-24T19:00:00.000Z'), '2026-12-24T20:00');
  assert.equal(parseAlgiers(''), null);
  assert.equal(parseAlgiers('not a date'), null);
});

test('slide links: a path on the site or a web address, never a script', () => {
  assert.equal(safeLink('/c/qamis'), '/c/qamis');
  assert.equal(safeLink('https://instagram.com/thobe_world_'), 'https://instagram.com/thobe_world_');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('//evil.example'), '');
});

test('slides: an image is required, the schedule decides what shows, the order can be changed', () => {
  const content = store();
  assert.equal(content.saveSlide({ titleFr: 'Sans image', active: 'on' }).ok, false);
  assert.equal(content.saveSlide({ image: '../../etc/passwd', active: 'on' }).ok, false, 'only names from the media store');
  const a = content.saveSlide({ image: IMG, titleFr: 'A', active: 'on' }).slide;
  const b = content.saveSlide({ image: IMG, titleFr: 'B', active: 'on', startsAt: '2026-12-02T09:00' }).slide; // tomorrow
  content.saveSlide({ image: IMG, titleFr: 'C', active: 'on', endsAt: '2026-12-01T10:00' }); // ended this morning
  content.saveSlide({ image: IMG, titleFr: 'D' }); // not ticked
  assert.deepEqual(content.liveSlides().map((s) => s.titleFr), ['A']);
  assert.deepEqual(content.liveSlides(new Date('2026-12-02T10:00:00Z')).map((s) => s.titleFr), ['A', 'B']);
  content.moveSlide(b.id, -1);
  assert.deepEqual(content.slides().map((s) => s.titleFr).slice(0, 2), ['B', 'A']);
  assert.equal(content.saveSlide({ image: IMG, startsAt: '2026-12-05T10:00', endsAt: '2026-12-04T10:00' }).ok, false);
  content.deleteSlide(a.id);
  assert.equal(content.slide(a.id), null);
  // it survives a restart
  const again = new ContentStore({ dir: join(content.file, '..') });
  assert.equal(again.slides().length, 3);
});

test('launches: locked before the hour, then live; slugs stay unique', () => {
  const content = store();
  assert.equal(content.saveLaunch({ titleFr: 'X', launchAt: '2026-12-10T20:00' }).ok, false, 'needs an article');
  assert.equal(content.saveLaunch({ titleFr: 'X', products: ['p1'] }).ok, false, 'needs a date');
  const l = content.saveLaunch({ titleFr: 'Édition Royale', titleAr: 'الإصدار الملكي', launchAt: '2026-12-10T20:00', products: ['p1', 'p2'], limited: 'on', maxPerCustomer: '2', active: 'on', featured: 'on' }).launch;
  assert.equal(l.slug, 'edition-royale');
  assert.equal(content.saveLaunch({ titleFr: 'Édition Royale', launchAt: '2026-12-10T20:00', products: ['p3'], active: 'on' }).launch.slug, 'edition-royale-2');
  assert.deepEqual(content.launchFor('p1'), { launch: l, state: 'upcoming' });
  assert.equal(content.launchFor('p1', new Date('2026-12-10T19:00:01Z')).state, 'live');
  assert.equal(content.launchFor('unknown'), null);
  assert.equal(content.homeLaunch().id, l.id);
  content.saveLaunch({ ...l, active: '' }, l.id);
  assert.equal(content.launchFor('p1'), null, 'an inactive launch changes nothing');
  assert.equal(content.launchBySlug('edition-royale'), null);
});

test('« notify me »: an Algerian mobile, once per launch', () => {
  const content = store();
  const l = content.saveLaunch({ titleFr: 'L', launchAt: '2026-12-10T20:00', products: ['p1'], active: 'on' }).launch;
  assert.equal(content.subscribe(l.id, { phone: '0221' }).code, 'phone');
  assert.deepEqual(content.subscribe(l.id, { phone: '+213 661 22 33 44', name: 'Karim' }), { ok: true, already: false });
  assert.deepEqual(content.subscribe(l.id, { phone: '0661223344' }), { ok: true, already: true });
  assert.equal(content.subscribe('nope', { phone: '0661223344' }).code, 'gone');
  assert.deepEqual(content.subscribers(l.id).map((s) => [s.phone, s.name]), [['0661223344', 'Karim']]);
  content.deleteLaunch(l.id);
  assert.equal(JSON.parse(readFileSync(content.file, 'utf8')).subscribers.length, 0);
});

test('orders: refused before the launch, capped per phone after it', () => {
  const content = store(new Date('2026-12-10T19:30:00Z'));
  const products = new Map([['p1', { externalId: 'p1', nameFr: 'Qamis', nameAr: 'قميص' }]]);
  const catalogue = { snapshot: () => ({ byExternalId: products }) };
  const rows = [];
  const storage = { shopData: () => ({ products: [{ id: 1, external_id: 'p1' }], orders: rows }) };
  const order = (quantity, phone = '0661223344') => ({ phone, lines: [{ externalId: 'p1', quantity }] });
  content.saveLaunch({ titleFr: 'Royale', launchAt: '2026-12-10T21:00', products: ['p1'], maxPerCustomer: '2', active: 'on' }); // 20:00 UTC
  assert.equal(launchRefusal(order(1), { content, storage, catalogue, now: new Date('2026-12-10T19:59:00Z') })?.code, 'launchLocked');
  const after = new Date('2026-12-10T20:00:01Z');
  assert.equal(launchRefusal(order(2), { content, storage, catalogue, now: after }), null);
  rows.push({ phone: '0661223344', product_id: 1, quantity: 2, status: 'pending' });
  assert.equal(launchRefusal(order(1), { content, storage, catalogue, now: after })?.code, 'launchMax');
  assert.equal(launchRefusal(order(2, '0770112233'), { content, storage, catalogue, now: after }), null, 'another customer');
  rows[0].status = 'cancelled';
  assert.equal(launchRefusal(order(2), { content, storage, catalogue, now: after }), null, 'a cancelled order gives the pieces back');
  assert.equal(launchRefusal({ phone: '0661223344', lines: [{ externalId: 'other', quantity: 9 }] }, { content, storage, catalogue, now: after }), null);
});

test('dashboard login: closed without a long password, signed cookie, lockout, password change signs out', () => {
  let now = 1_000_000;
  assert.equal(new AdminAuth({ user: 'admin', password: 'short', secret: 's' }).enabled, false);
  const auth = new AdminAuth({ user: 'admin', password: 'a-long-enough-password', secret: 's', secure: true, now: () => now });
  assert.equal(auth.login('1.1.1.1', 'admin', 'wrong'), null);
  const cookie = auth.login('1.1.1.1', 'admin', 'a-long-enough-password');
  assert.match(cookie, /^tw_admin=\d+\.[a-f0-9]{64}; Path=\/admin; Max-Age=43200; HttpOnly; SameSite=Strict; Secure$/u);
  const req = { headers: { cookie: cookie.split(';')[0] } };
  assert.equal(auth.check(req), true);
  assert.equal(auth.check({ headers: { cookie: cookie.split(';')[0].replace(/.$/u, (c) => (c === 'a' ? 'b' : 'a')) } }), false, 'tampered');
  now += 13 * 3_600_000;
  assert.equal(auth.check(req), false, 'expired after 12 h');
  for (let i = 0; i < 8; i += 1) auth.login('2.2.2.2', 'admin', 'nope');
  assert.equal(auth.login('2.2.2.2', 'admin', 'a-long-enough-password'), null, 'locked for 15 minutes');
  now += 16 * 60_000;
  const fresh = auth.login('2.2.2.2', 'admin', 'a-long-enough-password');
  assert.ok(fresh);
  const changed = new AdminAuth({ user: 'admin', password: 'another-long-password', secret: 's', now: () => now });
  assert.equal(changed.check({ headers: { cookie: fresh.split(';')[0] } }), false);
});
