/**
 * backend/src/db/thermalReadings.js
 * Replaces: src/models/ThermalReading.js
 */

import supabase from '../config/supabase.js';

export function rowToThermal(row) {
  if (!row) return null;
  return {
    _id:                    row.id,
    id:                     row.id,
    farmId:                 row.farm_id,
    observedAt:             row.observed_at,
    estimatedCanopyTempC:   row.estimated_canopy_temp_c,
    baselineTempC:          row.baseline_temp_c,
    anomalyC:               row.anomaly_c,
    resolution:             row.resolution,
    thermalGrid:            row.thermal_grid,
    sceneSource:            row.scene_source,
    sceneId:                row.scene_id,
    cloudCoverPct:          row.cloud_cover_pct,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
}

export async function findLatestThermal(farmId) {
  const { data, error } = await supabase
    .from('thermal_readings')
    .select('*')
    .eq('farm_id', farmId)
    .order('observed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return rowToThermal(data);
}

export async function findThermalHistory(farmId, days = 28) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('thermal_readings')
    .select('*')
    .eq('farm_id', farmId)
    .gte('observed_at', since)
    .order('observed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToThermal);
}

/** Fetch thermal readings for all farms in a district (for thermal baseline) */
export async function findThermalByDistrict(district, days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('thermal_readings')
    .select('*, fields!inner(user_id, users!inner(farm_details))')
    .gte('observed_at', since)
    .eq('fields.users.farm_details->>district', district);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToThermal);
}

export async function createThermalReading(fields) {
  const { data, error } = await supabase
    .from('thermal_readings')
    .insert({
      farm_id:                 fields.farmId,
      observed_at:             fields.observedAt,
      estimated_canopy_temp_c: fields.estimatedCanopyTempC,
      baseline_temp_c:         fields.baselineTempC ?? null,
      anomaly_c:               fields.anomalyC ?? 0,
      resolution:              fields.resolution ?? 'farm_simulated',
      thermal_grid:            fields.thermalGrid ?? null,
      scene_source:            fields.sceneSource ?? 'formula',
      scene_id:                fields.sceneId ?? null,
      cloud_cover_pct:         fields.cloudCoverPct ?? 0,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToThermal(data);
}
