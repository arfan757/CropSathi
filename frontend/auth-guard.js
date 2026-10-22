/**
 * CropSathi client-side navigation guard.
 * Runs synchronously in <head>; data APIs remain protected by the backend JWT.
 */
(function (window) {
  'use strict';

  function decodePayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) base64 += '=';

      return JSON.parse(window.atob(base64));
    } catch (e) {
      return null;
    }
  }

  function isTokenValid(token) {
    if (!token) return false;

    const payload = decodePayload(token);
    if (!payload || typeof payload.exp !== 'number') return false;

    return payload.exp * 1000 > Date.now();
  }

  function clearSession() {
    if (window.CropSathiSession && typeof window.CropSathiSession.clearSession === 'function') {
      window.CropSathiSession.clearSession();
      return;
    }

    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('user');
      window.localStorage.removeItem('cropsathi_profile_meta');
      window.localStorage.removeItem('cropsathi_profile_photo');
      window.localStorage.removeItem('cropsathi_location');
      window.sessionStorage.clear();
      document.cookie = 'cropsathi_token=; path=/; max-age=0; SameSite=Lax';
    } catch (e) {}
  }

  function redirectToLanding() {
    clearSession();
    window.location.replace(window.LANDING_PAGE_URL || '/');
  }

  const session = window.CropSathiSession;
  const token = session && typeof session.getToken === 'function'
    ? session.getToken()
    : null;

  if (!isTokenValid(token)) {
    redirectToLanding();
    return;
  }

  window.CropSathiAuthGuard = {
    decodePayload: decodePayload,
    isTokenValid: isTokenValid,
    redirectToLanding: redirectToLanding
  };
})(window);
