/**
 * backend/src/models/WeatherReading.js
 *
 * Supabase-backed WeatherReading model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class WeatherReadingDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.source = row.source || 'open_meteo';
    this.observedAt = row.observed_at || row.observedAt || new Date().toISOString();
    this.temperatureC = row.temperature_c !== null && row.temperature_c !== undefined ? Number(row.temperature_c) : (row.temperatureC !== undefined ? row.temperatureC : null);
    this.humidityPct = row.humidity_pct !== null && row.humidity_pct !== undefined ? Number(row.humidity_pct) : (row.humidityPct !== undefined ? row.humidityPct : null);
    this.rainfallMm24h = Number(row.rainfall_mm_24h ?? row.rainfallMm24h ?? 0);
    this.windSpeedMs = Number(row.wind_speed_ms ?? row.windSpeedMs ?? 0);
    this.soilTempC = row.soil_temp_c !== null && row.soil_temp_c !== undefined ? Number(row.soil_temp_c) : (row.soilTempC !== undefined ? row.soilTempC : null);
    this.rawPayload = row.raw_payload || row.rawPayload || null;
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
      source: this.source,
      observed_at: this.observedAt,
      temperature_c: this.temperatureC,
      humidity_pct: this.humidityPct,
      rainfall_mm_24h: this.rainfallMm24h,
      wind_speed_ms: this.windSpeedMs,
      soil_temp_c: this.soilTempC,
      raw_payload: this.rawPayload,
    };

    const { data, error } = await supabase
      .from('weather_readings')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      // If table doesn't exist yet, warn gracefully without crashing
      console.warn('weather_readings save warning:', error.message);
      return this;
    }
    return new WeatherReadingDocument(data);
  }
}

class WeatherQuery {
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

const WeatherReading = function (fields) {
  return new WeatherReadingDocument(fields);
};

WeatherReading.findOne = function (query = {}) {
  return new WeatherQuery(async () => {
    let q = supabase.from('weather_readings').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    q = q.order('observed_at', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new WeatherReadingDocument(data);
  });
};

WeatherReading.find = function (query = {}) {
  return new WeatherQuery(async (sort, limit) => {
    let q = supabase.from('weather_readings').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);

    q = q.order('observed_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) {
      console.warn('weather_readings find warning:', error.message);
      return [];
    }
    return (data || []).map(r => new WeatherReadingDocument(r));
  });
};

WeatherReading.create = async function (fields) {
  const doc = new WeatherReadingDocument(fields);
  return doc.save();
};

export default WeatherReading;
