import 'dotenv/config';
import { readFileSync } from 'fs';
import { classifyDisease } from './src/services/minimaxService.js';

// Test with a real uploaded image
const imgPath = 'uploads/cases/6a97f4c703cde434307bbebb/1788343496013-img1.jpg';
const bytes = readFileSync(imgPath);
const b64 = bytes.toString('base64');
console.log('Image size:', bytes.length, 'bytes, base64 length:', b64.length);

try {
  const r = await classifyDisease(b64, 'potato', 'vegetative', 'Health 65');
  console.log('Full result:', JSON.stringify(r, null, 2));
} catch (e) {
  console.error('ERROR:', e.message);
}
