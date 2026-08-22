/* Shared helpers for the interface prototypes.
   Pure mockup: every action shows a toast with the real backend endpoint it maps to. */
(function () {
  const toastBox = document.getElementById('toasts') || (() => {
    const el = document.createElement('div');
    el.id = 'toasts';
    document.body.appendChild(el);
    return el;
  })();

  window.ui = {
    base: 'http://localhost:3000/api/v1',

    toast(message, endpoint, type) {
      const t = document.createElement('div');
      t.className = 'toast ' + (type || '');
      t.innerHTML = message;
      if (endpoint) {
        const ep = document.createElement('span');
        ep.className = 'ep';
        ep.textContent = endpoint;
        t.appendChild(ep);
      }
      toastBox.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    },

    ok(m, ep) { this.toast(m, ep, 'ok'); },
    err(m, ep) { this.toast(m, ep, 'err'); },

    /* Ties a form to its real endpoint: intercepts submit, toasts, resets. */
    wireForm(form, endpoint, opts) {
      opts = opts || {};
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type="submit"]');
        if (btn) { btn.disabled = true; }
        setTimeout(() => {
          this.ok(opts.message || 'تم إرسال الطلب بنجاح (محاكاة)', endpoint);
          if (btn) { btn.disabled = false; }
          if (opts.next) { setTimeout(() => { location.href = opts.next; }, 900); }
        }, 350);
      });
    },

    /* One-shot button → toast. */
    wireClick(el, message, endpoint) {
      if (!el) return;
      el.addEventListener('click', () => this.ok(message || 'تمت العملية (محاكاة)', endpoint));
    },

    /* State badge helpers */
    statusOf(code) {
      const map = {
        PENDING_APPROVAL: ['بانتظار الموافقة', 'amber'],
        PENDING_PROFILE: ['بانتظار إكمال الملف', 'amber'],
        ACTIVE: ['نشط', 'green'],
        ACTIVE_ACCOUNT: ['نشط', 'green'],
        INACTIVE: ['غير مفعّل', 'gray'],
        BLOCKED: ['محظور', 'red'],
        NEED_CHANGES: ['مطلوب تعديل', 'purple'],
        REJECTED: ['مرفوض', 'red'],
        QUEUED: ['بالانتظار', 'gray'],
        ASSIGNED: ['مُسند', 'blue'],
        EN_ROUTE: ['في الطريق', 'blue'],
        ARRIVED: ['وصل السائق', 'purple'],
        PICKING: ['جارٍ الوزن', 'amber'],
        DELIVERED: ['تم التسليم', 'green'],
        COMPLETED: ['مكتمل', 'green'],
        CANCELLED: ['ملغي', 'red'],
        OFFERED: ['عرض قائم', 'amber'],
        PLANNED: ['مجدولة', 'blue'],
        IN_PROGRESS: ['قيد التنفيذ', 'blue'],
      };
      const m = map[code] || [code || '—', 'gray'];
      return '<span class="badge ' + m[1] + '">' + m[0] + '</span>';
    }
  };

  /* Simulated location picker: fills the lat/lng inputs. */
  document.addEventListener('click', (e) => {
    const picker = e.target.closest('[data-pick-location]');
    if (!picker) return;
    const lat = document.getElementById(picker.getAttribute('data-lat'));
    const lng = document.getElementById(picker.getAttribute('data-lng'));
    const la = (33.5 + Math.random() * 0.4).toFixed(6);
    const ln = (36.28 + Math.random() * 0.4).toFixed(6);
    if (lat) lat.value = la;
    if (lng) lng.value = ln;
    ui.ok('تم تحديد الموقع على الخريطة (محاكاة): ' + la + ', ' + ln);
  });

  /* Simulated file pickers. */
  document.addEventListener('click', (e) => {
    const box = e.target.closest('[data-file-box]');
    if (!box) return;
    box.classList.add('uploaded');
    const label = box.querySelector('.file-label');
    if (label) label.textContent = '✓ تم رفع الملف: ' + (box.getAttribute('data-file-name') || 'document.png');
  });

  window.__fillSelects = function (select, options) {
    if (!select) return;
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      select.appendChild(opt);
    });
  };
})();
