/**
 * backend/src/models/Field.js
 *
 * Supabase-backed Field model adapter.
 * Replaces Mongoose model so fieldController, cron jobs, and services
 * read and write from Supabase PostgreSQL seamlessly.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';
import { inferCropStage } from '../services/cropStageService.js';

function buildBoundary(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const ring = polygon.map(p => [p.lng, p.lat]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function calcCentroid(polygon) {
  if (!polygon || polygon.length === 0) return { lat: null, lng: null };
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
  return { lat, lng };
}

function toWkt(boundary) {
  if (!boundary || !boundary.coordinates) return null;
  const ring = boundary.coordinates[0];
  return `SRID=4326;POLYGON((${ring.map(c => `${c[0]} ${c[1]}`).join(',')}))`;
}

export class FieldDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.userId = row.user_id || row.userId;
    this.name = row.name;
    this.cropType = row.crop_type || row.cropType;
    this.variety = row.variety || null;
    this.cropStage = row.crop_stage || row.cropStage;
    this.stageSource = row.stage_source || row.stageSource || (row.crop_stage || row.cropStage ? 'user' : 'inferred');
    this.sowingDate = row.sowing_date || row.sowingDate;
    this.polygon = row.polygon || [];
    this.boundary = row.boundary || buildBoundary(this.polygon);
    this.centerLat = row.center_lat ?? row.centerLat ?? calcCentroid(this.polygon).lat;
    this.centerLng = row.center_lng ?? row.centerLng ?? calcCentroid(this.polygon).lng;
    this.areaInHectares = Number(row.area_in_hectares ?? row.areaInHectares ?? 0);
    this.areaInAcres = Number(row.area_in_acres ?? row.areaInAcres ?? 0);
    this.soilType = row.soil_type || row.soilType || 'Other';
    this.status = row.status || 'active';
    this.isVegetationValid = row.is_vegetation_valid ?? row.isVegetationValid ?? true;
    this.deletedAt = row.deleted_at ?? row.deletedAt ?? null;
    this.lastWeatherPollAt = row.last_weather_poll_at ?? row.lastWeatherPollAt ?? null;
    this.lastRiskScoreAt = row.last_risk_score_at ?? row.lastRiskScoreAt ?? null;
    this.lastPhotoPromptAt = row.last_photo_prompt_at ?? row.lastPhotoPromptAt ?? null;
    this.createdAt = row.created_at || row.createdAt || new Date().toISOString();
    this.updatedAt = row.updated_at || row.updatedAt || new Date().toISOString();

    // Auto-infer crop stage if missing
    if (!this.cropStage && this.cropType && this.sowingDate) {
      const inferred = inferCropStage(this.cropType, this.sowingDate);
      if (inferred) this.cropStage = inferred;
    }
  }

  toObject() {
    return { ...this };
  }

  toJSON() {
    return { ...this };
  }

  async deleteOne() {
    await supabase.from('fields').delete().eq('id', this._id);
    return { acknowledged: true };
  }

  async save() {
    if (!this.cropStage && this.cropType && this.sowingDate) {
      const inferred = inferCropStage(this.cropType, this.sowingDate);
      if (inferred) this.cropStage = inferred;
    }

    const { lat, lng } = calcCentroid(this.polygon);
    this.centerLat = lat;
    this.centerLng = lng;
    this.boundary = buildBoundary(this.polygon);
    const boundaryWkt = toWkt(this.boundary);

    const record = {
      id: this._id,
      user_id: this.userId,
      name: this.name,
      crop_type: this.cropType,
      variety: this.variety,
      crop_stage: this.cropStage,
      stage_source: this.stageSource,
      sowing_date: this.sowingDate,
      polygon: this.polygon,
      boundary: boundaryWkt,
      center_lat: this.centerLat,
      center_lng: this.centerLng,
      area_in_hectares: this.areaInHectares,
      area_in_acres: this.areaInAcres,
      soil_type: this.soilType,
      status: this.status,
      is_vegetation_valid: this.isVegetationValid,
      deleted_at: this.deletedAt,
      last_weather_poll_at: this.lastWeatherPollAt,
      last_risk_score_at: this.lastRiskScoreAt,
      last_photo_prompt_at: this.lastPhotoPromptAt,
    };

    let { data, error } = await supabase
      .from('fields')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error && error.message && error.message.includes("column of 'fields' in the schema cache")) {
      delete record.stage_source;
      delete record.variety;
      const retry = await supabase
        .from('fields')
        .upsert(record, { onConflict: 'id' })
        .select('*')
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw new Error(error.message);
    const doc = new FieldDocument(data);
    doc.variety = this.variety;
    doc.stageSource = this.stageSource;
    return doc;
  }
}

class FieldQuery {
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

const Field = function (fields) {
  return new FieldDocument(fields);
};

Field.find = function (query = {}) {
  return new FieldQuery(async (sort) => {
    let q = supabase.from('fields').select('*');

    const uid = query.userId || query.user_id;
    if (typeof uid === 'string') {
      q = q.eq('user_id', uid);
    } else if (uid?.$in && Array.isArray(uid.$in)) {
      q = q.in('user_id', uid.$in);
    }

    if (query.deletedAt === null) {
      q = q.is('deleted_at', null);
    } else if (query.deletedAt && query.deletedAt.$ne === null) {
      q = q.not('deleted_at', 'is', null);
    }

    if (query.status) q = q.eq('status', query.status);

    if (sort?.createdAt === -1) {
      q = q.order('created_at', { ascending: false });
    } else {
      q = q.order('created_at', { ascending: false });
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(row => new FieldDocument(row));
  });
};

Field.findOne = function (query = {}) {
  return new FieldQuery(async () => {
    let q = supabase.from('fields').select('*');

    const id = query._id || query.id;
    if (id) q = q.eq('id', id);

    if (query.name) q = q.eq('name', query.name);

    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);

    if (query.deletedAt === null) {
      q = q.is('deleted_at', null);
    } else if (query.deletedAt && query.deletedAt.$ne === null) {
      q = q.not('deleted_at', 'is', null);
    }

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new FieldDocument(data);
  });
};

Field.findById = function (id) {
  return Field.findOne({ _id: id, deletedAt: null });
};

Field.findByIdAndUpdate = function (id, updates, options = {}) {
  return Field.findOneAndUpdate({ _id: id }, updates, options);
};

Field.findOneAndUpdate = async function (filter, updates, options = {}) {
  const existing = await Field.findOne(filter);
  if (!existing) return null;

  const patch = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.cropType !== undefined) patch.crop_type = updates.cropType;
  if (updates.cropStage !== undefined) patch.crop_stage = updates.cropStage;
  if (updates.sowingDate !== undefined) patch.sowing_date = updates.sowingDate;
  if (updates.soilType !== undefined) patch.soil_type = updates.soilType;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.areaInHectares !== undefined) patch.area_in_hectares = updates.areaInHectares;
  if (updates.areaInAcres !== undefined) patch.area_in_acres = updates.areaInAcres;
  if (updates.isVegetationValid !== undefined) patch.is_vegetation_valid = updates.isVegetationValid;
  if (updates.deletedAt !== undefined) patch.deleted_at = updates.deletedAt;
  if (updates.lastWeatherPollAt !== undefined) patch.last_weather_poll_at = updates.lastWeatherPollAt;
  if (updates.lastRiskScoreAt !== undefined) patch.last_risk_score_at = updates.lastRiskScoreAt;
  if (updates.lastPhotoPromptAt !== undefined) patch.last_photo_prompt_at = updates.lastPhotoPromptAt;

  if (updates.polygon) {
    patch.polygon = updates.polygon;
    const boundary = buildBoundary(updates.polygon);
    patch.boundary = toWkt(boundary);
    const { lat, lng } = calcCentroid(updates.polygon);
    patch.center_lat = lat;
    patch.center_lng = lng;
  }

  const { data, error } = await supabase
    .from('fields')
    .update(patch)
    .eq('id', existing._id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new FieldDocument(data);
};

Field.countDocuments = async function (query = {}) {
  let q = supabase.from('fields').select('*', { count: 'exact', head: true });
  if (query.deletedAt === null) q = q.is('deleted_at', null);
  if (query.status) q = q.eq('status', query.status);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count || 0;
};

export default Field;
