# CropSathi Deployment Guide

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Frontend (Vercel) │────▶│  Backend (Render)    │
│   Static HTML/JS    │     │  Node.js + Express   │
│   Port: 80/443      │     │  Port: 5000          │
└─────────────────────┘     └─────────────────────┘
                                    │
                                    ▼
                            ┌─────────────────────┐
                            │   MongoDB Atlas      │
                            │   (Cloud Database)   │
                            └─────────────────────┘
```

---

## Backend Deployment (Render)

### 1. Push to GitHub
```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 2. Deploy to Render
1. Go to [render.com](https://render.com) and sign up / log in
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `cropsathi-backend`
   - **Region**: Oregon (or closest to your users)
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for production)
5. Add Environment Variables (see table below)
6. Click **Create Web Service**

### 3. Environment Variables

Set these in Render Dashboard → **Environment** tab:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Enables production mode |
| `PORT` | `5000` | Render also sets this automatically |
| `MONGODB_URI` | `mongodb+srv://...` | From MongoDB Atlas |
| `JWT_SECRET` | `your_secret_key` | Random string, 32+ chars |
| `GEMINI_API_KEY` | `AIza...` | From Google AI Studio |
| `CORS_ORIGIN` | `https://your-app.vercel.app` | Your Vercel frontend URL |

### 4. Get Backend URL
After deployment, Render provides a URL like:
`https://cropsathi-backend.onrender.com`

Use this as your `CROPSATHI_API_URL` in Vercel.

### 5. Free Tier Notes
- Render free tier **spins down after 15 min of inactivity** — first request after idle takes ~30s to wake up
- Uploads directory is **ephemeral** (files lost on restart) — same as Railway free tier
- For persistent file storage, use Cloudflare R2 or AWS S3
- Upgrade to Starter ($7/mo) for no spin-down

---

## Frontend Deployment (Vercel)

### 1. Deploy to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Configure:
   - **Framework Preset**: Other
   - **Root Directory**: `./` (leave blank)
   - **Build Command**: (leave empty — static files)
   - **Output Directory**: `frontend`
4. Add Environment Variable:
   - **Name**: `CROPSATHI_API_URL`
   - **Value**: `https://cropsathi-backend.onrender.com/api`
5. Deploy

### 2. Custom Domain (Optional)
1. Vercel dashboard → Settings → Domains
2. Add your domain
3. Update DNS records as instructed

---

## MongoDB Atlas Setup

1. Create cluster at [mongodb.com](https://mongodb.com)
2. Create database user with password
3. **Network Access** → Add IP Address → `0.0.0.0/0` (Allow all — needed for Render)
4. Get connection string: **Connect** → **Connect your application** → Copy URI
5. Replace `<password>` with your database user password
6. Add to Render environment variables as `MONGODB_URI`

---

## Gemini API Key

1. Go to [aistudio.google.com](https://aistudio.google.com/apikey)
2. Create API key
3. Add to Render environment variables as `GEMINI_API_KEY`

---

## Connecting Frontend to Backend

1. Deploy backend to Render → get the URL (e.g., `https://cropsathi-backend.onrender.com`)
2. Deploy frontend to Vercel → set `CROPSATHI_API_URL=https://cropsathi-backend.onrender.com/api`
3. Set backend `CORS_ORIGIN=https://your-frontend.vercel.app`
4. Redeploy both services

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with your values
npm install
npm run dev

# Frontend
# Open frontend/index.html in browser
# Or use Live Server in VS Code
```

---

## Troubleshooting

### CORS Errors
- Ensure `CORS_ORIGIN` in Render matches your Vercel URL exactly
- Include `https://` prefix
- For multiple origins, comma-separate them

### Backend Sleeping (Free Tier)
- First request after idle takes ~30s to wake up
- This is normal for Render free tier
- Upgrade to Starter plan ($7/mo) for always-on

### API Not Reachable
- Check `CROPSATHI_API_URL` in Vercel environment
- Check Render logs: Dashboard → Logs tab
- Ensure backend health check passes: `GET /api/health`

### Database Connection Failed
- Verify MongoDB URI is correct in Render environment
- Check IP whitelist in MongoDB Atlas (must include `0.0.0.0/0`)
- Ensure database user has read/write permissions

### Photos Not Uploading
- Backend uses `uploads/` directory (ephemeral on Render free tier)
- Files lost on service restart
- For persistent storage, integrate S3 or Cloudflare R2

### Gemini Timeout
- Images are resized to max 1024px before sending (via `sharp`)
- Timeout is set to 90s
- If still timing out, check Gemini API status

---

## Alternative: Railway Deployment

If you prefer Railway over Render:

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo → select `backend/` folder
3. Add same environment variables as above
4. Railway provides a URL like `https://your-project.up.railway.app`
5. Use that URL for `CROPSATHI_API_URL` in Vercel

Railway does **not** spin down on free tier (uses usage-based billing instead).
