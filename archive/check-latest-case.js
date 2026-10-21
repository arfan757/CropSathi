import 'dotenv/config';
import connectDB from './src/config/db.js';
import DiagnosisCase from './src/models/DiagnosisCase.js';
import CasePhoto from './src/models/CasePhoto.js';

await connectDB();
const cases = await DiagnosisCase.find().sort({ createdAt: -1 }).limit(5).lean();
console.log('\n=== LAST 5 CASES ===');
for (const c of cases) {
  console.log(`\nCase: ${c._id}`);
  console.log(`  Status: ${c.status}`);
  console.log(`  Outcome: ${c.outcome || 'null'}`);
  console.log(`  Triggered by: ${c.triggeredBy}`);
  console.log(`  Created: ${c.createdAt}`);
  console.log(`  Final disease: ${c.finalDiseaseCode || 'null'}`);
  console.log(`  Confidence: ${c.confidence}`);
  console.log(`  Final severity: ${c.finalSeverity || 'null'}`);
  console.log(`  Gemini result keys: ${c.geminiResult ? Object.keys(c.geminiResult).join(',') : 'null'}`);
  if (c.geminiResult) {
    console.log(`  detectedIssue: ${c.geminiResult.detectedIssue || 'null'}`);
    console.log(`  imageQualityOk: ${c.geminiResult.imageQualityOk}`);
    console.log(`  matchesRiskSignal: ${c.geminiResult.matchesRiskSignal}`);
    console.log(`  notes: ${(c.geminiResult.notes || '').substring(0, 150)}`);
  }
  const photos = await CasePhoto.find({ caseId: c._id }).lean();
  console.log(`  Photos: ${photos.length}`);
  for (const p of photos) {
    const fs = await import('fs');
    const path = await import('path');
    const fp = path.join(process.cwd(), 'uploads', p.storageKey);
    const exists = fs.existsSync(fp);
    const size = exists ? fs.statSync(fp).size : 0;
    console.log(`    - ${p.storageKey} | ${size} bytes | ${exists ? 'EXISTS' : 'MISSING'}`);
  }
}
process.exit(0);
