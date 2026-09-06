import 'dotenv/config';
import { classifyDisease } from './src/services/minimaxService.js';

const tinyB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

try {
  const r = await classifyDisease(tinyB64, 'potato', 'vegetative', 'Health 65');
  console.log('Full result:', JSON.stringify(r, null, 2));
} catch (e) {
  console.error('ERROR:', e.message);
  console.error('STACK:', e.stack);
}
