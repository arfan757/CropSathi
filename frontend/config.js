// API Configuration
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
window.CROPSATHI_API_URL = isLocal
  ? 'http://localhost:5000'
  : 'https://cropsathi-x5fe.onrender.com';
