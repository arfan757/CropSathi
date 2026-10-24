/**
 * backend/scripts/migrations/rename_disease_hypothesis.js
 *
 * Migration script for F-04:
 * - Renames/backfills stored disease_hypothesis to weather_risk_hypothesis
 * - Leaves disease_hypothesis intact for read-compatibility
 *
 * Usage:
 *   node backend/scripts/migrations/rename_disease_hypothesis.js [--apply]
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import supabase from '../../src/config/supabase.js';

export async function migrateDiseaseHypothesis({ apply = false, client = supabase } = {}) {
  console.log(`Starting disease_hypothesis -> weather_risk_hypothesis migration (apply=${apply})...`);

  try {
    const { data: records, error } = await client
      .from('risk_scores')
      .select('id, disease_hypothesis, weather_risk_hypothesis')
      .limit(1000);

    if (error) {
      console.warn(`Supabase query notice: ${error.message}`);
      return { migratedCount: 0, totalChecked: 0 };
    }

    let migratedCount = 0;

    for (const record of records || []) {
      const needsMigration = record.weather_risk_hypothesis == null && record.disease_hypothesis != null;

      if (needsMigration) {
        migratedCount++;
        if (apply) {
          const { error: updateError } = await client
            .from('risk_scores')
            .update({ weather_risk_hypothesis: record.disease_hypothesis })
            .eq('id', record.id);

          if (updateError) {
            console.error(`Failed to update risk_score ${record.id}:`, updateError.message);
          }
        }
      }
    }

    console.log(`Migration complete. Checked ${records?.length || 0} records, ${migratedCount} needed migration.`);
    return { migratedCount, totalChecked: records?.length || 0 };
  } catch (err) {
    console.error('Migration error:', err);
    return { migratedCount: 0, totalChecked: 0, error: err.message };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  migrateDiseaseHypothesis({ apply })
    .then((result) => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
