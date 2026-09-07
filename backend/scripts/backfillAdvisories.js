/**
 * Regenerate generic/fallback advisories with full TNAU-grade content.
 *
 * Context: advisories created while the Gemini advisory call failed (or for
 * disease labels that missed the rules table) were persisted as generic
 * guidance ("Continue regular field monitoring" + generic prevention tips).
 * This script finds the latest advisory per case that is still generic and
 * regenerates it through the Gemini-first path (with normalized-rules
 * fallback), creating a new version — old versions are kept.
 *
 * A doc counts as generic when ANY of these hold:
 * - isGeneric === true, or source is missing/'rules' with a 'general_monitor'
 *   cultural action (legacy generic marker), or
 * - it has no remedies[] AND no pathogenName (pre-upgrade shape).
 *
 * Safety rules:
 * - Only the latest version per case is examined; history is never rewritten.
 * - Cases whose latest advisory is already Gemini-sourced and non-generic
 *   are skipped.
 * - Dry run by default: pass --apply to persist. Pass --caseId=<id> to
 *   target a single case.
 *
 * Requires GEMINI_API_KEY for AI content; without it, regeneration still
 * improves mismatched disease labels via normalized rules lookup.
 *
 * Run with: node scripts/backfillAdvisories.js [--apply] [--caseId=<id>]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import Advisory from '../src/models/Advisory.js';
import DiagnosisCase from '../src/models/DiagnosisCase.js';
import Field from '../src/models/Field.js';
import User from '../src/models/User.js';
import { generateAdvisoryForCase } from '../src/services/advisoryService.js';

function isGenericDoc(a) {
  if (!a) return false;
  if (a.isGeneric === true) return true;
  const cultural = a.ipmCulturalActions || [];
  if (cultural.some((x) => x?.actionKey === 'general_monitor')) return true;
  const hasRemedies = Array.isArray(a.remedies) && a.remedies.length > 0;
  if (!hasRemedies && !a.pathogenName) return true;
  return false;
}

async function backfill({ apply, onlyCaseId }) {
  const connUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!connUri) throw new Error('Set MONGODB_URI (or MONGO_URI) to run this script');
  if (!process.env.GEMINI_API_KEY) {
    console.log('NOTE: GEMINI_API_KEY is not set — regeneration will use normalized rules content only.');
  }
  await mongoose.connect(connUri, { serverSelectionTimeoutMS: 8000 });
  console.log('Connected to MongoDB');

  const match = onlyCaseId
    ? { caseId: new mongoose.Types.ObjectId(onlyCaseId) }
    : {};
  const latestPerCase = await Advisory.aggregate([
    { $match: match },
    { $sort: { version: -1 } },
    { $group: { _id: '$caseId', doc: { $first: '$$ROOT' } } },
  ]);

  const candidates = latestPerCase.map((g) => g.doc).filter(isGenericDoc);
  console.log(`Scanned ${latestPerCase.length} cases, ${candidates.length} have a generic latest advisory.`);

  let regenerated = 0;
  for (const adv of candidates) {
    const dc = await DiagnosisCase.findById(adv.caseId).lean();
    if (!dc || dc.status === 'deleted') {
      console.log(`  skip ${adv.caseId}: case missing/deleted`);
      continue;
    }
    const [farm, user] = await Promise.all([
      dc.farmId ? Field.findById(dc.farmId).select('cropType cropStage').lean() : null,
      dc.userId ? User.findById(dc.userId).select('farmDetails.district').lean() : null,
    ]);
    const label = `${farm?.cropType || '?'} / ${adv.diseaseCode} (${adv.caseId})`;
    if (!apply) {
      console.log(`  would regenerate: ${label}`);
      continue;
    }
    try {
      const next = await generateAdvisoryForCase(
        adv.caseId,
        adv.diseaseCode,
        adv.severity,
        adv.cropStage || farm?.cropStage || 'vegetative',
        farm?.cropType || '',
        {
          confidence: Number.isFinite(Number(dc.confidence)) ? Number(dc.confidence) : undefined,
          district: user?.farmDetails?.district || '',
        },
      );
      regenerated++;
      console.log(`  regenerated: ${label} → v${next.version} (source: ${next.source})`);
    } catch (err) {
      console.log(`  FAILED ${label}: ${err.message}`);
    }
  }

  if (!apply) {
    console.log('Dry run — no writes. Re-run with --apply to persist.');
  } else {
    console.log(`Regenerated ${regenerated}/${candidates.length} generic advisories.`);
  }
  await mongoose.disconnect();
  process.exit(0);
}

const apply = process.argv.includes('--apply');
const caseArg = process.argv.find((a) => a.startsWith('--caseId='));
backfill({ apply, onlyCaseId: caseArg ? caseArg.split('=')[1] : null }).catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
