import cron from 'node-cron';
import Notification from '../models/Notification.js';
import Reminder from '../models/Reminder.js';
import FollowUp from '../models/FollowUp.js';

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
      await Reminder.findByIdAndUpdate(reminder._id, { status: 'done' });
      notificationsCreated++;
    } catch (err) {
      console.error('Failed to process reminder:', err.message);
    }
  }

  // Find due follow-ups
  const dueFollowUps = await FollowUp.find({
    scheduledFor: { $lte: now },
    status: 'pending',
  }).lean();

  for (const followUp of dueFollowUps) {
    try {
      await FollowUp.findByIdAndUpdate(followUp._id, { $inc: { reminderCount: 1 } });
      notificationsCreated++;
    } catch (err) {
      console.error('Failed to process follow-up:', err.message);
    }
  }

  console.log(`[notification-dispatch] Processed ${notificationsCreated} items`);
  return { notificationsCreated, dueReminders: dueReminders.length, dueFollowUps: dueFollowUps.length };
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
