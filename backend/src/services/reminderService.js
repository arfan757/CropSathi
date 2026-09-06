import Reminder from '../models/Reminder.js';

export async function scheduleRemindersFromAdvisory(advisoryId, frequencyDays = 7) {
  const dueAt = new Date(Date.now() + frequencyDays * 24 * 60 * 60 * 1000);
  const reminder = await Reminder.create({
    advisoryId,
    reminderType: 'reapplication',
    dueAt,
    status: 'pending',
  });
  return reminder;
}

export async function getDueReminders() {
  return await Reminder.find({
    dueAt: { $lte: new Date() },
    status: 'pending',
  }).lean();
}

export async function completeReminder(reminderId) {
  return await Reminder.findByIdAndUpdate(
    reminderId,
    { status: 'done' },
    { new: true }
  );
}

export async function snoozeReminder(reminderId, hours = 6) {
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  return await Reminder.findByIdAndUpdate(
    reminderId,
    { $inc: { snoozeCount: 1 }, $set: { dueAt: snoozedUntil } },
    { new: true }
  );
}

export async function scheduleApplication(advisoryId) {
  return await Reminder.create({
    advisoryId,
    reminderType: 'application',
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: 'pending',
  });
}

export async function scheduleHarvestWait(advisoryId, phiDays = 14) {
  return await Reminder.create({
    advisoryId,
    reminderType: 'harvest_wait',
    dueAt: new Date(Date.now() + phiDays * 24 * 60 * 60 * 1000),
    status: 'pending',
  });
}
