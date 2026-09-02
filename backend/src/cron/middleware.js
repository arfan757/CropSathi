/**
 * Verify the X-Cron-Secret header on cron endpoints.
 * In Vercel, set CRON_SECRET env var and configure Vercel Cron to send it.
 * Locally, pass the header manually or set CRON_SECRET in .env.
 */
export function verifyCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — allow in dev, block in prod
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'CRON_SECRET not configured' });
    }
    return next();
  }

  const provided = req.headers['x-cron-secret'];
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
