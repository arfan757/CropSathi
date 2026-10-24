import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

test('my-fields.html DOM elements and script syntax check', () => {
  const html = fs.readFileSync('frontend/my-fields.html', 'utf8');

  // Verify all scripts parse without syntax errors
  const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scriptMatches.length > 0, 'Should find scripts in HTML');

  for (const [idx, m] of scriptMatches.entries()) {
    const code = m[1];
    if (!code.trim()) continue;
    assert.doesNotThrow(() => {
      new Function(code);
    }, `Script tag ${idx} failed to parse`);
  }

  // Verify all getElementById targets exist
  const idRegex = /document\.getElementById\((['"])(.*?)\1\)/g;
  const ids = new Set();
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    ids.add(match[2]);
  }

  const missing = [];
  for (const id of ids) {
    const hasDouble = html.includes(`id="${id}"`);
    const hasSingle = html.includes(`id='${id}'`);
    if (!hasDouble && !hasSingle) {
      missing.push(id);
    }
  }

  assert.deepStrictEqual(missing, [], `Missing DOM element IDs: ${missing.join(', ')}`);
});

test('my-fields.html getHealthDisplay handles legacy, simulated, and null fields gracefully', () => {
  const html = fs.readFileSync('frontend/my-fields.html', 'utf8');
  
  // Extract getHealthDisplay function code
  const fnMatch = html.match(/function getHealthDisplay\(field\) \{([\s\S]*?)\n    \}/);
  assert.ok(fnMatch, 'getHealthDisplay function should be present');

  const getHealthDisplay = new Function('field', fnMatch[1]);

  // 1. Missing healthScore completely
  const d1 = getHealthDisplay({ name: 'Field 1' });
  assert.strictEqual(d1.statusLabel, 'No Data');
  assert.strictEqual(d1.scoreText, '—');
  assert.strictEqual(d1.confidence, 'low');

  // 2. Harvested stage
  const d2 = getHealthDisplay({ name: 'Field 2', cropStage: 'harvested', healthScore: { compositeScore: 85 } });
  assert.strictEqual(d2.statusLabel, 'Harvested');
  assert.strictEqual(d2.scoreText, '—');

  // 3. Simulated data
  const d3 = getHealthDisplay({
    name: 'Field 3',
    healthScore: {
      hasData: true,
      compositeScore: 78,
      isSimulated: true,
      confidence: 'low',
      sceneAgeDays: 0,
      sceneSource: 'simulated'
    }
  });
  assert.strictEqual(d3.sourceLabel, 'Estimated');
  assert.strictEqual(d3.confidence, 'low');
  assert.ok(d3.banner.includes('Estimated score'));

  // 4. Regular high health Sentinel-2
  const d4 = getHealthDisplay({
    name: 'Field 4',
    healthScore: {
      hasData: true,
      compositeScore: 88,
      isSimulated: false,
      confidence: 'high',
      sceneAgeDays: 1,
      sceneSource: 'sentinel-2',
      level: 'healthy'
    }
  });
  assert.strictEqual(d4.statusLabel, 'Healthy');
  assert.strictEqual(d4.scoreText, '88 / 100');
  assert.strictEqual(d4.sourceLabel, 'Sentinel-2');
  assert.strictEqual(d4.confidence, 'high');
  assert.strictEqual(d4.photoPrompt, false);

  // 5. High risk real satellite (should trigger photoPrompt)
  const d5 = getHealthDisplay({
    name: 'Field 5',
    healthScore: {
      hasData: true,
      compositeScore: 32,
      isSimulated: false,
      confidence: 'high',
      sceneAgeDays: 2,
      sceneSource: 'sentinel-2',
      healthLevel: 'high'
    }
  });
  assert.strictEqual(d5.statusLabel, 'High Risk');
  assert.strictEqual(d5.scoreText, '32 / 100');
  assert.strictEqual(d5.photoPrompt, true);
});
