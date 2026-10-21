/**
 * backend/src/db/casePhotos.js
 * Replaces: src/models/CasePhoto.js
 *
 * storageKey is now a Supabase Storage path (bucket: case-photos).
 * storage_url is the full public CDN URL (set after upload).
 */

import supabase from '../config/supabase.js';

export function rowToPhoto(row) {
  if (!row) return null;
  return {
    _id:                       row.id,
    id:                        row.id,
    caseId:                    row.case_id,
    storageKey:                row.storage_key,
    storageUrl:                row.storage_url,
    filename:                  row.filename,
    mimeType:                  row.mime_type,
    fileSize:                  row.file_size,
    isRecapture:               row.is_recapture,
    leafSegmentationApplied:   row.leaf_segmentation_applied,
    uploadedAt:                row.uploaded_at,
    createdAt:                 row.created_at,
  };
}

export async function findPhotosByCase(caseId) {
  const { data, error } = await supabase
    .from('case_photos')
    .select('*')
    .eq('case_id', caseId)
    .order('uploaded_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToPhoto);
}

export async function createPhoto({
  caseId, storageKey, storageUrl, filename,
  mimeType = 'image/jpeg', fileSize = 0,
  isRecapture = false,
}) {
  const { data, error } = await supabase
    .from('case_photos')
    .insert({
      case_id:     caseId,
      storage_key: storageKey,
      storage_url: storageUrl ?? null,
      filename,
      mime_type:   mimeType,
      file_size:   fileSize,
      is_recapture: isRecapture,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToPhoto(data);
}

// ─── Supabase Storage helpers ──────────────────────────────────────────────────

const BUCKET = 'case-photos';

/**
 * Upload a photo buffer to Supabase Storage.
 * Returns { storageKey, storageUrl }.
 */
export async function uploadPhotoToStorage(caseId, filename, buffer, mimeType = 'image/jpeg') {
  const key = `${caseId}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return { storageKey: key, storageUrl: publicUrl };
}

/**
 * Download a photo from Supabase Storage as a Buffer.
 * Used by diagnosisService to read the photo for AI analysis.
 */
export async function downloadPhotoFromStorage(storageKey) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
