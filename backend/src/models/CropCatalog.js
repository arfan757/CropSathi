/**
 * backend/src/models/CropCatalog.js
 *
 * Supabase-backed CropCatalog model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class CropCatalogDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.code = row.code;
    this.nameEn = row.name_en || row.nameEn;
    this.nameHi = row.name_hi || row.nameHi || '';
    this.nameMr = row.name_mr || row.nameMr || '';
    this.typicalSowingWindow = row.typical_sowing_window || row.typicalSowingWindow || {};
    this.priorityMaharashtra = Boolean(row.priority_maharashtra ?? row.priorityMaharashtra ?? false);
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
      code: this.code.toLowerCase().trim(),
      name_en: this.nameEn,
      name_hi: this.nameHi,
      name_mr: this.nameMr,
      typical_sowing_window: this.typicalSowingWindow,
      priority_maharashtra: this.priorityMaharashtra,
    };

    const { data, error } = await supabase
      .from('crop_catalogs')
      .upsert(record, { onConflict: 'code' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new CropCatalogDocument(data);
  }
}

class CatalogQuery {
  constructor(executor) {
    this.executor = executor;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      const res = await this.executor();
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

const CropCatalog = function (fields) {
  return new CropCatalogDocument(fields);
};

CropCatalog.find = function (query = {}) {
  return new CatalogQuery(async () => {
    let q = supabase.from('crop_catalogs').select('*');
    if (query.code) q = q.eq('code', query.code.toLowerCase().trim());
    q = q.order('name_en', { ascending: true });

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new CropCatalogDocument(r));
  });
};

CropCatalog.findOne = function (query = {}) {
  return new CatalogQuery(async () => {
    let q = supabase.from('crop_catalogs').select('*');
    if (query.code) q = q.eq('code', query.code.toLowerCase().trim());

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new CropCatalogDocument(data);
  });
};

CropCatalog.findOneAndUpdate = async function (filter, updates, options = {}) {
  const code = (filter.code || updates.code).toLowerCase().trim();
  const record = {
    code,
    name_en: updates.nameEn || updates.name_en,
    name_hi: updates.nameHi || updates.name_hi || '',
    name_mr: updates.nameMr || updates.name_mr || '',
    typical_sowing_window: updates.typicalSowingWindow || updates.typical_sowing_window || {},
    priority_maharashtra: updates.priorityMaharashtra !== undefined ? updates.priorityMaharashtra : (updates.priority_maharashtra || false),
  };

  const { data, error } = await supabase
    .from('crop_catalogs')
    .upsert(record, { onConflict: 'code' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new CropCatalogDocument(data);
};

export default CropCatalog;
