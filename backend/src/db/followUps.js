/**
 * backend/src/db/followUps.js
 * Replaces: src/models/FollowUp.js
 */

import supabase from '../config/supabase.js';

export function rowToFollowUp(row) {
  if (!row) return null;
  return {
    _id:               row.id,
    id:                row.id,
    caseId:            row.case_id,
    advisoryId:        row.advisory_id,
    farmId:            row.farm_id,
    userId:            row.user_id,
    scheduledFor:      row.scheduled_for,
    status:            row.status,
    completedAt:       row.completed_at,
    notes:             row.notes,
    farmerResponse:    row.farmer_response,
    reminderCount:     row.reminder_count,
    lastReminderSent:  row.last_reminder_sent,
    escalatedAt:       row.escalated_at,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

export async function findFollowUpById(id) {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return rowToFollowUp(data);
}

export async function findFollowUpsByUser(userId, { status } = {}) {
  let query = supabase
    .from('follow_ups')
    .select('*')
    .eq('user_id', userId)
    .order('scheduled_for', { ascending: true });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToFollowUp);
}

export async function findPendingFollowUps() {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToFollowUp);
}

export async function createFollowUp(fields) {
  const { data, error } = await supabase
    .from('follow_ups')
    .insert({
      case_id:       fields.caseId,
      advisory_id:   fields.advisoryId,
      farm_id:       fields.farmId ?? null,
      user_id:       fields.userId ?? null,
      scheduled_for: fields.scheduledFor,
      status:        fields.status ?? 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToFollowUp(data);
}

export async function updateFollowUp(id, fields) {
  const patch = {};
  if (fields.status           !== undefined) patch.status            = fields.status;
  if (fields.completedAt      !== undefined) patch.completed_at      = fields.completedAt;
  if (fields.notes            !== undefined) patch.notes             = fields.notes;
  if (fields.farmerResponse   !== undefined) patch.farmer_response   = fields.farmerResponse;
  if (fields.reminderCount    !== undefined) patch.reminder_count    = fields.reminderCount;
  if (fields.lastReminderSent !== undefined) patch.last_reminder_sent = fields.lastReminderSent;
  if (fields.escalatedAt      !== undefined) patch.escalated_at      = fields.escalatedAt;

  const { data, error } = await supabase
    .from('follow_ups')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToFollowUp(data);
}
