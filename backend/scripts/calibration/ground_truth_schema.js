/**
 * Ground Truth Observation Schema & CSV Importer (F-03, F-21)
 *
 * Facilitates empirical calibration and backtesting of CropSathi remote-sensing
 * risk scores against field observations.
 */

export const VALID_OUTCOMES = [
  'confirmed_stress',
  'healthy',
  'confirmed_disease',
  'false_alarm',
];

export const VALID_STAGES = [
  'sowing',
  'vegetative',
  'flowering',
  'fruiting',
  'maturity',
  'harvested',
];

/**
 * Validate a single ground truth observation object.
 * @param {object} obs
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateObservation(obs) {
  const errors = [];

  if (!obs.date || isNaN(new Date(obs.date).getTime())) {
    errors.push('Invalid or missing date (must be YYYY-MM-DD)');
  }

  const lat = Number(obs.latitude ?? obs.lat ?? obs.gps?.lat);
  const lng = Number(obs.longitude ?? obs.lng ?? obs.gps?.lng);
  if (isNaN(lat) || lat < -90 || lat > 90) {
    errors.push('Invalid latitude (-90 to 90)');
  }
  if (isNaN(lng) || lng < -180 || lng > 180) {
    errors.push('Invalid longitude (-180 to 180)');
  }

  if (!obs.crop || typeof obs.crop !== 'string' || obs.crop.trim().length === 0) {
    errors.push('Missing cropType');
  }

  const stage = (obs.stage || '').toLowerCase().trim();
  if (!VALID_STAGES.includes(stage)) {
    errors.push(`Invalid stage '${obs.stage}'. Must be one of: ${VALID_STAGES.join(', ')}`);
  }

  const outcome = (obs.observedOutcome || obs.outcome || '').toLowerCase().trim();
  if (!VALID_OUTCOMES.includes(outcome)) {
    errors.push(`Invalid outcome '${obs.observedOutcome}'. Must be one of: ${VALID_OUTCOMES.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parses CSV text into an array of validated ground-truth observation records.
 *
 * Expected CSV Header:
 * date,farmId,latitude,longitude,crop,stage,observedOutcome,observedNdvi,observedNdre,notes
 *
 * @param {string} csvText
 * @returns {{ records: object[], errors: Array<{ row: number, errors: string[] }> }}
 */
export function importObservationsFromCsv(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { records: [], errors: [{ row: 0, errors: ['CSV content is empty'] }] };
  }

  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { records: [], errors: [{ row: 0, errors: ['CSV has no data rows'] }] };
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const records = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length < headers.length) {
      errors.push({ row: i + 1, errors: [`Expected ${headers.length} columns, found ${values.length}`] });
      continue;
    }

    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx];
    });

    const parsed = {
      date: rowObj.date,
      farmId: rowObj.farmId || rowObj.farm_id || null,
      gps: {
        lat: parseFloat(rowObj.latitude ?? rowObj.lat),
        lng: parseFloat(rowObj.longitude ?? rowObj.lng),
      },
      crop: rowObj.crop || rowObj.cropType,
      stage: (rowObj.stage || '').toLowerCase(),
      observedOutcome: (rowObj.observedOutcome || rowObj.outcome || '').toLowerCase(),
      observedNdvi: rowObj.observedNdvi ? parseFloat(rowObj.observedNdvi) : null,
      observedNdre: rowObj.observedNdre ? parseFloat(rowObj.observedNdre) : null,
      notes: rowObj.notes || '',
    };

    const validation = validateObservation(parsed);
    if (!validation.valid) {
      errors.push({ row: i + 1, errors: validation.errors });
    } else {
      records.push(parsed);
    }
  }

  return { records, errors };
}
