/**
 * backend/src/models/DiagnosisCase.js
 *
 * Supabase-backed DiagnosisCase model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class DiagnosisCaseDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.userId = row.user_id || row.userId;
    this.triggeredBy = row.triggered_by || row.triggeredBy || 'farmer_initiated';
    this.triggeringRiskScoreId = row.triggering_risk_score_id || row.triggeringRiskScoreId || null;
    this.status = row.status || 'awaiting_photo';
    this.geminiResult = row.gemini_result || row.geminiResult || {};
    this.finalDiseaseCode = row.final_disease_code || row.finalDiseaseCode || null;
    this.finalSeverity = row.final_severity || row.finalSeverity || null;
    this.confidence = row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : null;
    this.outcome = row.outcome || null;
    this.requiresExpertReview = Boolean(row.requires_expert_review ?? row.requiresExpertReview ?? false);
    this.gpsPoint = row.gps_lat !== undefined && row.gps_lat !== null ? { lat: row.gps_lat, lng: row.gps_lng } : (row.gpsPoint || { lat: null, lng: null });
    this.capturedAt = row.captured_at || row.capturedAt || new Date().toISOString();
    this.deletedAt = row.deleted_at ?? row.deletedAt ?? null;
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
      farm_id: this.farmId,
      user_id: this.userId,
      triggered_by: this.triggeredBy,
      triggering_risk_score_id: this.triggeringRiskScoreId,
      status: this.status,
      gemini_result: this.geminiResult,
      final_disease_code: this.finalDiseaseCode,
      final_severity: this.finalSeverity,
      confidence: this.confidence,
      outcome: this.outcome,
      requires_expert_review: this.requiresExpertReview,
      gps_lat: this.gpsPoint?.lat ?? null,
      gps_lng: this.gpsPoint?.lng ?? null,
      captured_at: this.capturedAt,
      deleted_at: this.deletedAt,
    };

    const { data, error } = await supabase
      .from('diagnosis_cases')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new DiagnosisCaseDocument(data);
  }
}

class CaseQuery {
  constructor(executor) {
    this.executor = executor;
    this._sort = null;
    this._limit = null;
    this._populateFields = [];
  }

  sort(s) {
    this._sort = s;
    return this;
  }

  limit(l) {
    this._limit = l;
    return this;
  }

  populate(p) {
    this._populateFields.push(p);
    return this;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      const res = await this.executor(this._sort, this._limit, this._populateFields);
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

const DiagnosisCase = function (fields) {
  return new DiagnosisCaseDocument(fields);
};

DiagnosisCase.findById = function (id) {
  return new CaseQuery(async () => {
    const { data, error } = await supabase
      .from('diagnosis_cases')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return new DiagnosisCaseDocument(data);
  });
};

DiagnosisCase.findOne = function (query = {}) {
  return new CaseQuery(async () => {
    let q = supabase.from('diagnosis_cases').select('*');
    const id = query._id || query.id;
    if (id) q = q.eq('id', id);
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);
    if (typeof query.status === 'string') {
      q = q.eq('status', query.status);
    } else if (query.status?.$ne) {
      q = q.neq('status', query.status.$ne);
    } else if (query.status?.$in && Array.isArray(query.status.$in)) {
      q = q.in('status', query.status.$in);
    }
    if (query.deletedAt === null) {
      q = q.is('deleted_at', null);
    }

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new DiagnosisCaseDocument(data);
  });
};

DiagnosisCase.find = function (query = {}) {
  return new CaseQuery(async (sort, limit) => {
    let q = supabase.from('diagnosis_cases').select('*');
    const id = query._id || query.id;
    if (typeof id === 'string') q = q.eq('id', id);
    if (query._id?.$lt) q = q.lt('id', query._id.$lt);
    if (query.id?.$lt) q = q.lt('id', query.id.$lt);

    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);

    if (typeof query.status === 'string') {
      q = q.eq('status', query.status);
    } else if (query.status?.$ne) {
      q = q.neq('status', query.status.$ne);
    } else if (query.status?.$in && Array.isArray(query.status.$in)) {
      q = q.in('status', query.status.$in);
    }

    if (query.deletedAt === null) {
      q = q.is('deleted_at', null);
    }

    if (query.createdAt?.$gte) {
      q = q.gte('created_at', query.createdAt.$gte.toISOString ? query.createdAt.$gte.toISOString() : query.createdAt.$gte);
    }

    q = q.order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new DiagnosisCaseDocument(r));
  });
};

DiagnosisCase.countDocuments = async function (query = {}) {
  try {
    let q = supabase.from('diagnosis_cases').select('*', { count: 'exact', head: true });
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);
    if (query.createdAt?.$gte) {
      q = q.gte('created_at', query.createdAt.$gte.toISOString ? query.createdAt.$gte.toISOString() : query.createdAt.$gte);
    }
    const { count, error } = await q;
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
};

DiagnosisCase.create = async function (fields) {
  const doc = new DiagnosisCaseDocument(fields);
  return doc.save();
};

DiagnosisCase.updateOne = async function (filter, updates) {
  const id = filter._id || filter.id;
  if (!id) return null;
  const patch = updates.$set || updates;
  return DiagnosisCase.findByIdAndUpdate(id, patch);
};

DiagnosisCase.findByIdAndUpdate = async function (id, updates, options = {}) {
  const existing = await DiagnosisCase.findById(id);
  if (!existing) return null;

  const patch = {};
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.geminiResult !== undefined) patch.gemini_result = updates.geminiResult;
  if (updates.finalDiseaseCode !== undefined) patch.final_disease_code = updates.finalDiseaseCode;
  if (updates.finalSeverity !== undefined) patch.final_severity = updates.finalSeverity;
  if (updates.confidence !== undefined) patch.confidence = updates.confidence;
  if (updates.outcome !== undefined) patch.outcome = updates.outcome;
  if (updates.requiresExpertReview !== undefined) patch.requires_expert_review = updates.requiresExpertReview;
  if (updates.deletedAt !== undefined) patch.deleted_at = updates.deletedAt;
  if (updates.gpsPoint?.lat !== undefined) patch.gps_lat = updates.gpsPoint.lat;
  if (updates.gpsPoint?.lng !== undefined) patch.gps_lng = updates.gpsPoint.lng;

  const { data, error } = await supabase
    .from('diagnosis_cases')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new DiagnosisCaseDocument(data);
};

export default DiagnosisCase;
