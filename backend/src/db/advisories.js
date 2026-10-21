/**
 * backend/src/db/advisories.js
 * Replaces: src/models/Advisory.js
 */

import supabase from '../config/supabase.js';

export function rowToAdvisory(row) {
  if (!row) return null;
  return {
    _id:                     row.id,
    id:                      row.id,
    caseId:                  row.case_id,
    version:                 row.version,
    diseaseCode:             row.disease_code,
    severity:                row.severity,
    cropStage:               row.crop_stage,
    summary:                 row.summary,
    pathogenName:            row.pathogen_name,
    symptoms:                row.symptoms,
    remedies:                row.remedies ?? [],
    ipmCulturalActions:      row.ipm_cultural_actions ?? [],
    ipmBiologicalActions:    row.ipm_biological_actions ?? [],
    chemicalRecommendation:  row.chemical_recommendation,
    followUpDays:            row.follow_up_days,
    escalateToCropsap:       row.escalate_to_cropsap,
    escalationReason:        row.escalation_reason,
    source:                  row.source,
    isGeneric:               row.is_generic,
    prevention:              row.prevention ?? [],
    generatedAt:             row.generated_at,
    createdAt:               row.created_at,
    updatedAt:               row.updated_at,
  };
}

export async function findAdvisoryById(id) {
  const { data, error } = await supabase
    .from('advisories')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return rowToAdvisory(data);
}

export async function findAdvisoryByCase(caseId) {
  const { data, error } = await supabase
    .from('advisories')
    .select('*')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return rowToAdvisory(data);
}

export async function findLatestAdvisoriesForUser(userId, limit = 20) {
  // Join via diagnosis_cases to filter by user_id
  const { data, error } = await supabase
    .from('advisories')
    .select('*, diagnosis_cases!inner(user_id, farm_id, status, final_disease_code)')
    .eq('diagnosis_cases.user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(row => ({
    ...rowToAdvisory(row),
    case: row.diagnosis_cases,
  }));
}

export async function createAdvisory(fields) {
  const { data, error } = await supabase
    .from('advisories')
    .insert({
      case_id:                fields.caseId,
      version:                fields.version ?? 1,
      disease_code:           fields.diseaseCode,
      severity:               fields.severity,
      crop_stage:             fields.cropStage ?? 'vegetative',
      summary:                fields.summary ?? '',
      pathogen_name:          fields.pathogenName ?? '',
      symptoms:               fields.symptoms ?? '',
      remedies:               fields.remedies ?? [],
      ipm_cultural_actions:   fields.ipmCulturalActions ?? [],
      ipm_biological_actions: fields.ipmBiologicalActions ?? [],
      chemical_recommendation: fields.chemicalRecommendation ?? null,
      follow_up_days:         fields.followUpDays ?? null,
      escalate_to_cropsap:    fields.escalateToCropsap ?? false,
      escalation_reason:      fields.escalationReason ?? null,
      source:                 fields.source ?? 'rules',
      is_generic:             fields.isGeneric ?? false,
      prevention:             fields.prevention ?? [],
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToAdvisory(data);
}
