/**
 * backend/src/db/diagnosisCases.js
 * Replaces: src/models/DiagnosisCase.js
 */

import supabase from '../config/supabase.js';

export function rowToCase(row) {
  if (!row) return null;
  return {
    _id:                    row.id,
    id:                     row.id,
    farmId:                 row.farm_id,
    userId:                 row.user_id,
    triggeringRiskScoreId:  row.triggering_risk_score_id,
    triggeredBy:            row.triggered_by,
    status:                 row.status,
    geminiResult:           row.gemini_result,
    finalDiseaseCode:       row.final_disease_code,
    finalSeverity:          row.final_severity,
    confidence:             row.confidence,
    outcome:                row.outcome,
    requiresExpertReview:   row.requires_expert_review,
    gpsPoint: {
      lat: row.gps_lat,
      lng: row.gps_lng,
    },
    capturedAt:             row.captured_at,
    deletedAt:              row.deleted_at,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
}

export async function findCaseById(id) {
  const { data, error } = await supabase
    .from('diagnosis_cases')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return rowToCase(data);
}

export async function findCasesByFarm(farmId, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('diagnosis_cases')
    .select('*')
    .eq('farm_id', farmId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCase);
}

export async function findCasesByUser(userId) {
  const { data, error } = await supabase
    .from('diagnosis_cases')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCase);
}

/** Get most recent N cases for a farm — used by pest-history window query */
export async function findRecentCasesForFarm(farmId, limitDays = 180) {
  const since = new Date(Date.now() - limitDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from('diagnosis_cases')
    .select('*')
    .eq('farm_id', farmId)
    .gte('created_at', since)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCase);
}

export async function createCase({ farmId, userId, triggeredBy, triggeringRiskScoreId }) {
  const { data, error } = await supabase
    .from('diagnosis_cases')
    .insert({
      farm_id:                   farmId,
      user_id:                   userId,
      triggered_by:              triggeredBy,
      triggering_risk_score_id:  triggeringRiskScoreId ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToCase(data);
}

export async function updateCase(id, fields) {
  const patch = {};
  if (fields.status               !== undefined) patch.status                = fields.status;
  if (fields.geminiResult         !== undefined) patch.gemini_result         = fields.geminiResult;
  if (fields.finalDiseaseCode     !== undefined) patch.final_disease_code    = fields.finalDiseaseCode;
  if (fields.finalSeverity        !== undefined) patch.final_severity        = fields.finalSeverity;
  if (fields.confidence           !== undefined) patch.confidence            = fields.confidence;
  if (fields.outcome              !== undefined) patch.outcome               = fields.outcome;
  if (fields.requiresExpertReview !== undefined) patch.requires_expert_review = fields.requiresExpertReview;
  if (fields.gpsPoint?.lat        !== undefined) patch.gps_lat               = fields.gpsPoint.lat;
  if (fields.gpsPoint?.lng        !== undefined) patch.gps_lng               = fields.gpsPoint.lng;

  const { data, error } = await supabase
    .from('diagnosis_cases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToCase(data);
}
