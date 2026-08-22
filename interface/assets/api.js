/* ============================================================
   دورها — عميل الـ API الحقيقي (fetch + جلسات + أخطاء)
   كل النداءات تذهب إلى DAW_CONFIG.BASE_URL مع Bearer token.
   ============================================================ */
(function () {
  var cfg = window.DAW_CONFIG || {};
  var BASE = cfg.BASE_URL || 'http://localhost:3000/api/v1';
  var APP = (document.body && document.body.className.match(/\b(user|driver|admin)\b/) || ['', 'user'])[1];
  var DEVICE = (cfg.DEVICES && cfg.DEVICES[APP]) || cfg.DEVICE_ID || '55555555-5555-4555-8555-555555555555';

  var LS = {
    token: 'daw_token',
    refresh: 'daw_refresh',
    role: 'daw_role',
    status: 'daw_status',
    user: 'daw_user',
    tmp: 'daw_tmp'
  };

  function getToken(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setToken(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- core request ---------- */
  async function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    var payload = null;
    var auth = opts.auth !== false;

    if (opts.multipart) {
      payload = opts.multipart;
    } else if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    if (opts.bearer) headers['Authorization'] = 'Bearer ' + opts.bearer;
    else if (auth && getToken(LS.token)) headers['Authorization'] = 'Bearer ' + getToken(LS.token);

    var res;
    try {
      res = await fetch(BASE + '/' + path, { method: method, headers: headers, body: payload });
    } catch (err) {
      throw { status: 0, message: 'تعذر الاتصال بالخادم (' + BASE + ') — تأكد من تشغيل الباك وأن عنوان BASE_URL صحيح' };
    }

    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

    if (res.status === 401 && !opts.noRetry && getToken(LS.token)) {
      var refreshed = await tryRefresh();
      if (refreshed) return request(method, path, body, opts.noRetry ? opts : Object.assign({}, opts, { noRetry: true }));
    }

    if (!res.ok) {
      var msg = (json && (json.message || json.error)) || 'خطأ ' + res.status;
      if (json && Array.isArray(json.message)) msg = json.message.map(function (m) { return m.message || m; }).join(' · ');
      throw { status: res.status, message: msg, data: json };
    }
    return json;
  }

  async function tryRefresh() {
    var refresh = getToken(LS.refresh);
    if (!refresh) { clearSession(); return false; }
    try {
      var res = await fetch(BASE + '/auth/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + refresh },
        body: JSON.stringify({ deviceId: DEVICE })
      });
      var json = await res.json();
      if (!res.ok) { clearSession(); return false; }
      var t = json.result || json;
      saveTokens(t.accessToken, t.refreshToken);
      return true;
    } catch (e) { clearSession(); return false; }
  }

  function saveTokens(access, refresh) {
    if (access) setToken(LS.token, access);
    if (refresh) setToken(LS.refresh, refresh);
  }
  function saveSession(access, refresh, role, status, user) {
    saveTokens(access, refresh);
    if (role) setToken(LS.role, role);
    if (status) setToken(LS.status, status);
    if (user) setToken(LS.user, JSON.stringify(user));
  }
  function clearSession() {
    [LS.token, LS.refresh, LS.role, LS.status, LS.user, LS.tmp].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* استخراج قائمة من استجابات متعددة الأشكال */
  function list(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
    if (json.items && Array.isArray(json.items)) return json.items;
    if (json.rows && Array.isArray(json.rows)) return json.rows;
    if (json.result && Array.isArray(json.result)) return json.result;
    if (json.data && typeof json.data === 'object') {
      var d = json.data;
      var keys = Object.keys(d).filter(function (k) {
        return k !== 'pagination' && Array.isArray(d[k]);
      });
      if (keys.length) return d[keys[0]];
    }
    if (json.result && typeof json.result === 'object') {
      if (Array.isArray(json.result.items)) return json.result.items;
      if (Array.isArray(json.result.rows)) return json.result.rows;
      if (Array.isArray(json.result.data)) return json.result.data;
      var rk = Object.keys(json.result).filter(function (k) {
        return k !== 'pagination' && Array.isArray(json.result[k]);
      });
      if (rk.length) return json.result[rk[0]];
      return Object.keys(json.result).map(function (k) { return json.result[k]; });
    }
    return [];
  }
  /* أول عنصر أو الكائن نفسه — للمفرد */
  function one(json) {
    if (!json) return {};
    if (json.data && typeof json.data === 'object') return json.data;
    if (json.result && typeof json.result === 'object') return json.result;
    return json;
  }

  function toast(msg, type) {
    if (window.ui) type === 'err' ? ui.err(msg) : ui.ok(msg);
    else console[type === 'err' ? 'error' : 'log'](msg);
  }

  /* ---------- auth flows ---------- */
  async function login(endpoint, { email, password }, pages) {
    var json;
    try {
      json = await request('POST', 'auth/' + endpoint, {
        email: email, password: password,
        deviceId: DEVICE, deviceType: cfg.DEVICE_TYPE || 'ANDROID',
        rememberMy: cfg.REMEMBER_ME !== false
      }, { noRetry: true });
    } catch (e) {
      toast(e.message || 'فشل الدخول', 'err');
      return null;
    }
    var d = (json.data && json.data.details) || json.details || json;
    var role = json.role || (json.data && json.data.role) || getToken(LS.role);
    var status = d.status;
    saveSession(
      d.token && d.token.accessToken,
      d.token && d.token.refreshToken,
      role, status,
      { email: email }
    );
    if (d.token && d.token.accessToken) setToken(LS.status, status);

    if (status === 'ACTIVE_ACCOUNT' || status === 'ACTIVE') {
      if (pages.home) location.href = pages.home;
      else { toast('دخول ناجح — الحساب نشط'); }
      return d;
    }
    if (status === 'PENDING_PROFILE') {
      toast('بانتظار إكمال الملف — أكمله لتتم المراجعة');
      if (pages.profile) return location.href = pages.profile;
      return d;
    }
    if (status === 'PENDING_APPROVAL') {
      toast('ملفك بانتظار اعتماد Odoo');
      if (pages.waiting) return location.href = pages.waiting;
      return d;
    }
    if (status === 'NEED_CHANGES') {
      toast('مطلوب تعديل على ملفك — راجع الوثائق المرفوضة');
      if (pages.waiting) return location.href = pages.waiting;
      return d;
    }
    if (status === 'INACTIVE') {
      setToken(LS.tmp, d.result && d.result.token ? d.result.token : (d.token ? (d.token.token || d.token.accessToken) : ''));
      toast('تحقق من بريدك الإلكتروني — أدخل رمز OTP');
      if (pages.otp) return location.href = pages.otp;
      return d;
    }
    toast((d.message) || 'حالة غير متوقعة: ' + status, 'err');
    return d;
  }

  async function verifyOtp(code, pages) {
    var tmp = getToken(LS.tmp);
    try {
      var json = await request('POST', 'auth/otp/verify', {
        otpCode: String(code), deviceId: DEVICE, deviceType: cfg.DEVICE_TYPE || 'ANDROID'
      }, { bearer: tmp || undefined, noRetry: true });
      var raw = json.data || json;
      var d = raw.details || raw;
      saveSession(
        d.token && d.token.accessToken, d.token && d.token.refreshToken,
        raw.role || getToken(LS.role), d.status
      );
      toast('تم التحقق بنجاح ' + (d.status === 'ACTIVE_ACCOUNT' ? '— الحساب نشط' : '— أكمل ملفك'));
      if (pages.home && (d.status === 'ACTIVE_ACCOUNT' || d.status === 'ACTIVE')) return location.href = pages.home;
      if (pages.profile) return location.href = pages.profile;
      return d;
    } catch (e) {
      toast('OTP غير صحيح: ' + e.message, 'err');
      return null;
    }
  }

  async function resendOtp() {
    try {
      var tmp = getToken(LS.tmp);
      var json = await request('PUT', 'auth/otp/resend', { deviceId: DEVICE },
        { bearer: tmp || undefined, noRetry: true });
      toast((json && json.message) || 'أُعيد إرسال الرمز');
    } catch (e) { toast('تعذر الإرسال: ' + e.message, 'err'); }
  }

  async function logout(page) {
    try { await request('POST', 'auth/logout', { deviceId: DEVICE }, { noRetry: true }); }
    catch (e) { /* قد يكون التوكن منتهيًا — نُفرّغ المحلي دائمًا */ }
    clearSession();
    if (page) location.href = page;
  }

  /* ---------- guards ---------- */
  function requireAuth(page) {
    var t = getToken(LS.token);
    if (!t) { location.href = page || 'login.html'; return false; }
    return true;
  }
  function setAvatarFallback(name) {
    document.querySelectorAll('.avatar, [data-avatar]').forEach(function (el) {
      var letter = (name || '؟').trim().charAt(0);
      el.textContent = letter;
    });
  }
  function greeting(name) {
    document.querySelectorAll('[data-name]').forEach(function (el) { el.textContent = name; });
  }
  function badge(statusCode) {
    if (window.ui) return ui.statusOf(statusCode);
    return '<span class="badge gray">' + (statusCode || '—') + '</span>';
  }

  /* ---------- public ---------- */
  window.API = {
    base: BASE,
    app: APP,
    device: function () { return DEVICE; },
    token: function () { return getToken(LS.token); },
    refreshToken: function () { return getToken(LS.refresh); },
    tmpToken: function () { return getToken(LS.tmp); },
    role: function () { return getToken(LS.role); },
    status: function () { return getToken(LS.status); },
    user: function () { try { return JSON.parse(getToken(LS.user) || '{}'); } catch (e) { return {}; } },

    get: function (p, o) { return request('GET', p, null, o); },
    post: function (p, b, o) { return request('POST', p, b, o); },
    put: function (p, b, o) { return request('PUT', p, b, o); },
    patch: function (p, b, o) { return request('PATCH', p, b, o); },
    del: function (p, b, o) { return request('DELETE', p, b, o); },

    upload: function (p, file, fields, o) {
      var fd = new FormData();
      if (file) fd.append('file', file);
      if (fields) Object.keys(fields).forEach(function (k) {
        if (fields[k] !== undefined && fields[k] !== null) fd.append(k, fields[k]);
      });
      // تقبل الـ endpoints (upload-doc) حقولها حصرًا كـ form-data مع الملف
      var method = (o && o.method) || 'POST';
      return request(method, p, fd, Object.assign({ multipart: fd, auth: true }, o));
    },

    esc: esc, list: list, one: one,
    toast: toast, badge: badge, setAvatar: setAvatarFallback, greeting: greeting,

    login: login, verifyOtp: verifyOtp, resendOtp: resendOtp, logout: logout,
    requireAuth: requireAuth, saveSession: saveSession, clearSession: clearSession,
    refresh: tryRefresh
  };
})();