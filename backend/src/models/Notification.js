/**
 * backend/src/models/Notification.js
 *
 * Supabase-backed Notification model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class NotificationDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.userId = row.user_id || row.userId;
    this.farmId = row.farm_id || row.farmId || null;
    this.caseId = row.case_id || row.caseId || null;
    this.advisoryId = row.advisory_id || row.advisoryId || null;
    this.followUpId = row.follow_up_id || row.followUpId || null;
    this.type = row.type;
    this.title = row.title;
    this.body = row.body;
    this.priority = row.priority || 'medium';
    this.deepLink = row.deep_link || row.deepLink || null;
    this.read = Boolean(row.read ?? false);
    this.readAt = row.read_at || row.readAt || null;
    this.actionTaken = row.action_taken || row.actionTaken || null;
    this.snoozedUntil = row.snoozed_until || row.snoozedUntil || null;
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
      user_id: this.userId,
      farm_id: this.farmId,
      case_id: this.caseId,
      advisory_id: this.advisoryId,
      follow_up_id: this.followUpId,
      type: this.type,
      title: this.title,
      body: this.body,
      priority: this.priority,
      deep_link: this.deepLink,
      read: this.read,
      read_at: this.readAt,
      action_taken: this.actionTaken,
      snoozed_until: this.snoozedUntil,
    };

    const { data, error } = await supabase
      .from('notifications')
      .upsert(record, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new NotificationDocument(data);
  }
}

class NotificationQuery {
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

const Notification = function (fields) {
  return new NotificationDocument(fields);
};

Notification.find = function (query = {}) {
  return new NotificationQuery(async (sort, limit) => {
    let q = supabase.from('notifications').select('*');
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);
    if (query.read !== undefined) q = q.eq('read', query.read);

    q = q.order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new NotificationDocument(r));
  });
};

Notification.findOne = function (query = {}) {
  return new NotificationQuery(async () => {
    let q = supabase.from('notifications').select('*');
    const id = query._id || query.id;
    if (id) q = q.eq('id', id);
    const uid = query.userId || query.user_id;
    if (uid) q = q.eq('user_id', uid);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new NotificationDocument(data);
  });
};

Notification.findById = function (id) {
  return Notification.findOne({ _id: id });
};

Notification.countDocuments = async function (query = {}) {
  let q = supabase.from('notifications').select('*', { count: 'exact', head: true });
  const uid = query.userId || query.user_id;
  if (uid) q = q.eq('user_id', uid);
  if (query.read !== undefined) q = q.eq('read', query.read);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count || 0;
};

Notification.create = async function (fields) {
  const doc = new NotificationDocument(fields);
  return doc.save();
};

Notification.updateMany = async function (filter, updates) {
  const patch = {};
  if (updates.read !== undefined) patch.read = updates.read;
  if (updates.readAt !== undefined) patch.read_at = updates.readAt;

  let q = supabase.from('notifications').update(patch);
  const uid = filter.userId || filter.user_id;
  if (uid) q = q.eq('user_id', uid);
  if (filter.read !== undefined) q = q.eq('read', filter.read);

  const { error } = await q;
  if (error) throw new Error(error.message);
  return { acknowledged: true };
};

export default Notification;
