/**
 * backend/src/models/CropBaseline.js
 *
 * Supabase-backed CropBaseline model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class CropBaselineDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.cropType = row.crop_type || row.cropType;
    this.region = row.region || 'global';
    this.ndviP05 = Number(row.ndvi_p05 ?? row.ndviP05 ?? 0.0);
    this.ndviP95 = Number(row.ndvi_p95 ?? row.ndviP95 ?? 0.9);
    this.ndreP05 = Number(row.ndre_p05 ?? row.ndreP05 ?? -0.1);
    this.ndreP95 = Number(row.ndre_p95 ?? row.ndreP95 ?? 0.7);
    this.sampleSize = Number(row.sample_size ?? row.sampleSize ?? 0);
    this.lastRecomputedAt = row.last_recomputed_at || row.lastRecomputedAt || null;
    this.source = row.source || 'default';
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
      crop_type: this.cropType.toLowerCase().trim(),
      region: this.region.toLowerCase().trim(),
      ndvi_p05: this.ndviP05,
      ndvi_p95: this.ndviP95,
      ndre_p05: this.ndreP05,
      ndre_p95: this.ndreP95,
      sample_size: this.sampleSize,
      last_recomputed_at: this.lastRecomputedAt,
      source: this.source,
    };

    const { data, error } = await supabase
      .from('crop_baselines')
      .upsert(record, { onConflict: 'crop_type,region' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new CropBaselineDocument(data);
  }
}

class BaselineQuery {
  constructor(executor) {
    this.executor = executor;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      const res = await this.executor();
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

const CropBaseline = function (fields) {
  return new CropBaselineDocument(fields);
};

CropBaseline.findOne = function (query = {}) {
  return new BaselineQuery(async () => {
    let q = supabase.from('crop_baselines').select('*');
    if (query.cropType) q = q.eq('crop_type', query.cropType.toLowerCase().trim());
    if (query.region) q = q.eq('region', query.region.toLowerCase().trim());

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new CropBaselineDocument(data);
  });
};

CropBaseline.findOneAndUpdate = async function (filter, updates, options = {}) {
  const crop_type = (filter.cropType || updates.cropType).toLowerCase().trim();
  const region = (filter.region || updates.region || 'global').toLowerCase().trim();

  const record = {
    crop_type,
    region,
    ndvi_p05: updates.ndviP05 !== undefined ? updates.ndviP05 : 0.0,
    ndvi_p95: updates.ndviP95 !== undefined ? updates.ndviP95 : 0.9,
    ndre_p05: updates.ndreP05 !== undefined ? updates.ndreP05 : -0.1,
    ndre_p95: updates.ndreP95 !== undefined ? updates.ndreP95 : 0.7,
    sample_size: updates.sampleSize !== undefined ? updates.sampleSize : 0,
    last_recomputed_at: updates.lastRecomputedAt || new Date().toISOString(),
    source: updates.source || 'default',
  };

  const { data, error } = await supabase
    .from('crop_baselines')
    .upsert(record, { onConflict: 'crop_type,region' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new CropBaselineDocument(data);
};

export default CropBaseline;
