/**
 * backend/src/db/riskScores.js
 * Replaces: src/models/RiskScore.js
 */

import supabase from '../config/supabase.js';

export function rowToRiskScore(row) {
  if (!row) return null;
  return {
    _id:                   row.id,
    id:                    row.id,
    farmId:                row.farm_id,
    computedAt:            row.computed_at,
    weatherComponent:      row.weather_component,
    ndviComponent:         row.ndvi_component,
    ndreComponent:         row.ndre_component,
    thermalComponent:      row.thermal_component,
    pestHistoryComponent:  row.pest_history_component,
    compositeScore:        row.composite_score,
    healthLevel:           row.health_level,
    staleSignals:          row.stale_signals ?? [],
    weightsUsed:           row.weights_used,
    triggeredAlert:        row.triggered_alert,
    weatherRiskHypothesis: row.weather_risk_hypothesis ?? row.disease_hypothesis ?? null,
    diseaseHypothesis:     row.weather_risk_hypothesis ?? row.disease_hypothesis ?? null,
    matchedWeatherRules:   row.matched_weather_rules ?? [],
    thresholdUsed:         row.threshold_used,
    inputsSnapshot:        row.inputs_snapshot,
    createdAt:             row.created_at,
    updatedAt:             row.updated_at,
  };
}

export async function findLatestRiskScore(farmId) {
  const { data, error } = await supabase
    .from('risk_scores')
    .select('*')
    .eq('farm_id', farmId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return rowToRiskScore(data);
}

export async function findRiskScoreHistory(farmId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('risk_scores')
    .select('*')
    .eq('farm_id', farmId)
    .gte('computed_at', since)
    .order('computed_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToRiskScore);
}

export async function createRiskScore(fields) {
  const { data, error } = await supabase
    .from('risk_scores')
    .insert({
      farm_id:                fields.farmId,
      computed_at:            fields.computedAt ?? new Date().toISOString(),
      weather_component:      fields.weatherComponent ?? 0,
      ndvi_component:         fields.ndviComponent ?? 0.5,
      ndre_component:         fields.ndreComponent ?? 0,
      thermal_component:      fields.thermalComponent ?? 0.5,
      pest_history_component: fields.pestHistoryComponent ?? 0,
      composite_score:        fields.compositeScore ?? null,
      health_level:           fields.healthLevel ?? null,
      stale_signals:          fields.staleSignals ?? [],
      weights_used:           fields.weightsUsed ?? null,
      triggered_alert:        fields.triggeredAlert ?? false,
      weather_risk_hypothesis: fields.weatherRiskHypothesis ?? fields.diseaseHypothesis ?? null,
      disease_hypothesis:     fields.weatherRiskHypothesis ?? fields.diseaseHypothesis ?? null,
      matched_weather_rules:  fields.matchedWeatherRules ?? [],
      threshold_used:         fields.thresholdUsed ?? 0.6,
      inputs_snapshot:        fields.inputsSnapshot ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToRiskScore(data);
}
