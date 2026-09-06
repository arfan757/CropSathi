import cron from 'node-cron';
import Field from '../models/Field.js';
import { createNotification } from '../services/notificationService.js';

const PHOTO_PROMPT_INTERVAL_DAYS = 2;

async function scanFieldsForPhotoPrompts() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PHOTO_PROMPT_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  // Find active fields where lastPhotoPromptAt is older than 2 days (or never prompted)
  const fields = await Field.find({
    status: 'active',
    deletedAt: null,
    $or: [
      { lastPhotoPromptAt: { $lte: cutoff } },
      { lastPhotoPromptAt: null },
    ],
  }).lean();

  if (fields.length === 0) {
    console.log('⏱️  [photo-prompt-scan] No fields due for photo prompt');
    return { scanned: 0, notificationsSent: 0 };
  }

  console.log(`📸 [photo-prompt-scan] Found ${fields.length} fields due for photo prompt`);

  let notificationsSent = 0;

  for (const field of fields) {
    try {
      await createNotification(field.userId, 'photo_prompt', {
        farmId: field._id,
        deepLink: `/diagnose?farm=${field._id}`,
      });

      await Field.findByIdAndUpdate(field._id, { lastPhotoPromptAt: now });
      notificationsSent++;
    } catch (err) {
      console.error('Failed to send photo prompt:', err.message);
    }
  }

  return { scanned: fields.length, notificationsSent };
}

export function startPhotoPromptScanCron() {
  // Run daily at 08:00 UTC (after the followup scan at 07:00)
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ [cron] photo-prompt-scan triggered');
    try {
      await scanFieldsForPhotoPrompts();
    } catch (err) {
      console.error('❌ [cron] photo-prompt-scan crashed:', err.message);
    }
  });

  console.log('📅 [cron] photo-prompt-scan scheduled: daily at 08:00 UTC');
}

export { scanFieldsForPhotoPrompts };
