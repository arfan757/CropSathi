import 'dotenv/config';
import Field from '../src/models/Field.js';
import supabase from '../src/config/supabase.js';
import { formatFieldHealthScore } from '../src/controllers/fieldController.js';

async function test() {
  const fields = await Field.find({ deletedAt: null });
  const userFields = fields.filter(f => ['good field', 'Field', 'Test Field 2'].includes(f.name));
  const ids = userFields.map(f => String(f._id));

  const { data: scores } = await supabase
    .from('risk_scores')
    .select('*')
    .in('farm_id', ids)
    .order('computed_at', { ascending: false });

  const latestByFarm = {};
  for (const s of scores || []) {
    if (!latestByFarm[s.farm_id]) latestByFarm[s.farm_id] = s;
  }

  for (const f of userFields) {
    const formatted = formatFieldHealthScore(latestByFarm[f._id]);
    console.log(`\n=== Field: "${f.name}" (${f.cropType}) ===`);
    console.log(`  Health Score: ${formatted.compositeScore} / 100 (${formatted.healthLevel})`);
    console.log(`  Satellite Scan: ${formatted.sceneSource} · Data from ${formatted.sceneAgeDays} day(s) ago`);
    console.log(`  Cloud Cover: ${formatted.cloudCoverPct}%`);
    console.log(`  Component Stresses: NDVI=${formatted.components?.ndviStress}, NDRE=${formatted.components?.ndreStress}`);
  }
}

test().catch(console.error);
