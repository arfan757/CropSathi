import 'dotenv/config';
import { classifyDisease, structureCnnResult, generateAdvisory } from './src/services/minimaxService.js';

// Use a real tiny JPEG (1x1 pixel)
const tinyB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

async function run() {
  console.log('=== TEST 1: classifyDisease ===');
  try {
    const r = await classifyDisease(tinyB64, 'potato', 'vegetative', 'Health score 65/100');
    console.log('Keys:', Object.keys(r).join(', '));
    console.log('image_quality_ok:', r.image_quality_ok);
    console.log('detected_issue:', r.detected_issue);
    console.log('severity:', r.severity);
    console.log('confidence:', r.confidence);
    console.log('matches_risk_signal:', r.matches_risk_signal);
    console.log('treatment.immediate_actions:', JSON.stringify(r.treatment && r.treatment.immediate_actions));
    console.log('prevention length:', r.prevention && r.prevention.length);

    // Simulate routeDiagnosis
    const route = (!r.image_quality_ok && (r.detected_issue || '').toLowerCase() === 'unknown') ? 'retry'
      : (r.detected_issue || '').trim().toLowerCase() === 'healthy' ? 'false_alarm'
      : r.confidence >= 0.75 && r.matches_risk_signal ? 'confirmed'
      : 'expert_review';
    console.log('routeDiagnosis result:', route);
  } catch (e) {
    console.error('classifyDisease error:', e.message);
  }

  console.log('\n=== TEST 2: structureCnnResult ===');
  try {
    const r2 = await structureCnnResult('Potato___Early_blight', 0.87, ['Potato___Early_blight', 'Potato___Late_blight', 'Tomato___Early_blight'], 'potato');
    console.log('Keys:', Object.keys(r2).join(', '));
    console.log('detected_issue:', r2.detected_issue);
    console.log('treatment.immediate_actions:', JSON.stringify(r2.treatment && r2.treatment.immediate_actions));
  } catch (e) {
    console.error('structureCnnResult error:', e.message);
  }

  console.log('\n=== TEST 3: generateAdvisory ===');
  try {
    const r3 = await generateAdvisory('potato_early_blight', 'medium', 'vegetative', 'potato');
    console.log('Keys:', Object.keys(r3).join(', '));
    console.log('cultural length:', r3.cultural && r3.cultural.length);
    console.log('prevention length:', r3.prevention && r3.prevention.length);
    console.log('chemical:', r3.chemical ? JSON.stringify(r3.chemical).substring(0, 100) : 'null');
  } catch (e) {
    console.error('generateAdvisory error:', e.message);
  }
}

run().catch(console.error);
