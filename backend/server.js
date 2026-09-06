import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './src/config/db.js';
import authRoutes from './src/routes/authroutes.js';
import fieldRoutes from './src/routes/fieldRoutes.js';
import monitoringRoutes from './src/routes/monitoringRoutes.js';
import analyticsRoutes from './src/routes/analyticsRoutes.js';
import advisoryRoutes from './src/routes/advisoryRoutes.js';
import dashboardRoutes from './src/routes/dashboardRoutes.js';
import diagnosisRoutes from './src/routes/diagnosisRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import followupRoutes from './src/routes/followupRoutes.js';
import { protect } from './src/middleware/authMiddleware.js';
import User from './src/models/User.js';
import { startCronJobs, mountCronRoutes } from './src/cron/scheduler.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware — restrict CORS
// In production, set CORS_ORIGIN env var to your frontend domain (e.g. "https://cropsathi.vercel.app")
// In development, allow all localhost origins
const isDev = process.env.NODE_ENV !== 'production';
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : [];

// Warn once at startup if production has no whitelist configured, so the
// permissive fallback below is discoverable instead of surprising.
if (!isDev && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  CORS_ORIGIN not set — the API will accept requests from any origin. Set CORS_ORIGIN in the Render env to restrict it (comma-separate multiple origins).');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, same-origin)
    if (!origin) return callback(null, true);
    // Allow file:// pages — browsers send Origin: "null" for pages opened
    // directly from disk, which is the documented local-dev flow
    // ("open frontend/index.html in browser"). The frontend routes those
    // requests to the production API, so they must not be rejected.
    if (origin === 'null') return callback(null, true);
    // In development, allow all localhost/127.0.0.1 origins
    if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (isDev && /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // In production, check against the whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // No explicit CORS_ORIGIN configured: fall back to allowing all origins
    // so the deployed frontend works out of the box. The API is
    // token-authenticated, so CORS only gates what browsers may *read* — a
    // valid token is still required. Set CORS_ORIGIN to re-enable strict mode.
    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount API Routes
app.use('/api/auth', authRoutes);
app.use('/api/fields', fieldRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/advisory', advisoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/diagnosis', diagnosisRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/followup', followupRoutes);

// Health Check
app.get('/api/test', (req, res) => {
  res.json({ message: 'CropSathi backend is fully connected!' });
});

// User profile — moved here but should live in auth routes
app.get('/api/user/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({
      success: true,
      user: {
        name: user.name,
        phoneNumber: user.phoneNumber,
        farmDetails: user.farmDetails,
        profilePhoto: user.profilePhoto || '',
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    message: 'CropSathi API Gateway is online',
    database: 'Connected',
    timestamp: new Date().toISOString(),
  });
});
// Mount cron manual trigger routes
mountCronRoutes(app);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  startCronJobs();
  app.listen(PORT, () => {
    console.log(`🚀 CropSathi Backend running on http://localhost:${PORT}`);
  });
};

startServer();
