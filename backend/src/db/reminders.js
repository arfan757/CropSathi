/**
 * backend/src/db/reminders.js
 * Replaces: src/models/Reminder.js
 */

import supabase from '../config/supabase.js';

export function rowToReminder(row) {
  if (!row) return null;
  return {
    _id:          row.id,
    id:           row.id,
    advisoryId:   row.advisory_id,
    reminderType: row.reminder_type,
    dueAt:        row.due_at,
    status:       row.status,
    snoozeCount:  row.snooze_count,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

export async function findPendingReminders() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToReminder);
}

export async function findRemindersByAdvisory(advisoryId) {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('advisory_id', advisoryId)
    .order('due_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToReminder);
}

export async function createReminder(fields) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      advisory_id:   fields.advisoryId,
      reminder_type: fields.reminderType,
      due_at:        fields.dueAt,
      status:        fields.status ?? 'pending',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToReminder(data);
}

export async function updateReminder(id, fields) {
  const patch = {};
  if (fields.status       !== undefined) patch.status        = fields.status;
  if (fields.snoozeCount  !== undefined) patch.snooze_count  = fields.snoozeCount;

  const { data, error } = await supabase
    .from('reminders')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToReminder(data);
}
