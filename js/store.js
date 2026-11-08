import { DROPBOX_APP_KEY, DEFAULT_FOLDER } from './config.js';

export class ConflictError extends Error {
  constructor() {
    super('Le carnet a été modifié depuis un autre téléphone.');
    this.name = 'ConflictError';
  }
}

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* stockage indisponible */ }
};

export const getMode = () => read('carnet.mode');
export const setMode = (mode) => write('carnet.mode', mode);
export const getFolder = () => read('carnet.folder') || DEFAULT_FOLDER;
export const setFolder = (folder) => write('carnet.folder', folder);

// --- Mode local : tout reste dans ce navigateur -----------------------------

function openFilesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('carnet-fichiers', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withFiles(mode, action) {
  const db = await openFilesDb();
  return new Promise((resolve, reject) => {
    const req = action(db.transaction('files', mode).objectStore('files'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class LocalStore {
  label = 'Sur cet appareil uniquement';

  async load() {
    const raw = read('carnet.data');
    return raw ? { data: JSON.parse(raw), rev: null } : { data: null, rev: null };
  }

  async save(data) {
    write('carnet.data', JSON.stringify(data));
    return null;
  }

  putFile(path, blob) { return withFiles('readwrite', (s) => s.put(blob, path)); }
  getFile(path) { return withFiles('readonly', (s) => s.get(path)); }
  deleteFile(path) { return withFiles('readwrite', (s) => s.delete(path)); }
}

// --- Connexion Dropbox sans serveur (PKCE) ----------------------------------

const redirectUri = () => location.origin + location.pathname;
const base64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const dropboxConfigured = () => Boolean(DROPBOX_APP_KEY);
export const isConnected = () => Boolean(read('carnet.dbx.refresh'));

export async function beginDropboxAuth() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  write('carnet.pkce', JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: base64Url(digest),
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
    state,
    scope: 'files.metadata.read files.content.read files.content.write',
  });
  location.assign('https://www.dropbox.com/oauth2/authorize?' + params);
}

async function tokenRequest(fields) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: DROPBOX_APP_KEY, ...fields }),
  });
  if (!res.ok) throw new Error('Dropbox a refusé la connexion.');
  return res.json();
}

/** Termine la connexion au retour de Dropbox. Renvoie true si l'adresse contenait une réponse. */
export async function completeDropboxAuth() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  const saved = JSON.parse(read('carnet.pkce') || 'null');
  write('carnet.pkce', null);
  history.replaceState(null, '', location.pathname);
  if (params.has('error')) throw new Error('Connexion Dropbox annulée.');
  if (!saved || saved.state !== params.get('state')) throw new Error('Réponse Dropbox invalide, recommence la connexion.');
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    code_verifier: saved.verifier,
    redirect_uri: redirectUri(),
  });
  write('carnet.dbx.refresh', token.refresh_token);
  sessionStorage.setItem('carnet.dbx.access', token.access_token);
  setMode('dropbox');
  return true;
}

export function disconnectDropbox() {
  write('carnet.dbx.refresh', null);
  sessionStorage.removeItem('carnet.dbx.access');
  setMode(null);
}

/** Encode l'en-tête Dropbox-API-Arg : seuls les caractères ASCII y sont autorisés. */
export const headerJson = (value) =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export class DropboxStore {
  label = 'Dropbox';

  constructor(folder, fetchImpl = (...args) => fetch(...args), access = null) {
    this.folder = folder.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.access = access;
  }

  async token(force = false) {
    if (!force && this.access) return this.access;
    if (!force) {
      const cached = sessionStorage.getItem('carnet.dbx.access');
      if (cached) return (this.access = cached);
    }
    const refresh = read('carnet.dbx.refresh');
    if (!refresh) throw new Error('Reconnecte Dropbox depuis les réglages.');
    const result = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
    this.access = result.access_token;
    sessionStorage.setItem('carnet.dbx.access', this.access);
    return this.access;
  }

  async call(url, buildInit) {
    let res = await this.fetch(url, buildInit(await this.token()));
    if (res.status === 401) res = await this.fetch(url, buildInit(await this.token(true)));
    return res;
  }

  content(endpoint, arg, body) {
    return this.call('https://content.dropboxapi.com/2/files/' + endpoint, (token) => ({
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': headerJson(arg),
        ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body,
    }));
  }

  rpc(endpoint, arg) {
    return this.call('https://api.dropboxapi.com/2/files/' + endpoint, (token) => ({
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(arg),
    }));
  }

  async revOf(path) {
    const res = await this.rpc('get_metadata', { path });
    if (!res.ok) throw new Error('Lecture des informations Dropbox impossible.');
    return (await res.json()).rev;
  }

  async load() {
    const path = this.folder + '/carnet.json';
    const res = await this.content('download', { path });
    if (res.status === 409) {
      const error = await res.json();
      if (String(error.error_summary).startsWith('path/not_found')) return { data: null, rev: null };
      throw new Error('Dropbox : ' + error.error_summary);
    }
    if (!res.ok) throw new Error('Lecture du carnet impossible.');
    const header = res.headers.get('Dropbox-API-Result');
    const data = JSON.parse(await res.text());
    const rev = header ? JSON.parse(header).rev : await this.revOf(path);
    return { data, rev };
  }

  async save(data, rev) {
    const res = await this.content(
      'upload',
      {
        path: this.folder + '/carnet.json',
        mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' },
        autorename: false,
        strict_conflict: true,
        mute: true,
      },
      new Blob([JSON.stringify(data, null, 2)]),
    );
    if (res.status === 409) {
      const error = await res.json();
      if (String(error.error_summary).includes('conflict')) throw new ConflictError();
      throw new Error('Dropbox : ' + error.error_summary);
    }
    if (!res.ok) throw new Error('Enregistrement Dropbox impossible.');
    return (await res.json()).rev;
  }

  async putFile(name, blob) {
    const res = await this.content('upload', { path: `${this.folder}/${name}`, mode: { '.tag': 'overwrite' }, mute: true }, blob);
    if (!res.ok) throw new Error('Envoi du fichier impossible.');
  }

  async getFile(name) {
    const res = await this.content('download', { path: `${this.folder}/${name}` });
    if (!res.ok) throw new Error('Lecture du fichier impossible.');
    return res.blob();
  }

  async deleteFile(name) {
    const res = await this.rpc('delete_v2', { path: `${this.folder}/${name}` });
    if (!res.ok && res.status !== 409) throw new Error('Suppression du fichier impossible.');
  }
}
