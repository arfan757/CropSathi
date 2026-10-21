/**
 * backend/src/db/cropBaselines.js
 * Replaces: src/models/CropBaseline.js
 */

import supabase from '../config/supabase.js';

export function rowToCropBaseline(row) {
  if (!row) return null;
  return {
    _id:                row.id,
    id:                 row.id,
    cropType:           row.crop_type,
    region:             row.region,
    ndviP05:            row.ndvi_p05,
    ndviP95:            row.ndvi_p95,
    ndreP05:            row.ndre_p05,
    ndreP95:            row.ndre_p95,
    sampleSize:         row.sample_size,
    lastRecomputedAt:   row.last_recomputed_at,
    source:             row.source,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

export async function findBaseline(cropType, region = 'global') {
  const { data, error } = await supabase
    .from('crop_baselines')
    .select('*')
    .eq('crop_type', cropType.toLowerCase().trim())
    .eq('region', region.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return rowToCropBaseline(data);
}

export async function upsertCropBaseline(fields) {
  const { data, error } = await supabase
    .from('crop_baselines')
    .upsert({
      crop_type:          fields.cropType.toLowerCase().trim(),
      region:             (fields.region || 'global').toLowerCase().trim(),
      ndvi_p05:           fields.ndviP05 ?? 0.0,
      ndvi_p95:           fields.ndviP95 ?? 0.9,
      ndre_p05:           fields.ndreP05 ?? -0.1,
      ndre_p95:           fields.ndreP95 ?? 0.7,
      sample_size:        fields.sampleSize ?? 0,
      last_recomputed_at: fields.lastRecomputedAt ?? new Date().toISOString(),
      source:             fields.source ?? 'default',
    }, { onConflict: 'crop_type,region' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToCropBaseline(data);
}
