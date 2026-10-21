/**
 * backend/src/db/ndviReadings.js
 * Replaces: src/models/NdviReading.js
 */

import supabase from '../config/supabase.js';

export function rowToNdvi(row) {
  if (!row) return null;
  return {
    _id:                  row.id,
    id:                   row.id,
    farmId:               row.farm_id,
    observedAt:           row.observed_at,
    ndvi:                 row.ndvi,
    ndre:                 row.ndre,
    cloudCoverPct:        row.cloud_cover_pct,
    trailingAvgNdvi28d:   row.trailing_avg_ndvi_28d,
    anomalyScore:         row.anomaly_score,
    pixelCountPureCrop:   row.pixel_count_pure_crop,
    ndviGrid:             row.ndvi_grid,
    ndreGrid:             row.ndre_grid,
    sceneSource:          row.scene_source,
    sceneId:              row.scene_id,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  };
}

export async function findLatestNdvi(farmId) {
  const { data, error } = await supabase
    .from('ndvi_readings')
    .select('*')
    .eq('farm_id', farmId)
    .order('observed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return rowToNdvi(data);
}

export async function findNdviHistory(farmId, days = 28) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('ndvi_readings')
    .select('*')
    .eq('farm_id', farmId)
    .gte('observed_at', since)
    .order('observed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToNdvi);
}

export async function createNdviReading(fields) {
  const { data, error } = await supabase
    .from('ndvi_readings')
    .insert({
      farm_id:               fields.farmId,
      observed_at:           fields.observedAt,
      ndvi:                  fields.ndvi,
      ndre:                  fields.ndre ?? null,
      cloud_cover_pct:       fields.cloudCoverPct ?? 0,
      trailing_avg_ndvi_28d: fields.trailingAvgNdvi28d ?? null,
      anomaly_score:         fields.anomalyScore ?? 0,
      pixel_count_pure_crop: fields.pixelCountPureCrop ?? null,
      ndvi_grid:             fields.ndviGrid ?? null,
      ndre_grid:             fields.ndreGrid ?? null,
      scene_source:          fields.sceneSource ?? 'simulated',
      scene_id:              fields.sceneId ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToNdvi(data);
}
