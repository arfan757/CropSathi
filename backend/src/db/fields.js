/**
 * backend/src/db/fields.js
 *
 * Data-access layer for the `fields` table.
 * Replaces: src/models/Field.js (Mongoose)
 *
 * Crop-stage inference (from cropStageService) and centroid calculation
 * are kept here, identical to the old Mongoose pre-save hooks.
 */

import supabase           from '../config/supabase.js';
import { inferCropStage } from '../services/cropStageService.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

export function rowToField(row) {
  if (!row) return null;
  return {
    _id:                 row.id,
    id:                  row.id,
    userId:              row.user_id,
    name:                row.name,
    cropType:            row.crop_type,
    cropStage:           row.crop_stage,
    sowingDate:          row.sowing_date,
    polygon:             row.polygon ?? [],
    boundary:            row.boundary ?? null,
    centerLat:           row.center_lat,
    centerLng:           row.center_lng,
    areaInHectares:      row.area_in_hectares,
    areaInAcres:         row.area_in_acres,
    soilType:            row.soil_type,
    status:              row.status,
    isVegetationValid:   row.is_vegetation_valid,
    deletedAt:           row.deleted_at,
    lastWeatherPollAt:   row.last_weather_poll_at,
    lastRiskScoreAt:     row.last_risk_score_at,
    lastPhotoPromptAt:   row.last_photo_prompt_at,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
  };
}

/** Build GeoJSON-style boundary from [{lat,lng}] polygon array */
function buildBoundaryFromPolygon(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const ring = polygon.map(p => [p.lng, p.lat]);
  ring.push(ring[0]); // close the ring
  return { type: 'Polygon', coordinates: [ring] };
}

/** Calculate centroid from polygon */
function calcCentroid(polygon) {
  if (!polygon || polygon.length === 0) return { lat: null, lng: null };
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
  return { lat, lng };
}

/** Convert GeoJSON ring to PostGIS WKT string */
function toWKT(boundary) {
  if (!boundary || !boundary.coordinates) return null;
  const ring = boundary.coordinates[0];
  return `SRID=4326;POLYGON((${ring.map(c => `${c[0]} ${c[1]}`).join(',')}))`;
}

// ─── read ─────────────────────────────────────────────────────────────────────

export async function findFieldsByUser(userId) {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToField);
}

export async function findFieldById(id) {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error || !data) return null;
  return rowToField(data);
}

export async function findActiveFields() {
  const { data, error } = await supabase
    .from('fields')
    .select('*')
    .eq('status', 'active')
    .is('deleted_at', null);

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToField);
}

export async function findFieldsByDistrict(district) {
  // Join via users.farm_details->>'district'
  const { data, error } = await supabase
    .from('fields')
    .select('*, users!inner(farm_details)')
    .is('deleted_at', null)
    .eq('users.farm_details->>district', district);

  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToField);
}

// ─── write ────────────────────────────────────────────────────────────────────

export async function createField({
  userId, name, cropType, sowingDate, polygon,
  areaInHectares = 0, areaInAcres = 0, soilType = 'Other', cropStage,
}) {
  // Replicate Mongoose pre-save hooks: infer stage, compute centroid, build boundary
  let stage = cropStage;
  if (!stage && cropType && sowingDate) {
    stage = inferCropStage(cropType, sowingDate) ?? undefined;
  }

  const { lat, lng }  = calcCentroid(polygon);
  const boundary      = buildBoundaryFromPolygon(polygon);
  const boundaryWkt   = toWKT(boundary);

  const { data, error } = await supabase
    .from('fields')
    .insert({
      user_id:          userId,
      name,
      crop_type:        cropType,
      crop_stage:       stage,
      sowing_date:      sowingDate,
      polygon,
      boundary:         boundaryWkt,
      center_lat:       lat,
      center_lng:       lng,
      area_in_hectares: areaInHectares,
      area_in_acres:    areaInAcres,
      soil_type:        soilType,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToField(data);
}

export async function updateField(id, fields) {
  const patch = {};
  if (fields.name              !== undefined) patch.name              = fields.name;
  if (fields.cropType          !== undefined) patch.crop_type         = fields.cropType;
  if (fields.cropStage         !== undefined) patch.crop_stage        = fields.cropStage;
  if (fields.sowingDate        !== undefined) patch.sowing_date       = fields.sowingDate;
  if (fields.soilType          !== undefined) patch.soil_type         = fields.soilType;
  if (fields.status            !== undefined) patch.status            = fields.status;
  if (fields.isVegetationValid !== undefined) patch.is_vegetation_valid = fields.isVegetationValid;
  if (fields.lastWeatherPollAt !== undefined) patch.last_weather_poll_at = fields.lastWeatherPollAt;
  if (fields.lastRiskScoreAt   !== undefined) patch.last_risk_score_at  = fields.lastRiskScoreAt;
  if (fields.lastPhotoPromptAt !== undefined) patch.last_photo_prompt_at = fields.lastPhotoPromptAt;

  if (fields.polygon !== undefined) {
    patch.polygon   = fields.polygon;
    const boundary  = buildBoundaryFromPolygon(fields.polygon);
    patch.boundary  = toWKT(boundary);
    const c         = calcCentroid(fields.polygon);
    patch.center_lat = c.lat;
    patch.center_lng = c.lng;
  }

  const { data, error } = await supabase
    .from('fields')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToField(data);
}

/** Soft delete: set deleted_at instead of removing the row */
export async function softDeleteField(id) {
  const { data, error } = await supabase
    .from('fields')
    .update({ deleted_at: new Date().toISOString(), status: 'archived' })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return rowToField(data);
}
