// API Configuration
// Works both locally (http://localhost:5000/api) and on Vercel (uses Render backend)
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.CROPSATHI_API_URL = isLocal
  ? 'http://localhost:5000/api'
  : 'https://cropsathi-x5fe.onrender.com/api';
