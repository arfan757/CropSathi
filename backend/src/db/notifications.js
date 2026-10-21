/**
 * backend/src/db/notifications.js
 * Replaces: src/models/Notification.js
 */

import supabase from '../config/supabase.js';

export function rowToNotification(row) {
  if (!row) return null;
  return {
    _id:         row.id,
    id:          row.id,
    userId:      row.user_id,
    farmId:      row.farm_id,
    caseId:      row.case_id,
    advisoryId:  row.advisory_id,
    followUpId:  row.follow_up_id,
    type:        row.type,
    title:       row.title,
    body:        row.body,
    priority:    row.priority,
    deepLink:    row.deep_link,
    read:        row.read,
    readAt:      row.read_at,
    actionTaken: row.action_taken,
    snoozedUntil: row.snoozed_until,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

export async function findNotificationsByUser(userId, { limit = 50, unreadOnly = false } = {}) {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.eq('read', false);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToNotification);
}

export async function countUnread(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function createNotification(fields) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id:     fields.userId,
      farm_id:     fields.farmId ?? null,
      case_id:     fields.caseId ?? null,
      advisory_id: fields.advisoryId ?? null,
      follow_up_id: fields.followUpId ?? null,
      type:        fields.type,
      title:       fields.title,
      body:        fields.body,
      priority:    fields.priority ?? 'medium',
      deep_link:   fields.deepLink ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToNotification(data);
}

export async function markNotificationRead(id) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToNotification(data);
}

export async function markAllRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw new Error(error.message);
}
