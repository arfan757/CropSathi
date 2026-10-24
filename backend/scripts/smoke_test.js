/**
 * Manual Smoke Test (Deliverable 4)
 *
 * Verifies that with credentials absent and ALLOW_SIMULATION unset:
 * - No fake/simulated score is produced
 * - No alert fires
 * - System safely returns hasData: false / score: null
 */

import { fetchNdviForFarm } from '../src/services/ndviService.js';
import { computeRiskScore } from '../src/services/riskService.js';
import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import Field from '../src/models/Field.js';
import RiskScore, { RiskScoreDocument } from '../src/models/RiskScore.js';

async function runSmokeTest() {
  console.log('=== CROPSATHI SMOKE TEST: CREDENTIALS ABSENT & ALLOW_SIMULATION UNSET ===\n');

  // Explicitly unset credentials and simulation flag
  delete process.env.ALLOW_SIMULATION;
  delete process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_SECRET;

  console.log('Environment state:');
  console.log('  ALLOW_SIMULATION:', process.env.ALLOW_SIMULATION || '(unset)');
  console.log('  COPERNICUS_CLIENT_ID:', process.env.COPERNICUS_CLIENT_ID || '(unset)');
  console.log('  COPERNICUS_CLIENT_SECRET:', process.env.COPERNICUS_CLIENT_SECRET || '(unset)\n');

  const mockFarm = {
    _id: 'smoke_test_farm_001',
    name: 'Smoke Test Farm',
    cropType: 'Cotton',
    cropStage: 'vegetative',
    areaInHectares: 2.5,
    polygon: [
      { lat: 21.1458, lng: 79.0882 },
      { lat: 21.1468, lng: 79.0882 },
      { lat: 21.1468, lng: 79.0892 },
      { lat: 21.1458, lng: 79.0892 },
    ],
  };

  // 1. Test fetchNdviForFarm with credentials absent and simulation disabled
  console.log('1. Testing fetchNdviForFarm (Optical Ingestion)...');
  let ndviResult = null;
  let ndviError = null;
  try {
    ndviResult = await fetchNdviForFarm(mockFarm);
  } catch (err) {
    ndviError = err;
  }

  if (ndviError) {
    console.log(`  -> Handled expected error: ${ndviError.message}`);
  } else {
    console.log(`  -> Result:`, ndviResult);
  }

  // 2. Mock Mongoose Field lookup to return mockFarm
  Field.findById = () => ({
    lean: async () => mockFarm,
  });

  // Mock RiskScore.create to return in-memory RiskScoreDocument instance
  const origCreate = RiskScore.create;
  RiskScore.create = async (doc) => new RiskScoreDocument(doc);

  // Mock empty readings in DB (no prior satellite data)
  NdviReading.findOne = () => ({
    sort: () => ({
      lean: async () => null,
    }),
  });
  ThermalReading.findOne = () => ({
    sort: () => ({
      lean: async () => null,
    }),
  });

  // 3. Test computeRiskScore with no satellite data
  console.log('\n2. Testing computeRiskScore with no satellite data...');
  const riskResult = await computeRiskScore(mockFarm._id);

  console.log('  -> Result Summary:');
  console.log(`     hasData: ${riskResult.hasData}`);
  console.log(`     compositeScore: ${riskResult.score}`);
  console.log(`     healthLevel: ${riskResult.level}`);
  console.log(`     confidence: ${riskResult.confidence}`);
  console.log(`     sceneSource: ${riskResult.sceneSource}`);
  console.log(`     isSimulated: ${riskResult.isSimulated}`);
  console.log(`     triggeredAlert: ${riskResult.triggeredAlert}`);
  console.log(`     staleSignals: [${riskResult.staleSignals.join(', ')}]`);

  // Assertions for safety
  const checks = [
    { name: 'No score produced (score is null)', passed: riskResult.score === null },
    { name: 'No level assigned (level is null)', passed: riskResult.level === null },
    { name: 'hasData is false', passed: riskResult.hasData === false },
    { name: 'No alert triggered (triggeredAlert is false)', passed: riskResult.triggeredAlert === false },
    { name: 'Confidence is low', passed: riskResult.confidence === 'low' },
  ];

  console.log('\n3. Verification Checklist:');
  let allPassed = true;
  for (const check of checks) {
    const icon = check.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  [${icon}] ${check.name}`);
    if (!check.passed) allPassed = false;
  }

  if (allPassed) {
    console.log('\n✅ SMOKE TEST PASSED: No score produced, no alert fired, zero fabricated data.');
  } else {
    console.error('\n❌ SMOKE TEST FAILED');
    process.exit(1);
  }
}

runSmokeTest().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
