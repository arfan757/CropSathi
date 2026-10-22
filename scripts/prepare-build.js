const fs = require('fs');
const path = require('path');

const apiUrl = process.env.CROPSATHI_API_URL || process.env.VITE_API_URL || process.env.NEXT_PUBLIC_API_URL;

if (apiUrl) {
  const cleanUrl = apiUrl.trim().replace(/\/+$/, '');
  console.log(`[Vercel Build] Detected backend API URL: ${cleanUrl}`);

  // 1. Update frontend/config.js
  const configPath = path.join(__dirname, '..', 'frontend', 'config.js');
  if (fs.existsSync(configPath)) {
    const configContent = `// API Configuration (Injected during Vercel build)
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

window.CROPSATHI_API_URL = window.CROPSATHI_API_URL ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('cropsathi_api_url') : null) ||
  (isLocal ? 'http://localhost:5000' : '${cleanUrl}');

// Landing page URL (served from the same deployment)
window.LANDING_PAGE_URL = window.LANDING_PAGE_URL || '/landing/';
`;
    fs.writeFileSync(configPath, configContent, 'utf8');
    console.log('[Vercel Build] Successfully injected backend URL into frontend/config.js');
  }

  // 2. Update vercel.json rewrites
  const vercelPath = path.join(__dirname, '..', 'vercel.json');
  if (fs.existsSync(vercelPath)) {
    try {
      const vercelJson = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
      if (Array.isArray(vercelJson.rewrites)) {
        vercelJson.rewrites = vercelJson.rewrites.map(rw => {
          if (rw.source === '/api/:path*') {
            return { source: '/api/:path*', destination: `${cleanUrl}/api/:path*` };
          }
          return rw;
        });
        fs.writeFileSync(vercelPath, JSON.stringify(vercelJson, null, 2) + '\n', 'utf8');
        console.log('[Vercel Build] Successfully updated /api rewrite destination in vercel.json');
      }
    } catch (e) {
      console.warn('[Vercel Build] Note: could not update vercel.json:', e.message);
    }
  }
} else {
  console.log('[Vercel Build] No CROPSATHI_API_URL environment variable provided. Using default configuration.');
}
