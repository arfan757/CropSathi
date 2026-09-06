import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import Advisory from '../models/Advisory.js';
import DiagnosisCase from '../models/DiagnosisCase.js';
import { createNotification } from '../services/notificationService.js';

const REMINDER_TYPE_MAP = {
  application: 'remedy_reminder',
  reapplication: 'reapplication_reminder',
  harvest_wait: 'harvest_safety_wait',
};

export async function dispatchNotifications() {
  const now = new Date();

  // Find due reminders
  const dueReminders = await Reminder.find({
    dueAt: { $lte: now },
    status: 'pending',
  }).lean();

  let notificationsCreated = 0;

  for (const reminder of dueReminders) {
    try {
      // Look up Advisory → DiagnosisCase to get userId + farmId
      const advisory = await Advisory.findById(reminder.advisoryId).lean();
      if (!advisory) {
        await Reminder.findByIdAndUpdate(reminder._id, { status: 'done' });
        continue;
      }

      const diagnosisCase = await DiagnosisCase.findById(advisory.caseId).lean();
      if (!diagnosisCase) {
        await Reminder.findByIdAndUpdate(reminder._id, { status: 'done' });
        continue;
      }

      const notificationType = REMINDER_TYPE_MAP[reminder.reminderType];
      if (notificationType) {
        await createNotification(diagnosisCase.userId, notificationType, {
          farmId: diagnosisCase.farmId,
          caseId: diagnosisCase._id,
          advisoryId: advisory._id,
          deepLink: `/advisory?id=${advisory._id}`,
        });
        notificationsCreated++;
      }

      await Reminder.findByIdAndUpdate(reminder._id, { status: 'done' });
    } catch (err) {
      console.error('Failed to process reminder:', err.message);
    }
  }

  console.log(`[notification-dispatch] Processed ${notificationsCreated} notifications`);
  return { notificationsCreated, dueReminders: dueReminders.length };
}

export function startNotificationDispatchCron() {
  cron.schedule('*/15 7-22 * * *', async () => {
    console.log('⏰ [cron] notification-dispatch triggered');
    try {
      await dispatchNotifications();
    } catch (err) {
      console.error('❌ [cron] notification-dispatch crashed:', err.message);
    }
  });
  console.log('📅 [cron] notification-dispatch scheduled: every 15 min 7AM-10PM');
}
