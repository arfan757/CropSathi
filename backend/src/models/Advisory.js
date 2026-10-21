/**
 * backend/src/models/Advisory.js
 *
 * Supabase-backed Advisory model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class AdvisoryDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.caseId = row.case_id || row.caseId;
    this.version = Number(row.version ?? 1);
    this.diseaseCode = row.disease_code || row.diseaseCode;
    this.severity = row.severity;
    this.cropStage = row.crop_stage || row.cropStage || 'vegetative';
    this.summary = row.summary || '';
    this.pathogenName = row.pathogen_name || row.pathogenName || '';
    this.symptoms = row.symptoms || '';
    this.remedies = row.remedies || [];
    this.ipmCulturalActions = row.ipm_cultural_actions || row.ipmCulturalActions || [];
    this.ipmBiologicalActions = row.ipm_biological_actions || row.ipmBiologicalActions || [];
    this.chemicalRecommendation = row.chemical_recommendation || row.chemicalRecommendation || null;
    this.followUpDays = row.follow_up_days !== null && row.follow_up_days !== undefined ? Number(row.follow_up_days) : (row.followUpDays !== undefined ? row.followUpDays : null);
    this.escalateToCropsap = Boolean(row.escalate_to_cropsap ?? row.escalateToCropsap ?? false);
    this.escalationReason = row.escalation_reason || row.escalationReason || null;
    this.source = row.source || 'rules';
    this.isGeneric = Boolean(row.is_generic ?? row.isGeneric ?? false);
    this.prevention = row.prevention || [];
    this.generatedAt = row.generated_at || row.generatedAt || new Date().toISOString();
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
      version: this.version,
      disease_code: this.diseaseCode,
      severity: this.severity,
      crop_stage: this.cropStage,
      summary: this.summary,
      pathogen_name: this.pathogenName,
      symptoms: this.symptoms,
      remedies: this.remedies,
      ipm_cultural_actions: this.ipmCulturalActions,
      ipm_biological_actions: this.ipmBiologicalActions,
      chemical_recommendation: this.chemicalRecommendation,
      follow_up_days: this.followUpDays,
      escalate_to_cropsap: this.escalateToCropsap,
      escalation_reason: this.escalationReason,
      source: this.source,
      is_generic: this.isGeneric,
      prevention: this.prevention,
      generated_at: this.generatedAt,
    };

    const { data, error } = await supabase
      .from('advisories')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new AdvisoryDocument(data);
  }
}

class AdvisoryQuery {
  constructor(executor) {
    this.executor = executor;
    this._sort = null;
    this._limit = null;
    this._populate = [];
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
    this._populate.push(p);
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

const Advisory = function (fields) {
  return new AdvisoryDocument(fields);
};

Advisory.findOne = function (query = {}) {
  return new AdvisoryQuery(async () => {
    let q = supabase.from('advisories').select('*');
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);
    const id = query._id || query.id;
    if (id) q = q.eq('id', id);

    q = q.order('version', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new AdvisoryDocument(data);
  });
};

Advisory.findById = function (id) {
  return Advisory.findOne({ _id: id });
};

Advisory.find = function (query = {}) {
  return new AdvisoryQuery(async (sort, limit) => {
    let q = supabase.from('advisories').select('*');
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);

    q = q.order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new AdvisoryDocument(r));
  });
};

Advisory.create = async function (fields) {
  const doc = new AdvisoryDocument(fields);
  return doc.save();
};

export default Advisory;
