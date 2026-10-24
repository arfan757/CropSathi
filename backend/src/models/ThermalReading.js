/**
 * backend/src/models/ThermalReading.js
 *
 * Supabase-backed ThermalReading model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class ThermalReadingDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.observedAt = row.observed_at !== undefined ? row.observed_at : (row.observedAt !== undefined ? row.observedAt : null);
    this.estimatedCanopyTempC = row.estimated_canopy_temp_c !== null && row.estimated_canopy_temp_c !== undefined
      ? Number(row.estimated_canopy_temp_c)
      : (row.estimatedCanopyTempC !== null && row.estimatedCanopyTempC !== undefined ? Number(row.estimatedCanopyTempC) : null);
    this.baselineTempC = row.baseline_temp_c !== null && row.baseline_temp_c !== undefined ? Number(row.baseline_temp_c) : (row.baselineTempC !== undefined ? row.baselineTempC : null);
    this.anomalyC = Number(row.anomaly_c ?? row.anomalyC ?? 0);
    this.resolution = row.resolution || 'farm_simulated';
    this.thermalGrid = row.thermal_grid || row.thermalGrid || null;
    this.sceneSource = row.scene_source || row.sceneSource || 'formula';
    this.sceneId = row.scene_id || row.sceneId || null;
    this.cloudCoverPct = Number(row.cloud_cover_pct ?? row.cloudCoverPct ?? 0);
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
      estimated_canopy_temp_c: this.estimatedCanopyTempC,
      baseline_temp_c: this.baselineTempC,
      anomaly_c: this.anomalyC,
      resolution: this.resolution,
      thermal_grid: this.thermalGrid,
      scene_source: this.sceneSource,
      scene_id: this.sceneId,
      cloud_cover_pct: this.cloudCoverPct,
    };

    const { data, error } = await supabase
      .from('thermal_readings')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new ThermalReadingDocument(data);
  }
}

class ThermalQuery {
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

  select(s) {
    this._select = s;
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

const ThermalReading = function (fields) {
  return new ThermalReadingDocument(fields);
};

ThermalReading.findOne = function (query = {}) {
  return new ThermalQuery(async () => {
    let q = supabase.from('thermal_readings').select('*');
    const id = query._id || query.id;
    if (typeof id === 'string') {
      q = q.eq('id', id);
    } else if (id?.$ne) {
      q = q.neq('id', id.$ne);
    }

    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    if (query.thermalGrid?.$ne === null) q = q.not('thermal_grid', 'is', null);
    q = q.order('observed_at', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new ThermalReadingDocument(data);
  });
};

ThermalReading.findById = function (id) {
  return ThermalReading.findOne({ _id: id });
};

ThermalReading.find = function (query = {}) {
  return new ThermalQuery(async (sort, limit) => {
    let q = supabase.from('thermal_readings').select('*');
    const fid = query.farmId || query.farm_id;
    if (typeof fid === 'string') {
      q = q.eq('farm_id', fid);
    } else if (fid?.$in && Array.isArray(fid.$in)) {
      q = q.in('farm_id', fid.$in);
    }

    if (query.observedAt?.$gte) {
      q = q.gte('observed_at', query.observedAt.$gte.toISOString ? query.observedAt.$gte.toISOString() : query.observedAt.$gte);
    }

    q = q.order('observed_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new ThermalReadingDocument(r));
  });
};

ThermalReading.create = async function (fields) {
  const doc = new ThermalReadingDocument(fields);
  return doc.save();
};

export default ThermalReading;
