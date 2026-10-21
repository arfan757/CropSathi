/**
 * backend/src/db/cropCatalogs.js
 * Replaces: src/models/CropCatalog.js
 */

import supabase from '../config/supabase.js';

export function rowToCropCatalog(row) {
  if (!row) return null;
  return {
    _id:                  row.id,
    id:                   row.id,
    code:                 row.code,
    nameEn:               row.name_en,
    nameHi:               row.name_hi,
    nameMr:               row.name_mr,
    typicalSowingWindow:  row.typical_sowing_window ?? {},
    priorityMaharashtra:  row.priority_maharashtra,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  };
}

export async function findAllCrops() {
  const { data, error } = await supabase
    .from('crop_catalogs')
    .select('*')
    .order('name_en', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToCropCatalog);
}

export async function findCropByCode(code) {
  const { data, error } = await supabase
    .from('crop_catalogs')
    .select('*')
    .eq('code', code.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return rowToCropCatalog(data);
}

export async function upsertCropCatalog(fields) {
  const { data, error } = await supabase
    .from('crop_catalogs')
    .upsert({
      code:                  fields.code.toLowerCase().trim(),
      name_en:               fields.nameEn,
      name_hi:               fields.nameHi ?? '',
      name_mr:               fields.nameMr ?? '',
      typical_sowing_window:  fields.typicalSowingWindow ?? {},
      priority_maharashtra:  fields.priorityMaharashtra ?? false,
    }, { onConflict: 'code' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToCropCatalog(data);
}
