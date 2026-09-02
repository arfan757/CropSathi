import cron from 'node-cron';

/**
 * Daily follow-up scan.
 *
 * Finds follow_ups where scheduled_for <= today and status='pending',
 * and creates notification intent for farmers to complete follow-up.
 *
 * NOTE: FollowUp model not yet created. This cron is stubbed to log
 * when the model exists. Enable by creating backend/src/models/FollowUp.js
 * and uncommenting the query below.
 */
async function scanPendingFollowUps() {
  // TODO: Enable when FollowUp model is created
  // import FollowUp from '../models/FollowUp.js';
  //
  // const today = new Date();
  // today.setHours(23, 59, 59, 999);
  //
  // const pending = await FollowUp.find({
  //   scheduledFor: { $lte: today },
  //   status: 'pending',
  // }).lean();
  //
  // if (pending.length === 0) {
  //   console.log('⏱️  [followup-scan] No pending follow-ups');
  //   return { scanned: 0 };
  // }
  //
  // console.log(`📋 [followup-scan] Found ${pending.length} pending follow-ups`);
  //
  // // In production, this would trigger push notification delivery
  // // (FCM/SMS integration is out of scope for v1 per spec §14)
  // for (const followup of pending) {
  //   console.log(`  → Follow-up ${followup._id} for case ${followup.caseId} due ${followup.scheduledFor}`);
  // }
  //
  // return { scanned: pending.length };

  console.log('⏱️  [followup-scan] Stubbed — FollowUp model not yet created');
  return { scanned: 0 };
}

/**
 * Schedule: daily at 07:00 UTC (12:30 PM IST).
 * Cron: 0 7 * * *
 */
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

// Allow manual trigger for testing
export { scanPendingFollowUps };
