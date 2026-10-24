/**
 * backend/scripts/migrations/rename_risk_components.js
 *
 * Migration script for F-07 and F-20:
 * - Renames/backfills stored component fields to ndvi_stress, ndre_stress, thermal_stress
 *   (preserving 0-1 stress semantics).
 * - Backfills top-level no_vegetation_detected boolean from inputs_snapshot.
 * - Leaves ndvi_component, ndre_component, thermal_component intact for read-compatibility.
 *
 * Usage:
 *   node backend/scripts/migrations/rename_risk_components.js [--apply]
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import supabase from '../../src/config/supabase.js';

export async function migrateRiskComponents({ apply = false, client = supabase } = {}) {
  console.log(`Starting risk components migration (apply=${apply})...`);

  // Check if supabase table is available
  try {
    const { data: records, error } = await client
      .from('risk_scores')
      .select('*')
      .limit(1000);

    if (error) {
      console.warn(`Supabase query notice: ${error.message}`);
      return { migratedCount: 0, totalChecked: 0 };
    }

    let migratedCount = 0;
    const updates = [];

    for (const record of records || []) {
      const needsNdvi = record.ndvi_stress == null && record.ndvi_component != null;
      const needsNdre = record.ndre_stress == null && record.ndre_component != null;
      const needsThermal = record.thermal_stress == null && record.thermal_component != null;
      const noVeg = Boolean(
        record.no_vegetation_detected ??
        record.inputs_snapshot?.noVegetationDetected ??
        false
      );
      const needsNoVeg = record.no_vegetation_detected == null;

      if (needsNdvi || needsNdre || needsThermal || needsNoVeg) {
        migratedCount++;
        const updatePayload = {
          id: record.id,
          ndvi_stress: record.ndvi_stress ?? record.ndvi_component,
          ndre_stress: record.ndre_stress ?? record.ndre_component,
          thermal_stress: record.thermal_stress ?? record.thermal_component,
          no_vegetation_detected: noVeg,
        };

        if (apply) {
          const { error: updateError } = await client
            .from('risk_scores')
            .update(updatePayload)
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

// Direct execution from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  migrateRiskComponents({ apply })
    .then((result) => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
