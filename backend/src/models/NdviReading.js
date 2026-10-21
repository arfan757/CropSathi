/**
 * backend/src/models/NdviReading.js
 *
 * Supabase-backed NdviReading model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class NdviReadingDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.observedAt = row.observed_at || row.observedAt || new Date().toISOString();
    this.ndvi = Number(row.ndvi ?? 0);
    this.ndre = row.ndre !== null && row.ndre !== undefined ? Number(row.ndre) : null;
    this.cloudCoverPct = Number(row.cloud_cover_pct ?? row.cloudCoverPct ?? 0);
    this.trailingAvgNdvi28d = row.trailing_avg_ndvi_28d !== null && row.trailing_avg_ndvi_28d !== undefined ? Number(row.trailing_avg_ndvi_28d) : null;
    this.anomalyScore = Number(row.anomaly_score ?? row.anomalyScore ?? 0);
    this.pixelCountPureCrop = row.pixel_count_pure_crop !== null && row.pixel_count_pure_crop !== undefined ? Number(row.pixel_count_pure_crop) : null;
    this.ndviGrid = row.ndvi_grid || row.ndviGrid || null;
    this.ndreGrid = row.ndre_grid || row.ndreGrid || null;
    this.sceneSource = row.scene_source || row.sceneSource || 'simulated';
    this.sceneId = row.scene_id || row.sceneId || null;
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
      observed_at: this.observedAt,
      ndvi: this.ndvi,
      ndre: this.ndre,
      cloud_cover_pct: this.cloudCoverPct,
      trailing_avg_ndvi_28d: this.trailingAvgNdvi28d,
      anomaly_score: this.anomalyScore,
      pixel_count_pure_crop: this.pixelCountPureCrop,
      ndvi_grid: this.ndviGrid,
      ndre_grid: this.ndreGrid,
      scene_source: this.sceneSource,
      scene_id: this.sceneId,
    };

    const { data, error } = await supabase
      .from('ndvi_readings')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new NdviReadingDocument(data);
  }
}

class NdviQuery {
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

const NdviReading = function (fields) {
  return new NdviReadingDocument(fields);
};

NdviReading.findOne = function (query = {}) {
  return new NdviQuery(async () => {
    let q = supabase.from('ndvi_readings').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    q = q.order('observed_at', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new NdviReadingDocument(data);
  });
};

NdviReading.find = function (query = {}) {
  return new NdviQuery(async (sort, limit) => {
    let q = supabase.from('ndvi_readings').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);

    if (query.observedAt?.$gte) {
      q = q.gte('observed_at', query.observedAt.$gte.toISOString ? query.observedAt.$gte.toISOString() : query.observedAt.$gte);
    }

    q = q.order('observed_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new NdviReadingDocument(r));
  });
};

NdviReading.create = async function (fields) {
  const doc = new NdviReadingDocument(fields);
  return doc.save();
};

NdviReading.deleteMany = async function (query = {}) {
  let q = supabase.from('ndvi_readings').delete();
  const fid = query.farmId || query.farm_id;
  if (fid) q = q.eq('farm_id', fid);
  const { error } = await q;
  if (error) throw new Error(error.message);
  return { acknowledged: true };
};

export default NdviReading;
