'use strict';

const Dawrha = {
  base: 'http://localhost:3000/api/v1',

  uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx').replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
  },

  deviceId(role) {
    const k = 'dawrha.device.' + role;
    let v = localStorage.getItem(k);
    if (!v) {
      v = Dawrha.uid();
      localStorage.setItem(k, v);
    }
    return v;
  },

  sessionKey(role) { return 'dawrha.session.' + role; },

  session(role) {
    try { return JSON.parse(localStorage.getItem(Dawrha.sessionKey(role)) || 'null'); }
    catch { return null; }
  },

  saveSession(role, details, roleName) {
    const s = {
      access: details && details.token ? details.token.accessToken : null,
      refresh: details && details.token ? details.token.refreshToken : null,
      status: details ? details.status : null,
      role: roleName || null,
      at: Date.now(),
    };
    localStorage.setItem(Dawrha.sessionKey(role), JSON.stringify(s));
    return s;
  },

  logout(role) {
    localStorage.removeItem(Dawrha.sessionKey(role));
  },

  async raw(method, path, opts) {
    opts = opts || {};
    let url = Dawrha.base + path;
    if (opts.query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== '' && v !== null && v !== undefined) q.set(k, v);
      }
      const s = q.toString();
      if (s) url += '?' + s;
    }
    const headers = { 'Content-Type': 'application/json' };
    const tok = opts.token || (opts.role ? (Dawrha.session(opts.role) || {}).access : null);
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const resp = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let json = null;
    try { json = await resp.json(); } catch { json = null; }
    if (!resp.ok || (json && json.success === false)) {
      const err = new Error(json && json.message ? json.message : ('HTTP ' + resp.status));
      err.json = json;
      err.status = resp.status;
      throw err;
    }
    return json;
  },

  async call(method, path, opts) {
    const json = await Dawrha.raw(method, path, opts);
    return json && json.data !== undefined ? json.data : json;
  },

  async callForm(role, method, path, fields, fileInput) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields || {})) {
      if (v !== '' && v !== null && v !== undefined && v !== false) fd.append(k, v);
    }
    if (fileInput && fileInput.files && fileInput.files[0]) {
      fd.append('file', fileInput.files[0]);
    }
    const tok = (Dawrha.session(role) || {}).access;
    const resp = await fetch(Dawrha.base + path, {
      method,
      headers: tok ? { Authorization: 'Bearer ' + tok } : {},
      body: fd,
    });
    let json = null;
    try { json = await resp.json(); } catch { json = null; }
    if (!resp.ok || (json && json.success === false)) {
      const err = new Error(json && json.message ? json.message : ('HTTP ' + resp.status));
      err.json = json;
      err.status = resp.status;
      throw err;
    }
    return json && json.data !== undefined ? json.data : json;
  },

  async login(role, appPath, email, password, extra) {
    const body = Object.assign(
      { email: email, password: password, deviceId: Dawrha.deviceId(role) },
      extra || {}
    );
    const json = await Dawrha.raw('POST', '/auth/login/' + appPath, { body });
    const data = json.data || {};
    const s = Dawrha.saveSession(role, data.details, data.role);
    return { json, session: s };
  },

  asArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    for (const k of ['items', 'records', 'rows', 'list', 'results', 'data']) {
      if (Array.isArray(obj[k])) return obj[k];
    }
    return [];
  },

  rows(obj) {
    return Dawrha.asArray(obj);
  },
};
