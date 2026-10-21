/**
 * CropSathi — Unified Session & SWR Client Cache System
 * Handles:
 *  1. Dual-storage auth persistence (localStorage + cookies).
 *  2. Immediate zero-flicker auth guards.
 *  3. Stale-While-Revalidate (SWR) caching for API data (fields, profile, weather).
 *  4. Global active field state tracking across page navigations.
 */

(function (window) {
  'use strict';

  // --- Cookie Helpers ---
  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + encodeURIComponent(name) + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    if (typeof document === 'undefined') return;
    const maxAge = (days || 7) * 24 * 60 * 60;
    // Lax SameSite allows standard page navigation across tabs and reloads
    document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) +
      '; path=/; max-age=' + maxAge + '; SameSite=Lax';
  }

  function deleteCookie(name) {
    if (typeof document === 'undefined') return;
    document.cookie = encodeURIComponent(name) + '=; path=/; max-age=0; SameSite=Lax';
  }

  // --- Session Manager ---
  const CropSathiSession = {
    COOKIE_KEY: 'cropsathi_token',
    ACTIVE_FARM_KEY: 'cropsathi_active_farm',

    getToken() {
      try {
        let token = localStorage.getItem('token');
        if (!token) {
          token = getCookie(this.COOKIE_KEY);
          if (token) {
            localStorage.setItem('token', token);
          }
        }
        return token || null;
      } catch (e) {
        return getCookie(this.COOKIE_KEY);
      }
    },

    getUser() {
      try {
        const u = localStorage.getItem('user');
        return u ? JSON.parse(u) : null;
      } catch (e) {
        return null;
      }
    },

    setSession(token, user) {
      try {
        if (token) {
          localStorage.setItem('token', token);
          setCookie(this.COOKIE_KEY, token, 7);
        }
        if (user) {
          localStorage.setItem('user', JSON.stringify(user));
          localStorage.setItem('cropsathi_profile_meta', JSON.stringify({
            name: user.name || '',
            phone: user.phoneNumber || user.phone || ''
          }));
          if (user.profilePhoto) {
            localStorage.setItem('cropsathi_profile_photo', user.profilePhoto);
          }
          if (user.farmDetails) {
            const v = user.farmDetails.village;
            const d = user.farmDetails.district;
            const loc = v ? `${v}${d ? ', ' + d : ''}` : (d || '');
            if (loc) localStorage.setItem('cropsathi_location', loc);
          }
        }
      } catch (e) {
        console.warn('CropSathiSession.setSession failed:', e);
      }
    },

    clearSession() {
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('cropsathi_profile_meta');
        localStorage.removeItem('cropsathi_profile_photo');
        localStorage.removeItem('cropsathi_location');
        sessionStorage.clear();
        deleteCookie(this.COOKIE_KEY);
      } catch (e) {
        deleteCookie(this.COOKIE_KEY);
      }
    },

    requireAuth(loginUrl = 'login.html') {
      const token = this.getToken();
      if (!token) {
        const currentPath = window.location.pathname.split('/').pop();
        if (currentPath !== loginUrl) {
          window.location.replace(loginUrl);
        }
        return false;
      }
      return true;
    },

    redirectIfAuth(dashboardUrl = 'dashboard.html') {
      const token = this.getToken();
      if (token) {
        window.location.replace(dashboardUrl);
        return true;
      }
      return false;
    },

    getActiveFarm() {
      try {
        // Priority 1: URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const urlId = urlParams.get('fieldId') || urlParams.get('farmId');
        if (urlId) {
          sessionStorage.setItem(this.ACTIVE_FARM_KEY, urlId);
          return urlId;
        }
        // Priority 2: Session storage
        return sessionStorage.getItem(this.ACTIVE_FARM_KEY) || null;
      } catch (e) {
        return null;
      }
    },

    setActiveFarm(farmId) {
      try {
        if (farmId) {
          sessionStorage.setItem(this.ACTIVE_FARM_KEY, farmId);
        } else {
          sessionStorage.removeItem(this.ACTIVE_FARM_KEY);
        }
      } catch (e) {}
    }
  };

  // --- Stale-While-Revalidate Cache ---
  const CropSathiCache = {
    PREFIX: 'cs_cache_',

    _getKey(key) {
      return this.PREFIX + key;
    },

    get(key) {
      try {
        const raw = sessionStorage.getItem(this._getKey(key));
        if (!raw) return null;
        const entry = JSON.parse(raw);
        const now = Date.now();
        const isStale = (now - entry.ts) > entry.ttl;
        return { data: entry.data, isStale, ts: entry.ts };
      } catch (e) {
        return null;
      }
    },

    set(key, data, ttlMs = 60000) {
      try {
        const entry = {
          data: data,
          ts: Date.now(),
          ttl: ttlMs
        };
        sessionStorage.setItem(this._getKey(key), JSON.stringify(entry));
      } catch (e) {
        // Handle quota errors gracefully by clearing old cache items
        this.clearAll();
      }
    },

    invalidate(keyOrPrefix) {
      try {
        const fullPrefix = this.PREFIX + keyOrPrefix;
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(fullPrefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (e) {}
    },

    clearAll() {
      try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(this.PREFIX)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (e) {}
    },

    /**
     * Stale-While-Revalidate fetch wrapper.
     * If cached:
     *   - fires onCached(cachedData) immediately (0ms latency UI paint).
     *   - if still fresh, skips network fetch entirely.
     *   - if stale, initiates background revalidation and calls onFresh(freshData) if changed.
     * If not cached:
     *   - performs standard fetch, stores in cache, returns result.
     */
    async fetchSWR(url, fetchOptions = {}, { ttl = 90000, onCached = null, onFresh = null } = {}) {
      const cacheKey = typeof url === 'string' ? url : url.toString();
      const cached = this.get(cacheKey);

      if (cached) {
        if (typeof onCached === 'function') {
          onCached(cached.data);
        }
        if (!cached.isStale) {
          return cached.data;
        }
      }

      // Revalidate in background or immediately
      try {
        const token = CropSathiSession.getToken();
        const headers = Object.assign({}, fetchOptions.headers || {});
        if (token && !headers['Authorization'] && !headers['authorization']) {
          headers['Authorization'] = 'Bearer ' + token;
        }

        const res = await fetch(url, Object.assign({}, fetchOptions, { headers }));
        if (!res.ok) {
          if (res.status === 401) {
            CropSathiSession.clearSession();
            CropSathiSession.requireAuth();
          }
          if (cached) return cached.data; // graceful fallback to cached data if network error
          throw new Error(`HTTP error ${res.status}`);
        }

        const data = await res.json();
        this.set(cacheKey, data, ttl);

        if (typeof onFresh === 'function') {
          onFresh(data);
        } else if (typeof onCached === 'function' && cached && cached.isStale) {
          // If cached data was shown earlier and new data arrived, notify UI
          onCached(data);
        }

        return data;
      } catch (err) {
        if (cached) {
          console.warn('Network failed, serving cached copy for:', cacheKey);
          return cached.data;
        }
        throw err;
      }
    }
  };

  // Expose to window
  window.CropSathiSession = CropSathiSession;
  window.CropSathiCache = CropSathiCache;

})(typeof window !== 'undefined' ? window : this);
