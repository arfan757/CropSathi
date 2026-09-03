/* ============================================================
   CropSathi — Shared UI behaviors (user menu / mobile search)
   Vanilla JS, no dependencies. Load ui.js last in <body> after
   preferences.js (uses CropSathiPrefs when present).
   ============================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var doc = document;
  var rootEl = doc.documentElement;
  var MENU = '.user-menu';

  /* ---------------- small storage helpers ---------------- */
  function readLS(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeLS(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function readJSON(key) { try { return JSON.parse(readLS(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(key, val) { try { writeLS(key, JSON.stringify(val)); } catch (e) {} }

  function hasPrefs() { return typeof CropSathiPrefs !== 'undefined'; }

  function apiBase() {
    return (hasPrefs() && CropSathiPrefs.api) || window.CROPSATHI_API_URL || '';
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) { /* ignore */ }
    }
  }

  /* ============================================================
     1. Profile photo — reuse nav-profile.js when loaded, else
        apply inline so every page behaves identically.
     ============================================================ */
  function applyAvatarPhoto(photoData) {
    if (typeof window.applyProfilePhoto === 'function') {
      window.applyProfilePhoto(photoData);
      return;
    }
    var container = doc.getElementById('navProfilePhoto');
    if (!container) return;
    container.querySelectorAll('img').forEach(function (img) { img.remove(); });
    var initial = doc.getElementById('navAvatarInitial');
    if (photoData) {
      if (initial) initial.style.display = 'none';
      var img = doc.createElement('img');
      img.src = photoData;
      img.alt = '';
      img.className = 'w-full h-full object-cover';
      container.appendChild(img);
    } else if (initial) {
      initial.style.display = '';
    }
  }

  /* ============================================================
     2. User menu (avatar trigger + dropdown)
     ============================================================ */
  var menu = doc.querySelector(MENU);
  var trigger = menu ? menu.querySelector('.user-menu-trigger') : null;
  var panel = menu ? menu.querySelector('.user-menu-panel') : null;
  var menuOpen = false;

  function menuItems() {
    if (!panel) return [];
    return Array.prototype.slice.call(panel.querySelectorAll('[role="menuitem"]'))
      .filter(function (el) { return el.offsetParent !== null || el.getAttribute('tabindex') === '0'; });
  }

  function positionPanel() {
    if (!trigger || !panel) return;
    var r = trigger.getBoundingClientRect();
    var pw = panel.offsetWidth || 240;
    var ph = panel.offsetHeight || 240;
    var top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) {
      top = Math.max(8, r.top - ph - 8);
    }
    var left = r.right - pw;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function setMenuOpen(open, focusFirst) {
    if (!trigger || !panel) return;
    menuOpen = open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) positionPanel();
    panel.setAttribute('data-open', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && focusFirst) {
      var items = menuItems();
      if (items.length) items[0].focus();
    }
  }

  /* ---- menu items: fill from cache, then refresh from profile API ---- */
  function initialOf(name) {
    var n = (name || '').trim();
    return n ? n.charAt(0).toUpperCase() : 'F';
  }

  function paintMenuHead(name, phone) {
    var nameEl = doc.getElementById('userMenuName');
    var subEl = doc.getElementById('userMenuSub');
    var photoEl = doc.getElementById('userMenuPhoto');
    if (nameEl) nameEl.textContent = name || 'Farmer';
    if (subEl) subEl.textContent = phone || (name ? 'Signed in' : '');
    if (photoEl) {
      photoEl.innerHTML = '';
      var cached = readLS('cropsathi_profile_photo');
      if (cached) {
        var img = doc.createElement('img');
        img.src = cached;
        img.alt = '';
        photoEl.appendChild(img);
      } else {
        photoEl.textContent = initialOf(name);
      }
    }
    var navInit = doc.getElementById('navAvatarInitial');
    if (navInit && !navInit.textContent.trim()) navInit.textContent = initialOf(name);
  }

  function loadProfile() {
    var meta = readJSON('cropsathi_profile_meta');
    var cachedPhoto = readLS('cropsathi_profile_photo');
    if (cachedPhoto) applyAvatarPhoto(cachedPhoto);
    paintMenuHead(meta && meta.name, meta && meta.phone);

    var token = readLS('token');
    if (!token || !apiBase()) return;
    fetch(apiBase() + '/api/user/profile', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.success || !data.user) return;
        var u = data.user;
        writeJSON('cropsathi_profile_meta', { name: u.name || '', phone: u.phone || '' });
        if (u.profilePhoto) writeLS('cropsathi_profile_photo', u.profilePhoto);
        applyAvatarPhoto(u.profilePhoto || readLS('cropsathi_profile_photo'));
        paintMenuHead(u.name, u.phone);
        var navInit = doc.getElementById('navAvatarInitial');
        if (navInit && u.name) navInit.textContent = u.name.trim().charAt(0).toUpperCase();
      })
      .catch(function () { /* keep cached values */ });
  }

  /* ---- theme quick toggle (cycles light -> system -> dark) ---- */
  var THEME_ORDER = ['light', 'system', 'dark'];
  function currentTheme() {
    if (hasPrefs() && CropSathiPrefs.getPrefs) {
      var p = CropSathiPrefs.getPrefs();
      return (p && p.theme) || 'light';
    }
    return rootEl.classList.contains('dark') ? 'dark' : 'light';
  }
  function paintThemeRow() {
    var btn = menu ? menu.querySelector('[data-menu-theme]') : null;
    if (!btn) return;
    var cur = currentTheme();
    var labelEl = btn.querySelector('[data-theme-label]');
    var iconEl = btn.querySelector('[data-theme-icon]');
    if (labelEl) labelEl.textContent = { light: 'Light mode', system: 'System theme', dark: 'Dark mode' }[cur] || 'Theme';
    if (iconEl) {
      iconEl.setAttribute('data-lucide', { light: 'sun', system: 'monitor', dark: 'moon' }[cur] || 'moon');
      iconEl.innerHTML = '';
      refreshIcons();
    }
  }

  function bindMenu() {
    if (!menu || !trigger || !panel) return;
    // Menuitems are reached via arrow-key navigation; the avatar button is the single tab stop
    Array.prototype.forEach.call(panel.querySelectorAll('[role="menuitem"]'), function (el) {
      el.setAttribute('tabindex', '-1');
    });
    // Pages without preferences.js have no persisted theme engine — drop the toggle row
    if (!hasPrefs()) {
      var themeRow = menu.querySelector('[data-menu-theme]');
      if (themeRow) themeRow.remove();
    }
    loadProfile();
    paintThemeRow();

    trigger.addEventListener('click', function () {
      setMenuOpen(!menuOpen);
    });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && !menuOpen) { e.preventDefault(); setMenuOpen(true, true); }
      else if (e.key === 'ArrowUp' && !menuOpen) {
        e.preventDefault(); setMenuOpen(true);
        var items = menuItems();
        if (items.length) items[items.length - 1].focus();
      }
    });

    panel.addEventListener('keydown', function (e) {
      var items = menuItems();
      if (!items.length) return;
      var idx = items.indexOf(doc.activeElement);
      function focusAt(i) {
        e.preventDefault();
        items[((i % items.length) + items.length) % items.length].focus();
      }
      if (e.key === 'ArrowDown') focusAt(idx + 1);
      else if (e.key === 'ArrowUp') focusAt(idx - 1);
      else if (e.key === 'Home') focusAt(0);
      else if (e.key === 'End') focusAt(items.length - 1);
      else if (e.key === 'Escape') { setMenuOpen(false); trigger.focus(); }
    });

    // close when focus leaves the menu (Tab past the last item etc.)
    menu.addEventListener('focusout', function (e) {
      if (!menuOpen) return;
      if (!menu.contains(e.relatedTarget)) setMenuOpen(false);
    });

    var themeBtn = menu.querySelector('[data-menu-theme]');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        if (hasPrefs()) {
          var cur = currentTheme();
          var next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
          try { CropSathiPrefs.setPrefs({ theme: next }); CropSathiPrefs.applyTheme(); } catch (e) {}
        } else {
          rootEl.classList.toggle('dark');
        }
        paintThemeRow();
      });
    }

    var logoutBtn = menu.querySelector('[data-menu-logout]');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch (e) {}
        window.location.href = 'login.html';
      });
    }

    // global: outside click / Escape / resize close
    doc.addEventListener('pointerdown', function (e) {
      if (menuOpen && !menu.contains(e.target)) setMenuOpen(false);
    }, true);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuOpen) { setMenuOpen(false); trigger.focus(); }
    });
    window.addEventListener('resize', function () {
      if (menuOpen) positionPanel();
    });
    window.addEventListener('scroll', function () {
      if (menuOpen) setMenuOpen(false);
    }, true);
  }

  /* ============================================================
     3. Mobile search row — toggled by the search icon button.
        Pages can point the row at an existing filter input via
        data-sync="#someId" on the row's <input>.
     ============================================================ */
  function initSearchRow() {
    var triggers = Array.prototype.slice.call(doc.querySelectorAll('.cs-search-trigger'));
    var row = doc.querySelector('.cs-searchrow');
    if (!row || !triggers.length) return;

    var input = row.querySelector('input');
    var closeBtn = row.querySelector('[data-search-close]');

    function isOpen() { return row.classList.contains('is-open'); }

    function syncToPage() {
      if (!input) return;
      var target = input.getAttribute('data-sync');
      if (!target) return;
      var el = doc.querySelector(target);
      if (!el) return;
      el.value = input.value;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }

    function setOpen(open) {
      row.classList.toggle('is-open', open);
      triggers.forEach(function (t) {
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
        t.classList.toggle('is-active', open);
      });
      if (open && input) {
        // small delay so the row is visible before focus
        setTimeout(function () { input.focus(); }, 0);
      } else if (!open && input) {
        input.blur();
      }
    }

    triggers.forEach(function (t) {
      t.addEventListener('click', function () { setOpen(!isOpen()); });
    });
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (input) { input.value = ''; syncToPage(); }
        setOpen(false);
      });
    }
    if (input) input.addEventListener('input', syncToPage);

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        if (input) { input.value = ''; syncToPage(); }
        setOpen(false);
        var first = triggers[0];
        if (first) first.focus();
      }
    });

    doc.addEventListener('pointerdown', function (e) {
      if (!isOpen()) return;
      var inRow = row.contains(e.target);
      var inTrigger = triggers.some(function (t) { return t.contains(e.target); });
      if (!inRow && !inTrigger) setOpen(false);
    }, true);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    bindMenu();
    initSearchRow();
    refreshIcons();
  }
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
