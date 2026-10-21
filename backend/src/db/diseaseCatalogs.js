/**
 * backend/src/db/diseaseCatalogs.js
 * Replaces: src/models/DiseaseCatalog.js
 */

import supabase from '../config/supabase.js';

export function rowToDiseaseCatalog(row) {
  if (!row) return null;
  return {
    _id:            row.id,
    id:             row.id,
    code:           row.code,
    nameEn:         row.name_en,
    nameHi:         row.name_hi,
    nameMr:         row.name_mr,
    cropCode:       row.crop_code,
    pathogenType:   row.pathogen_type,
    severityScale:  row.severity_scale,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

export async function findDiseasesByCrop(cropCode) {
  const { data, error } = await supabase
    .from('disease_catalogs')
    .select('*')
    .eq('crop_code', cropCode.toLowerCase().trim());
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToDiseaseCatalog);
}

export async function findDiseaseByCode(code) {
  const { data, error } = await supabase
    .from('disease_catalogs')
    .select('*')
    .eq('code', code.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return rowToDiseaseCatalog(data);
}

export async function upsertDiseaseCatalog(fields) {
  const { data, error } = await supabase
    .from('disease_catalogs')
    .upsert({
      code:           fields.code.toLowerCase().trim(),
      name_en:        fields.nameEn,
      name_hi:        fields.nameHi ?? '',
      name_mr:        fields.nameMr ?? '',
      crop_code:      fields.cropCode.toLowerCase().trim(),
      pathogen_type:  fields.pathogenType,
      severity_scale: fields.severityScale ?? 'medium',
    }, { onConflict: 'code' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToDiseaseCatalog(data);
}
