/**
 * CropSathi — Unified Navigation, Profile Hydration & Instant Transition Engine
 * 1. Immediate synchronous profile & location hydration from cache to prevent page flicker/FOUC.
 * 2. Background SWR refresh for profile metadata.
 * 3. Unified Bolt-style Profile Dropdown toggle & outside-click/Escape management.
 * 4. Speculative link prefetching on hover/touchstart for instantaneous MPA page transitions.
 */

(function () {
  'use strict';

  // --- 1. Profile Photo Application ---
  function applyProfilePhoto(photoData) {
    const container = document.getElementById('navProfilePhoto');
    const initial = document.getElementById('navAvatarInitial');
    if (!container) return;

    const existingImg = container.querySelector('img');
    if (existingImg) existingImg.remove();

    if (photoData) {
      if (initial) initial.style.display = 'none';
      const img = document.createElement('img');
      img.src = photoData;
      img.alt = 'Profile';
      img.className = 'w-full h-full object-cover';
      container.appendChild(img);
    } else {
      if (initial) initial.style.display = '';
    }
  }
  window.applyProfilePhoto = applyProfilePhoto;

  // --- 2. Synchronous Instant Hydration from Cache ---
  function getInitials(name) {
    if (!name || typeof name !== 'string') return 'F';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'F';
    return parts[0].charAt(0).toUpperCase();
  }

  function syncNavProfileFromCache() {
    let user = null;
    let meta = null;
    try {
      if (typeof window.CropSathiSession !== 'undefined' && window.CropSathiSession.getUser) {
        user = window.CropSathiSession.getUser();
      }
      if (!user) {
        const rawUser = localStorage.getItem('user');
        if (rawUser) user = JSON.parse(rawUser);
      }
      const rawMeta = localStorage.getItem('cropsathi_profile_meta');
      if (rawMeta) meta = JSON.parse(rawMeta);
    } catch (e) {}

    if (user && user.preferredLanguage && !localStorage.getItem('cropsathi_prefs') &&
        typeof window.CropSathiPrefs !== 'undefined') {
      window.CropSathiPrefs.applyLanguage(user.preferredLanguage);
    }

    const name = (meta && meta.name) || (user && user.name) || '';
    const phone = (meta && meta.phone) || (user && (user.phoneNumber || user.phone)) || '';
    const initials = name ? getInitials(name) : 'F';

    let location = localStorage.getItem('cropsathi_location') || '';
    if (!location && user && user.farmDetails) {
      const v = user.farmDetails.village;
      const d = user.farmDetails.district;
      location = v ? `${v}${d ? ', ' + d : ''}` : (d || '');
    }

    // Hydrate Topbar Elements
    const nameElem = document.getElementById('userName');
    if (nameElem && name) nameElem.textContent = name;

    const topNameElem = document.getElementById('userMenuNameTop');
    if (topNameElem && name) topNameElem.textContent = name;

    const navAvatar = document.getElementById('navAvatarInitial');
    if (navAvatar) navAvatar.textContent = initials;

    const userLocElem = document.getElementById('userLocation');
    if (userLocElem) userLocElem.textContent = location || 'Location not set';

    const locDisp = document.getElementById('locationDisplay');
    if (locDisp) {
      locDisp.innerHTML = `<i data-lucide="map-pin" class="w-3.5 h-3.5 text-terracotta-400"></i> <span>${location || 'Location not set'}</span>`;
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try { window.lucide.createIcons(); } catch (e) {}
      }
    }

    // Hydrate Dropdown Panel Elements
    const cachedPhoto = localStorage.getItem('cropsathi_profile_photo');
    const menuPhoto = document.getElementById('userMenuPhoto');
    if (menuPhoto) {
      menuPhoto.textContent = initials;
      if (cachedPhoto) {
        menuPhoto.innerHTML = `<img src="${cachedPhoto}" class="w-full h-full object-cover rounded-xl" alt="Profile">`;
      }
    }

    const menuName = document.getElementById('userMenuName');
    if (menuName && name) menuName.textContent = name;

    const menuPhone = document.getElementById('userMenuPhone');
    if (menuPhone) menuPhone.textContent = phone || 'Verified Account';

    const menuSub = document.getElementById('userMenuSub');
    if (menuSub) menuSub.textContent = phone ? phone : 'Signed in';

    // Apply cached photo (or clear a stale image when the photo was removed)
    applyProfilePhoto(cachedPhoto || null);
  }
  window.syncNavProfileFromCache = syncNavProfileFromCache;

  // Run immediately as script is loaded to defeat FOUC
  syncNavProfileFromCache();

  // --- 3. SWR Background Server Revalidation ---
  async function syncNavProfileFromServer() {
    const token = (typeof window.CropSathiSession !== 'undefined') ? window.CropSathiSession.getToken() : localStorage.getItem('token');
    if (!token) return;

    const apiBase = (typeof CropSathiPrefs !== 'undefined' && CropSathiPrefs.api) ? CropSathiPrefs.api : '';
    if (!apiBase) return;

    function applyFreshUser(u) {
      if (!u) return;
      try {
        localStorage.setItem('cropsathi_profile_meta', JSON.stringify({
          name: u.name || '',
          phone: u.phoneNumber || u.phone || ''
        }));
        if (u.profilePhoto) {
          localStorage.setItem('cropsathi_profile_photo', u.profilePhoto);
        } else {
          localStorage.removeItem('cropsathi_profile_photo');
        }
        if (u.farmDetails) {
          const v = u.farmDetails.village;
          const d = u.farmDetails.district;
          const loc = v ? `${v}${d ? ', ' + d : ''}` : (d || '');
          if (loc) localStorage.setItem('cropsathi_location', loc);
        }
        const existing = localStorage.getItem('user');
        const parsed = existing ? JSON.parse(existing) : {};
        localStorage.setItem('user', JSON.stringify(Object.assign({}, parsed, u)));
      } catch (e) {}

      syncNavProfileFromCache();
    }

    if (typeof window.CropSathiCache !== 'undefined') {
      window.CropSathiCache.fetchSWR(
        `${apiBase}/api/user/profile`,
        { headers: { Authorization: `Bearer ${token}` } },
        {
          ttl: 300000, // 5 min cache
          onCached: (res) => { if (res && res.success && res.user) applyFreshUser(res.user); },
          onFresh: (res) => { if (res && res.success && res.user) applyFreshUser(res.user); }
        }
      ).catch(() => {});
    } else {
      try {
        const res = await fetch(`${apiBase}/api/user/profile`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data && data.success && data.user) {
          applyFreshUser(data.user);
        }
      } catch (e) {}
    }
  }
  window.syncNavProfileFromServer = syncNavProfileFromServer;

  // --- 4. Unified Profile Dropdown Toggling & Keyboard/Outside Click Controls ---
  function toggleProfileDropdown(e) {
    if (e) {
      e.stopPropagation();
    }
    const panel = document.getElementById('topProfileMenuPanel');
    const chevron = document.getElementById('topProfileChevron');
    if (!panel) return;

    // Close field dropdown if open (on dashboard)
    if (typeof window.closeFieldDropdown === 'function') {
      window.closeFieldDropdown();
    } else {
      const fieldMenu = document.getElementById('topFieldDropdownMenu');
      const fieldChevron = document.getElementById('topFieldChevron');
      if (fieldMenu) fieldMenu.classList.add('hidden');
      if (fieldChevron) fieldChevron.classList.remove('rotate-180');
    }

    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
      panel.classList.remove('hidden');
      if (chevron) chevron.classList.add('rotate-180');
    } else {
      panel.classList.add('hidden');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  }
  window.toggleProfileDropdown = toggleProfileDropdown;

  function closeProfileDropdown() {
    const panel = document.getElementById('topProfileMenuPanel');
    const chevron = document.getElementById('topProfileChevron');
    if (panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      if (chevron) chevron.classList.remove('rotate-180');
    }
  }
  window.closeProfileDropdown = closeProfileDropdown;

  function handleLogout() {
    if (typeof window.CropSathiSession !== 'undefined' && window.CropSathiSession.clearSession) {
      window.CropSathiSession.clearSession();
    } else {
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('cropsathi_profile_meta');
        localStorage.removeItem('cropsathi_profile_photo');
        localStorage.removeItem('cropsathi_location');
        sessionStorage.clear();
      } catch (e) {}
    }
    window.location.href = 'login.html';
  }
  window.handleLogout = handleLogout;

  // Close dropdown on outside click
  document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('topProfileWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      closeProfileDropdown();
    }
  });

  // Close dropdown on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeProfileDropdown();
    }
  });

  // --- 5. Speculative Link Prefetching for Instant Page Navigations ---
  const prefetchedUrls = new Set();
  function prefetchLink(url) {
    if (!url || prefetchedUrls.has(url)) return;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== window.location.origin) return;
      if (!parsed.pathname.endsWith('.html') && !parsed.pathname.endsWith('/')) return;
      prefetchedUrls.add(url);
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.appendChild(link);
    } catch (e) {}
  }

  function setupLinkPrefetching() {
    document.addEventListener('mouseover', function (e) {
      const a = e.target.closest('a');
      if (a && a.href) prefetchLink(a.href);
    }, { passive: true });

    document.addEventListener('touchstart', function (e) {
      const a = e.target.closest('a');
      if (a && a.href) prefetchLink(a.href);
    }, { passive: true });
  }

  // --- 6. DOM Ready Bootstrap ---
  document.addEventListener('DOMContentLoaded', function () {
    syncNavProfileFromCache();
    syncNavProfileFromServer();
    setupLinkPrefetching();
  });

})();