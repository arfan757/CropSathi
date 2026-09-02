import cron from 'node-cron';

const RETRAIN_THRESHOLD = parseInt(process.env.RETRAIN_THRESHOLD || '500', 10);

/**
 * Weekly retrain trigger.
 *
 * Counts un-exported training_samples. If above threshold (default 500),
 * marks a batch exported=true and writes a manifest to object storage
 * for ml/training to pick up.
 *
 * NOTE: TrainingSample model not yet created. This cron is stubbed to log
 * when the model exists. Enable by creating backend/src/models/TrainingSample.js
 * and uncommenting the query below.
 */
async function checkRetrainReady() {
  // TODO: Enable when TrainingSample model is created
  // import TrainingSample from '../models/TrainingSample.js';
  //
  // const unexported = await TrainingSample.countDocuments({ exported: false });
  //
  // if (unexported < RETRAIN_THRESHOLD) {
  //   console.log(`⏱️  [retrain-trigger] ${unexported}/${RETRAIN_THRESHOLD} samples — below threshold`);
  //   return { exported: 0, total: unexported };
  // }
  //
  // console.log(`📦 [retrain-trigger] ${unexported} un-exported samples (threshold: ${RETRAIN_THRESHOLD})`);
  //
  // // Mark a batch as exported
  // const batch = await TrainingSample.find({ exported: false })
  //   .limit(RETRAIN_THRESHOLD)
  //   .lean();
  //
  // const ids = batch.map(s => s._id);
  // await TrainingSample.updateMany(
  //   { _id: { $in: ids } },
  //   { exported: true }
  // );
  //
  // // In production, write manifest to object storage (Supabase/Vercel Blob)
  // // const manifest = batch.map(s => ({ key: s.photoStorageKey, label: s.label }));
  // // await storageClient.write(`manifests/retrain-${Date.now()}.json`, JSON.stringify(manifest));
  //
  // console.log(`✅ [retrain-trigger] Marked ${ids.length} samples as exported`);
  // return { exported: ids.length, total: unexported };

  console.log('⏱️  [retrain-trigger] Stubbed — TrainingSample model not yet created');
  return { exported: 0, total: 0 };
}

/**
 * Schedule: weekly on Sunday at 02:00 UTC (07:30 AM IST).
 * Cron: 0 2 * * 0
 */
export function startRetrainTriggerCron() {
  cron.schedule('0 2 * * 0', async () => {
    console.log('⏰ [cron] retrain-trigger triggered');
    try {
      await checkRetrainReady();
    } catch (err) {
      console.error('❌ [cron] retrain-trigger crashed:', err.message);
    }
  });

  console.log('📅 [cron] retrain-trigger scheduled: weekly on Sunday at 02:00 UTC');
}

// Allow manual trigger for testing
export { checkRetrainReady };
