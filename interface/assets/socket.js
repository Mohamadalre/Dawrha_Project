/* ============================================================
   دورها — Socket.IO client helper
   يوفر اتصالات namespace مع JWT auth تلقائي
   ============================================================ */
(function () {
  var cfg = window.DAW_CONFIG || {};
  var SERVER = (cfg.BASE_URL || 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

  function getToken() {
    try { return localStorage.getItem('daw_token'); } catch (e) { return null; }
  }

  /**
   * اتصال socket.io بـ namespace معين
   * @param {string} namespace — مثال: '/tracking' أو '/collection'
   * @returns {Promise<{socket, on, off, emit, disconnect}>}
   */
  function connect(namespace) {
    return new Promise(function (resolve, reject) {
      var token = getToken();
      if (!token) { reject(new Error('No auth token')); return; }

      var url = SERVER + namespace;
      var socket = io(url, {
        auth: { token: token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 20
      });

      var connected = false;

      socket.on('connect', function () {
        connected = true;
        resolve({
          socket: socket,
          on: function (event, fn) { socket.on(event, fn); },
          off: function (event, fn) { if (fn) socket.off(event, fn); else socket.off(event); },
          emit: function (event, data, cb) { socket.emit(event, data, cb); },
          disconnect: function () { socket.disconnect(); },
          get id() { return socket.id; },
          get connected() { return socket.connected; }
        });
      });

      socket.on('connect_error', function (err) {
        if (!connected) reject(err);
      });

      socket.on('error', function (data) {
        console.warn('[socket] error:', data);
      });

      setTimeout(function () {
        if (!connected) { socket.disconnect(); reject(new Error('Socket connection timeout')); }
      }, 8000);
    });
  }

  window.Socket = { connect: connect, SERVER: SERVER };
})();
