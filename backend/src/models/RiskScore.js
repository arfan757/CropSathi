/**
 * backend/src/models/RiskScore.js
 *
 * Supabase-backed RiskScore model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class RiskScoreDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.computedAt = row.computed_at || row.computedAt || new Date().toISOString();
    this.weatherComponent = Number(row.weather_component ?? row.weatherComponent ?? 0);
    this.ndviComponent = Number(row.ndvi_component ?? row.ndviComponent ?? 0.5);
    this.ndreComponent = Number(row.ndre_component ?? row.ndreComponent ?? 0);
    this.thermalComponent = Number(row.thermal_component ?? row.thermalComponent ?? 0.5);
    this.pestHistoryComponent = Number(row.pest_history_component ?? row.pestHistoryComponent ?? 0);
    this.compositeScore = row.composite_score !== null && row.composite_score !== undefined ? Number(row.composite_score) : (row.compositeScore !== undefined ? row.compositeScore : null);
    this.healthLevel = row.health_level || row.healthLevel || null;
    this.staleSignals = row.stale_signals || row.staleSignals || [];
    this.weightsUsed = row.weights_used || row.weightsUsed || null;
    this.triggeredAlert = Boolean(row.triggered_alert ?? row.triggeredAlert ?? false);
    this.diseaseHypothesis = row.disease_hypothesis || row.diseaseHypothesis || null;
    this.matchedWeatherRules = row.matched_weather_rules || row.matchedWeatherRules || [];
    this.thresholdUsed = Number(row.threshold_used ?? row.thresholdUsed ?? 0.6);
    this.inputsSnapshot = row.inputs_snapshot || row.inputsSnapshot || null;
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
      computed_at: this.computedAt,
      weather_component: this.weatherComponent,
      ndvi_component: this.ndviComponent,
      ndre_component: this.ndreComponent,
      thermal_component: this.thermalComponent,
      pest_history_component: this.pestHistoryComponent,
      composite_score: this.compositeScore,
      health_level: this.healthLevel,
      stale_signals: this.staleSignals,
      weights_used: this.weightsUsed,
      triggered_alert: this.triggeredAlert,
      disease_hypothesis: this.diseaseHypothesis,
      matched_weather_rules: this.matchedWeatherRules,
      threshold_used: this.thresholdUsed,
      inputs_snapshot: this.inputsSnapshot,
    };

    const { data, error } = await supabase
      .from('risk_scores')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new RiskScoreDocument(data);
  }
}

class RiskScoreQuery {
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

const RiskScore = function (fields) {
  return new RiskScoreDocument(fields);
};

RiskScore.findOne = function (query = {}) {
  return new RiskScoreQuery(async () => {
    let q = supabase.from('risk_scores').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);
    q = q.order('computed_at', { ascending: false }).limit(1);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new RiskScoreDocument(data);
  });
};

RiskScore.find = function (query = {}) {
  return new RiskScoreQuery(async (sort, limit) => {
    let q = supabase.from('risk_scores').select('*');
    const fid = query.farmId || query.farm_id;
    if (fid) q = q.eq('farm_id', fid);

    if (query.computedAt?.$gte) {
      q = q.gte('computed_at', query.computedAt.$gte.toISOString ? query.computedAt.$gte.toISOString() : query.computedAt.$gte);
    }

    q = q.order('computed_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new RiskScoreDocument(r));
  });
};

RiskScore.create = async function (fields) {
  const doc = new RiskScoreDocument(fields);
  return doc.save();
};

export default RiskScore;
