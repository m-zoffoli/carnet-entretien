import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => 'refresh', setItem() {}, removeItem() {} };
const { ConflictError, DropboxStore, MissingScopeError, headerJson } = await import('../js/store.js');

const json = (status, body) => new Response(JSON.stringify(body), { status });

test('l’en-tête Dropbox échappe les accents', () => {
  assert.equal(headerJson({ path: '/Révision' }), '{"path":"/R\\u00e9vision"}');
});

test('un carnet absent est signalé sans erreur', async () => {
  const store = new DropboxStore('/Carnet', async () => json(409, { error_summary: 'path/not_found/..' }), 'tok');
  assert.deepEqual(await store.load(), { data: null, rev: null });
});

test('le carnet est lu avec sa révision', async () => {
  const fetchImpl = async () =>
    new Response('{"version":1}', { status: 200, headers: { 'Dropbox-API-Result': '{"rev":"abc"}' } });
  const store = new DropboxStore('/Carnet', fetchImpl, 'tok');
  assert.deepEqual(await store.load(), { data: { version: 1 }, rev: 'abc' });
});

test('l’enregistrement exige la révision connue', async () => {
  let arg;
  const fetchImpl = async (_url, init) => {
    arg = JSON.parse(init.headers['Dropbox-API-Arg']);
    return json(200, { rev: 'def' });
  };
  const store = new DropboxStore('/Carnet', fetchImpl, 'tok');
  assert.equal(await store.save({ a: 1 }, 'abc'), 'def');
  assert.deepEqual(arg.mode, { '.tag': 'update', update: 'abc' });
  assert.equal(arg.strict_conflict, true);
});

test('une modification concurrente lève un conflit', async () => {
  const store = new DropboxStore('/Carnet', async () => json(409, { error_summary: 'path/conflict/file/..' }), 'tok');
  await assert.rejects(store.save({}, 'abc'), ConflictError);
});

test('un jeton expiré est renouvelé une fois', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json(200, { access_token: 'neuf' });
  const seen = [];
  const fetchImpl = async (_url, init) => {
    seen.push(init.headers.Authorization);
    return seen.length === 1 ? new Response('', { status: 401 }) : json(200, { rev: 'r2' });
  };
  try {
    const store = new DropboxStore('/Carnet', fetchImpl, 'vieux');
    assert.equal(await store.save({}, 'r1'), 'r2');
    assert.deepEqual(seen, ['Bearer vieux', 'Bearer neuf']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('le lien du calendrier est créé en public, en lecture seule', async () => {
  let sent;
  const store = new DropboxStore('/Carnet', async (url, init) => {
    sent = { url, arg: JSON.parse(init.body) };
    return json(200, { url: 'https://dropbox/lien' });
  }, 'tok');
  assert.equal(await store.sharedLink('echeances.ics'), 'https://dropbox/lien');
  assert.match(sent.url, /create_shared_link_with_settings$/);
  assert.deepEqual(sent.arg, { path: '/Carnet/echeances.ics', settings: { audience: 'public', access: 'viewer' } });
});

test('un lien déjà existant est réutilisé', async () => {
  const store = new DropboxStore('/Carnet', async () => json(409, {
    error_summary: 'shared_link_already_exists/..',
    error: { shared_link_already_exists: { metadata: { url: 'https://dropbox/existant' } } },
  }), 'tok');
  assert.equal(await store.sharedLink('echeances.ics'), 'https://dropbox/existant');
});

test('un droit manquant est signalé pour pouvoir le demander', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => json(200, { access_token: 'neuf' }); // le renouvellement du jeton après le 401
  try {
    const store = new DropboxStore('/Carnet', async () => json(401, { error: { '.tag': 'missing_scope' } }), 'tok');
    await assert.rejects(store.sharedLink('echeances.ics'), MissingScopeError);
  } finally {
    globalThis.fetch = realFetch;
  }
});
