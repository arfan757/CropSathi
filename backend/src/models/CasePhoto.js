/**
 * backend/src/models/CasePhoto.js
 *
 * Supabase-backed CasePhoto model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class CasePhotoDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.caseId = row.case_id || row.caseId;
    this.storageKey = row.storage_key || row.storageKey || '';
    this.storageUrl = row.storage_url || row.storageUrl || null;
    this.filename = row.filename || '';
    this.mimeType = row.mime_type || row.mimeType || 'image/jpeg';
    this.fileSize = Number(row.file_size ?? row.fileSize ?? 0);
    this.isRecapture = Boolean(row.is_recapture ?? row.isRecapture ?? false);
    this.leafSegmentationApplied = Boolean(row.leaf_segmentation_applied ?? row.leafSegmentationApplied ?? false);
    this.uploadedAt = row.uploaded_at || row.uploadedAt || new Date().toISOString();
    this.createdAt = row.created_at || row.createdAt || new Date().toISOString();
    this.updatedAt = row.updated_at || row.updatedAt || new Date().toISOString();
  }

  toObject() {
    return { ...this };
  }

  toJSON() {
    return { ...this };
  }

  async save() {
    const record = {
      id: this._id,
      case_id: this.caseId,
      storage_key: this.storageKey,
      storage_url: this.storageUrl,
      filename: this.filename,
      mime_type: this.mimeType,
      file_size: this.fileSize,
      is_recapture: this.isRecapture,
      leaf_segmentation_applied: this.leafSegmentationApplied,
      uploaded_at: this.uploadedAt,
    };

    const { data, error } = await supabase
      .from('case_photos')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new CasePhotoDocument(data);
  }
}

class PhotoQuery {
  constructor(executor) {
    this.executor = executor;
    this._sort = null;
    this._limit = null;
  }

  sort(s) {
    this._sort = s;
    return this;
  }

  limit(l) {
    this._limit = l;
    return this;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      const res = await this.executor(this._sort, this._limit);
      resolve(res);
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  async catch(reject) {
    return this.then(x => x, reject);
  }
}

const CasePhoto = function (fields) {
  return new CasePhotoDocument(fields);
};

CasePhoto.findOne = function (query = {}) {
  return new PhotoQuery(async () => {
    let q = supabase.from('case_photos').select('*');
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);
    q = q.order('uploaded_at', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new CasePhotoDocument(data);
  });
};

CasePhoto.find = function (query = {}) {
  return new PhotoQuery(async (sort, limit) => {
    let q = supabase.from('case_photos').select('*');
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);

    q = q.order('uploaded_at', { ascending: true });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new CasePhotoDocument(r));
  });
};

CasePhoto.create = async function (fields) {
  const doc = new CasePhotoDocument(fields);
  return doc.save();
};

export default CasePhoto;
