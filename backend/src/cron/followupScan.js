import cron from 'node-cron';
import FollowUp from '../models/FollowUp.js';
import { createNotification } from '../services/notificationService.js';

const MAX_REMINDERS = 2; // After 2 reminders, mark as unresponsive

async function scanPendingFollowUps() {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const pending = await FollowUp.find({
    scheduledFor: { $lte: today },
    status: 'pending',
  }).lean();

  if (pending.length === 0) {
    console.log('⏱️  [followup-scan] No pending follow-ups');
    return { scanned: 0, notificationsSent: 0, markedUnresponsive: 0 };
  }

  console.log(`📋 [followup-scan] Found ${pending.length} pending follow-ups`);

  let notificationsSent = 0;
  let markedUnresponsive = 0;

  for (const followup of pending) {
    try {
      if (followup.reminderCount >= MAX_REMINDERS) {
        await FollowUp.findByIdAndUpdate(followup._id, { status: 'unresponsive' });
        markedUnresponsive++;
        continue;
      }

      await createNotification(followup.userId, 'follow_up_check', {
        farmId: followup.farmId,
        caseId: followup.caseId,
        advisoryId: followup.advisoryId,
        followUpId: followup._id,
        deepLink: `/followup?id=${followup._id}`,
      });

      await FollowUp.findByIdAndUpdate(followup._id, {
        $inc: { reminderCount: 1 },
        $set: { lastReminderSent: new Date() },
      });

      notificationsSent++;
    } catch (err) {
      console.error('Failed to process follow-up:', err.message);
    }
  }

  return { scanned: pending.length, notificationsSent, markedUnresponsive };
}

export function startFollowupScanCron() {
  cron.schedule('0 7 * * *', async () => {
    console.log('⏰ [cron] followup-scan triggered');
    try {
      await scanPendingFollowUps();
    } catch (err) {
      console.error('❌ [cron] followup-scan crashed:', err.message);
    }
  });

  console.log('📅 [cron] followup-scan scheduled: daily at 07:00 UTC');
}

export { scanPendingFollowUps };
