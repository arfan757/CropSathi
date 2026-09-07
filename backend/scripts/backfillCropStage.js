/**
 * Backfill cropStage on existing fields from (cropType, sowingDate).
 *
 * Context: cropStage was never collected by the UI, so every field stored
 * the old 'vegetative' default (or nothing) and scored with early_sparse
 * weights forever. This script infers the stage per field and persists it.
 *
 * Safety rules (nothing surprising):
 * - Only touches fields where cropStage is missing OR still the legacy
 *   'vegetative' default AND old enough that 'vegetative' is implausible
 *   (i.e. inferred stage differs). Fields already set to any other stage
 *   (farmer choice) are never overwritten.
 * - Never writes 'harvested' automatically — that stays farmer-only, so no
 *   scores get nulled unexpectedly. Inferred 'harvested' is capped at
 *   'maturity'.
 * - Dry run by default: pass --apply to persist.
 *
 * Run with: node scripts/backfillCropStage.js [--apply]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Field from '../src/models/Field.js';
import { inferCropStage } from '../src/services/cropStageService.js';

async function backfill(apply) {
  const connUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(connUri, { serverSelectionTimeoutMS: 5000 });
  console.log('Connected to MongoDB');

  const fields = await Field.find({ status: 'active', deletedAt: null })
    .select('_id name cropType cropStage sowingDate')
    .lean();

  let candidates = 0;
  let updated = 0;
  const preview = [];

  for (const f of fields) {
    // Farmer-set non-default stage → never touch.
    if (f.cropStage && f.cropStage !== 'vegetative') continue;
    const inferred = inferCropStage(f.cropType, f.sowingDate);
    if (!inferred) continue;
    // Cap auto-write at maturity; harvested stays farmer-only.
    const target = inferred === 'harvested' ? 'maturity' : inferred;
    // Nothing to do when the stored value already matches.
    if ((f.cropStage || 'vegetative') === target) continue;

    candidates++;
    preview.push({ id: String(f._id), name: f.name, from: f.cropStage || '(none)', to: target });

    if (apply) {
      await Field.updateOne({ _id: f._id }, { $set: { cropStage: target } });
      updated++;
    }
  }

  console.log(`Scanned ${fields.length} active fields, ${candidates} need stage update.`);
  for (const p of preview.slice(0, 50)) {
    console.log(`  ${p.name} (${p.id}): ${p.from} → ${p.to}`);
  }
  if (preview.length > 50) console.log(`  ... and ${preview.length - 50} more`);

  if (!apply) {
    console.log('Dry run — no writes. Re-run with --apply to persist.');
  } else {
    console.log(`Updated ${updated} fields.`);
  }
  await mongoose.disconnect();
  process.exit(0);
}

const apply = process.argv.includes('--apply');
backfill(apply).catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
