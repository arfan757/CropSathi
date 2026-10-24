/**
 * backend/src/models/RiskScore.js
 *
 * Supabase-backed RiskScore model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class RiskScoreDocument {
  constructor(row = {}) {
    const parseStress = (val) => (val !== null && val !== undefined ? Number(val) : null);

    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.farmId = row.farm_id || row.farmId;
    this.computedAt = row.computed_at || row.computedAt || new Date().toISOString();
    this.weatherComponent = Number(row.weather_component ?? row.weatherComponent ?? 0);

    // Stored component fields with 0-1 stress semantics (F-07, F-20)
    this.ndviStress = parseStress(row.ndvi_stress ?? row.ndviStress ?? row.ndvi_component ?? row.ndviComponent);
    this.ndreStress = parseStress(row.ndre_stress ?? row.ndreStress ?? row.ndre_component ?? row.ndreComponent);
    this.thermalStress = parseStress(row.thermal_stress ?? row.thermalStress ?? row.thermal_component ?? row.thermalComponent);

    // Read-compat layer: old documents / consumers accessing component names get the stress values
    this.ndviComponent = this.ndviStress;
    this.ndreComponent = this.ndreStress;
    this.thermalComponent = this.thermalStress;

    this.pestHistoryComponent = Number(row.pest_history_component ?? row.pestHistoryComponent ?? 0);
    this.compositeScore = row.composite_score !== null && row.composite_score !== undefined ? Number(row.composite_score) : (row.compositeScore !== undefined ? row.compositeScore : null);
    this.healthLevel = row.health_level || row.healthLevel || null;
    this.staleSignals = row.stale_signals || row.staleSignals || [];
    this.weightsUsed = row.weights_used || row.weightsUsed || null;
    this.triggeredAlert = Boolean(row.triggered_alert ?? row.triggeredAlert ?? false);
    // F-04: weatherRiskHypothesis rename with diseaseHypothesis read-compat shim
    this.weatherRiskHypothesis = row.weather_risk_hypothesis || row.weatherRiskHypothesis || row.disease_hypothesis || row.diseaseHypothesis || null;
    this.diseaseHypothesis = this.weatherRiskHypothesis;
    this.matchedWeatherRules = row.matched_weather_rules || row.matchedWeatherRules || [];

    // F-14: Persisted threshold and scoring metadata
    this.thresholdUsed = Number(row.threshold_used ?? row.thresholdUsed ?? 0.6);
    this.growthScenario = row.growth_scenario || row.growthScenario || row.inputs_snapshot?.growthScenario || row.inputsSnapshot?.growthScenario || 'balanced';
    this.cropStage = row.crop_stage || row.cropStage || row.inputs_snapshot?.cropStage || row.inputsSnapshot?.cropStage || null;
    this.stageSource = row.stage_source || row.stageSource || row.inputs_snapshot?.stageSource || row.inputsSnapshot?.stageSource || 'default';
    this.calibrationVersion = row.calibration_version || row.calibrationVersion || 'v1.0.0-literature_seed';
    this.calibrationStatus = row.calibration_status || row.calibrationStatus || 'literature_seed';

    // Phase 3: Confidence Model & Metadata
    this.confidence = row.confidence || row.inputs_snapshot?.confidence || 'low';
    this.confidenceReasons = row.confidence_reasons || row.confidenceReasons || row.inputs_snapshot?.confidenceReasons || [];
    this.cloudCoverPct = row.cloud_cover_pct !== null && row.cloud_cover_pct !== undefined
      ? Number(row.cloud_cover_pct)
      : (row.cloudCoverPct !== undefined ? Number(row.cloudCoverPct) : (row.inputs_snapshot?.cloudCoverPct ?? row.inputsSnapshot?.cloudCoverPct ?? null));
    this.sceneAgeDays = row.scene_age_days !== null && row.scene_age_days !== undefined
      ? Number(row.scene_age_days)
      : (row.sceneAgeDays !== undefined ? Number(row.sceneAgeDays) : (row.inputs_snapshot?.sceneAgeDays ?? row.inputsSnapshot?.sceneAgeDays ?? null));

    // F-07: Top-level noVegetationDetected boolean
    this.noVegetationDetected = Boolean(
      row.no_vegetation_detected ??
      row.noVegetationDetected ??
      row.inputs_snapshot?.noVegetationDetected ??
      row.inputsSnapshot?.noVegetationDetected ??
      false
    );

    this.sceneSource = row.scene_source || row.sceneSource || row.inputs_snapshot?.sceneSource || row.inputs_snapshot?.dataSources?.ndvi || 'unknown';
    this.isSimulated = Boolean(row.is_simulated ?? row.isSimulated ?? row.inputs_snapshot?.isSimulated ?? false);
    this.inputsSnapshot = row.inputs_snapshot || row.inputsSnapshot || null;
    this.createdAt = row.created_at || row.createdAt || new Date().toISOString();
    this.updatedAt = row.updated_at || row.updatedAt || new Date().toISOString();
  }

  get score() {
    return this.compositeScore;
  }

  get level() {
    return this.healthLevel;
  }

  get hasData() {
    return this.compositeScore !== null || this.noVegetationDetected;
  }

  toObject() {
    return { ...this };
  }

  toJSON() {
    return { ...this };
  }

  async save() {
    const inputsSnapshot = {
      ...(this.inputsSnapshot || {}),
      growthScenario: this.growthScenario,
      cropStage: this.cropStage,
      stageSource: this.stageSource,
      calibrationVersion: this.calibrationVersion,
      calibrationStatus: this.calibrationStatus,
      confidence: this.confidence,
      confidenceReasons: this.confidenceReasons,
      cloudCoverPct: this.cloudCoverPct,
      sceneAgeDays: this.sceneAgeDays,
      noVegetationDetected: this.noVegetationDetected,
      sceneSource: this.sceneSource,
      isSimulated: this.isSimulated,
      ndviStress: this.ndviStress,
      ndreStress: this.ndreStress,
      thermalStress: this.thermalStress,
      weatherRiskHypothesis: this.weatherRiskHypothesis,
    };

    const fullRecord = {
      id: this._id,
      farm_id: this.farmId,
      computed_at: this.computedAt,
      weather_component: this.weatherComponent,
      ndvi_stress: this.ndviStress,
      ndre_stress: this.ndreStress,
      thermal_stress: this.thermalStress,
      ndvi_component: this.ndviComponent,
      ndre_component: this.ndreComponent,
      thermal_component: this.thermalComponent,
      pest_history_component: this.pestHistoryComponent,
      composite_score: this.compositeScore,
      health_level: this.healthLevel,
      stale_signals: this.staleSignals,
      weights_used: this.weightsUsed,
      triggered_alert: this.triggeredAlert,
      weather_risk_hypothesis: this.weatherRiskHypothesis,
      disease_hypothesis: this.diseaseHypothesis,
      matched_weather_rules: this.matchedWeatherRules,
      threshold_used: this.thresholdUsed,
      growth_scenario: this.growthScenario,
      crop_stage: this.cropStage,
      stage_source: this.stageSource,
      calibration_version: this.calibrationVersion,
      calibration_status: this.calibrationStatus,
      confidence: this.confidence,
      confidence_reasons: this.confidenceReasons,
      cloud_cover_pct: this.cloudCoverPct,
      scene_age_days: this.sceneAgeDays,
      no_vegetation_detected: this.noVegetationDetected,
      scene_source: this.sceneSource,
      is_simulated: this.isSimulated,
      inputs_snapshot: inputsSnapshot,
    };

    let { data, error } = await supabase
      .from('risk_scores')
      .upsert(fullRecord, { onConflict: 'id' })
      .select('*')
      .single();

    if (error && error.message && error.message.includes('column of \'risk_scores\' in the schema cache')) {
      const baseRecord = {
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
        inputs_snapshot: inputsSnapshot,
      };

      const retryRes = await supabase
        .from('risk_scores')
        .upsert(baseRecord, { onConflict: 'id' })
        .select('*')
        .single();

      if (retryRes.error) throw new Error(retryRes.error.message);
      data = retryRes.data;
      error = null;
    }

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

RiskScore.aggregate = async function (pipeline = []) {
  const matchStage = pipeline.find(p => p.$match);
  const farmIds = matchStage?.$match?.farmId?.$in || [];
  const excludeIds = matchStage?.$match?._id?.$nin || [];

  if (farmIds.length === 0) return [];

  let q = supabase
    .from('risk_scores')
    .select('*')
    .in('farm_id', farmIds)
    .order('computed_at', { ascending: false });

  if (excludeIds.length > 0) {
    for (const exId of excludeIds) {
      q = q.neq('id', exId);
    }
  }

  const { data, error } = await q;
  if (error || !data) return [];

  const map = new Map();
  for (const row of data) {
    if (!map.has(row.farm_id)) {
      map.set(row.farm_id, {
        _id: row.farm_id,
        doc: new RiskScoreDocument(row).toObject(),
      });
    }
  }

  return Array.from(map.values());
};

export default RiskScore;
