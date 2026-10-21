/**
 * backend/src/models/DiseaseCatalog.js
 *
 * Supabase-backed DiseaseCatalog model adapter.
 */

import { randomUUID } from 'crypto';
import supabase from '../config/supabase.js';

export class DiseaseCatalogDocument {
  constructor(row = {}) {
    this._id = row.id || row._id || randomUUID();
    this.id = this._id;
    this.code = row.code;
    this.nameEn = row.name_en || row.nameEn;
    this.nameHi = row.name_hi || row.nameHi || '';
    this.nameMr = row.name_mr || row.nameMr || '';
    this.cropCode = row.crop_code || row.cropCode;
    this.pathogenType = row.pathogen_type || row.pathogenType;
    this.severityScale = row.severity_scale || row.severityScale || 'medium';
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
      crop_code: this.cropCode.toLowerCase().trim(),
      pathogen_type: this.pathogenType,
      severity_scale: this.severityScale,
    };

    const { data, error } = await supabase
      .from('disease_catalogs')
      .upsert(record, { onConflict: 'code' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new DiseaseCatalogDocument(data);
  }
}

class DiseaseQuery {
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

const DiseaseCatalog = function (fields) {
  return new DiseaseCatalogDocument(fields);
};

DiseaseCatalog.find = function (query = {}) {
  return new DiseaseQuery(async () => {
    let q = supabase.from('disease_catalogs').select('*');
    if (query.cropCode) q = q.eq('crop_code', query.cropCode.toLowerCase().trim());
    if (query.code) q = q.eq('code', query.code.toLowerCase().trim());

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(r => new DiseaseCatalogDocument(r));
  });
};

DiseaseCatalog.findOne = function (query = {}) {
  return new DiseaseQuery(async () => {
    let q = supabase.from('disease_catalogs').select('*');
    if (query.code) q = q.eq('code', query.code.toLowerCase().trim());

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    return new DiseaseCatalogDocument(data);
  });
};

DiseaseCatalog.findOneAndUpdate = async function (filter, updates, options = {}) {
  const code = (filter.code || updates.code).toLowerCase().trim();
  const record = {
    code,
    name_en: updates.nameEn || updates.name_en,
    name_hi: updates.nameHi || updates.name_hi || '',
    name_mr: updates.nameMr || updates.name_mr || '',
    crop_code: (updates.cropCode || updates.crop_code).toLowerCase().trim(),
    pathogen_type: updates.pathogenType || updates.pathogen_type,
    severity_scale: updates.severityScale || updates.severity_scale || 'medium',
  };

  const { data, error } = await supabase
    .from('disease_catalogs')
    .upsert(record, { onConflict: 'code' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return new DiseaseCatalogDocument(data);
};

export default DiseaseCatalog;
