/**
 * backend/src/models/Reminder.js
 *
 * Supabase-backed Reminder model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class ReminderDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.advisoryId = row.advisory_id || row.advisoryId;
    this.reminderType = row.reminder_type || row.reminderType;
    this.dueAt = row.due_at || row.dueAt || new Date().toISOString();
    this.status = row.status || 'pending';
    this.snoozeCount = Number(row.snooze_count ?? row.snoozeCount ?? 0);
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
      advisory_id: this.advisoryId,
      reminder_type: this.reminderType,
      due_at: this.dueAt,
      status: this.status,
      snooze_count: this.snoozeCount,
    };

    const { data, error } = await supabase
      .from('reminders')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new ReminderDocument(data);
  }
}

class ReminderQuery {
  constructor(executor) {
    this.executor = executor;
    this._sort = null;
    this._limit = null;
    this._populate = [];
  }

  sort(s) {
    this._sort = s;
    return this;
  }

  limit(l) {
    this._limit = l;
    return this;
  }

  populate(p) {
    this._populate.push(p);
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

const Reminder = function (fields) {
  return new ReminderDocument(fields);
};

Reminder.find = function (query = {}) {
  return new ReminderQuery(async (sort, limit) => {
    let q = supabase.from('reminders').select('*');
    const aid = query.advisoryId || query.advisory_id;
    if (aid) q = q.eq('advisory_id', aid);
    if (query.status) q = q.eq('status', query.status);

    if (query.dueAt?.$lte) {
      const val = query.dueAt.$lte;
      q = q.lte('due_at', val.toISOString ? val.toISOString() : val);
    }

    q = q.order('due_at', { ascending: true });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new ReminderDocument(r));
  });
};

Reminder.findOne = function (query = {}) {
  return new ReminderQuery(async () => {
    let q = supabase.from('reminders').select('*');
    const id = query._id || query.id;
    if (id) q = q.eq('id', id);
    const aid = query.advisoryId || query.advisory_id;
    if (aid) q = q.eq('advisory_id', aid);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new ReminderDocument(data);
  });
};

Reminder.findById = function (id) {
  return Reminder.findOne({ _id: id });
};

Reminder.findByIdAndUpdate = async function (id, updates, options = {}) {
  const existing = await Reminder.findById(id);
  if (!existing) return null;

  const patch = {};
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.remindAt !== undefined) patch.remind_at = updates.remindAt;
  if (updates.snoozedUntil !== undefined) patch.snoozed_until = updates.snoozedUntil;
  if (updates.completedAt !== undefined) patch.completed_at = updates.completedAt;
  if (updates.reminderCount !== undefined) patch.reminder_count = updates.reminderCount;

  const { data, error } = await supabase
    .from('reminders')
    .update(patch)
    .eq('id', existing._id)
    .select('*')
    .maybeSingle();

  if (error || !data) return existing;
  return new ReminderDocument(data);
};

Reminder.create = async function (fields) {
  const doc = new ReminderDocument(fields);
  return doc.save();
};

export default Reminder;
