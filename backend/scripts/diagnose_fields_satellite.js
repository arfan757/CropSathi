import dotenv from 'dotenv';
dotenv.config();

import Field from '../src/models/Field.js';
import supabase from '../src/config/supabase.js';
import { fetchSentinelNdvi } from '../src/services/sentinelService.js';
import { computeRiskScore } from '../src/services/riskService.js';

async function main() {
  console.log('--- 1. Checking Fields in Database ---');
  const fields = await Field.find({ deletedAt: null });
  console.log(`Found ${fields.length} active fields:`);
  for (const f of fields) {
    console.log(`- ID: ${f._id}, Name: ${f.name}, Crop: ${f.cropType}, Stage: ${f.cropStage}, Area: ${f.areaInHectares} ha, Center: [${f.centerLat}, ${f.centerLng}]`);
    console.log(`  Polygon points: ${JSON.stringify(f.polygon)}`);
  }

  console.log('\n--- 2. Checking Existing Risk Scores in Supabase ---');
  const fieldIds = fields.map(f => String(f._id));
  const { data: scores, error } = await supabase
    .from('risk_scores')
    .select('id, farm_id, composite_score, computed_at, inputs_snapshot')
    .in('farm_id', fieldIds);
  if (error) {
    console.error('Error querying risk_scores:', error.message);
  } else {
    console.log(`Found ${scores?.length || 0} scores in Supabase:`);
    for (const s of scores || []) {
      console.log(`- Farm: ${s.farm_id}, Score: ${s.composite_score}, At: ${s.computed_at}, Snapshot:`, s.inputs_snapshot);
    }
  }

  if (fields.length > 0) {
    const testFarm = fields[0];
    console.log(`\n--- 3. Testing fetchSentinelNdvi on farm "${testFarm.name}" ---`);
    try {
      const result = await fetchSentinelNdvi(testFarm);
      console.log('Result:', {
        sceneInfo: result.sceneInfo,
        observedAt: result.observedAt,
        sceneAgeDays: result.sceneAgeDays,
        isStale: result.isStale,
        noSatelliteData: result.noSatelliteData,
        hasNdviGrid: !!result.ndviGrid,
      });
    } catch (err) {
      console.error('fetchSentinelNdvi failed:', err.message, err.response?.data ? String(err.response.data) : '');
    }
  }
}

main().catch(console.error);
