// API Configuration
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Priority:
// 1. window.CROPSATHI_API_URL (if injected by host)
// 2. localStorage 'cropsathi_api_url' (runtime override for testing backends without rebuild)
// 3. Localhost fallback
// 4. Production backend URL
window.CROPSATHI_API_URL = window.CROPSATHI_API_URL ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('cropsathi_api_url') : null) ||
  (isLocal ? 'http://localhost:5000' : 'https://cropsathi-x8se.onrender.com');

// Landing page URL (served from the same deployment)
window.LANDING_PAGE_URL = window.LANDING_PAGE_URL || '/';
