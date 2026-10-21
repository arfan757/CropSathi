/**
 * backend/src/models/FollowUp.js
 *
 * Supabase-backed FollowUp model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class FollowUpDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.caseId = row.case_id || row.caseId;
    this.advisoryId = row.advisory_id || row.advisoryId;
    this.farmId = row.farm_id || row.farmId || null;
    this.userId = row.user_id || row.userId || null;
    this.scheduledFor = row.scheduled_for || row.scheduledFor || new Date().toISOString();
    this.status = row.status || 'pending';
    this.completedAt = row.completed_at || row.completedAt || null;
    this.notes = row.notes || null;
    this.farmerResponse = row.farmer_response || row.farmerResponse || null;
    this.reminderCount = Number(row.reminder_count ?? row.reminderCount ?? 0);
    this.lastReminderSent = row.last_reminder_sent || row.lastReminderSent || null;
    this.escalatedAt = row.escalated_at || row.escalatedAt || null;
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
      case_id: this.caseId,
      advisory_id: this.advisoryId,
      farm_id: this.farmId,
      user_id: this.userId,
      scheduled_for: this.scheduledFor,
      status: this.status,
      completed_at: this.completedAt,
      notes: this.notes,
      farmer_response: this.farmerResponse,
      reminder_count: this.reminderCount,
      last_reminder_sent: this.lastReminderSent,
      escalated_at: this.escalatedAt,
    };

    const { data, error } = await supabase
      .from('follow_ups')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new FollowUpDocument(data);
  }
}

class FollowUpQuery {
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

const FollowUp = function (fields) {
  return new FollowUpDocument(fields);
};

FollowUp.findOne = function (query = {}) {
  return new FollowUpQuery(async () => {
    let q = supabase.from('follow_ups').select('*');
    const id = query._id || query.id;
    if (id) q = q.eq('id', id);
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);
    if (query.status) q = q.eq('status', query.status);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new FollowUpDocument(data);
  });
};

FollowUp.findById = function (id) {
  return FollowUp.findOne({ _id: id });
};

FollowUp.find = function (query = {}) {
  return new FollowUpQuery(async (sort, limit) => {
    let q = supabase.from('follow_ups').select('*');
    const cid = query.caseId || query.case_id;
    if (cid) q = q.eq('case_id', cid);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);
    if (query.status) q = q.eq('status', query.status);

    if (query.scheduledFor?.$lte) {
      const val = query.scheduledFor.$lte;
      q = q.lte('scheduled_for', val.toISOString ? val.toISOString() : val);
    }

    q = q.order('scheduled_for', { ascending: true });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new FollowUpDocument(r));
  });
};

FollowUp.create = async function (fields) {
  const doc = new FollowUpDocument(fields);
  return doc.save();
};

FollowUp.findByIdAndUpdate = async function (id, updates, options = {}) {
  const existing = await FollowUp.findById(id);
  if (!existing) return null;

  const patch = {};
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.completedAt !== undefined) patch.completed_at = updates.completedAt;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.farmerResponse !== undefined) patch.farmer_response = updates.farmerResponse;
  if (updates.reminderCount !== undefined) patch.reminder_count = updates.reminderCount;
  if (updates.lastReminderSent !== undefined) patch.last_reminder_sent = updates.lastReminderSent;
  if (updates.escalatedAt !== undefined) patch.escalated_at = updates.escalatedAt;

  const { data, error } = await supabase
    .from('follow_ups')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new FollowUpDocument(data);
};

export default FollowUp;
