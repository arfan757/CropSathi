/**
 * backend/src/models/User.js
 *
 * Supabase-backed User model adapter.
 * Replaces Mongoose model so all existing controllers, middleware, and
 * services work seamlessly with Supabase PostgreSQL without code changes.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import supabase from '../config/supabase.js';

class UserDocument {
  constructor(row) {
    if (!row) return;
    this._id = row.id;
    this.id = row.id;
    this.name = row.name;
    this.phoneNumber = row.phone_number;
    this.password = row.password;
    this.role = row.role || 'farmer';
    this.preferredLanguage = row.preferred_language || 'en';
    this.profilePhoto = row.profile_photo || '';
    this.farmDetails = row.farm_details || {
      state: '',
      district: '',
      village: '',
      latitude: null,
      longitude: null,
      fullAddress: '',
      country: '',
      soilType: 'Other',
      farmSizeInAcres: 0,
      primaryCrops: [],
    };
    this.notificationPreferences = row.notification_preferences || {
      pushEnabled: true,
      severeAlertsEnabled: true,
      photoPromptsEnabled: true,
    };
    this.isActive = row.is_active !== undefined ? row.is_active : true;
    this.createdAt = row.created_at;
    this.updatedAt = row.updated_at;
  }

  getSignedJwtToken() {
    return jwt.sign(
      { id: this.id || this._id, role: this.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );
  }

  async matchPassword(enteredPassword) {
    if (!this.password) return false;
    return bcrypt.compare(enteredPassword, this.password);
  }

  toObject() {
    const obj = { ...this };
    return obj;
  }

  async save() {
    // If password was changed in memory, hash it before saving
    let passwordHash = this.password;
    if (this._passwordModified) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(this.password, salt);
      this.password = passwordHash;
      this._passwordModified = false;
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        name: this.name,
        phone_number: this.phoneNumber,
        password: passwordHash,
        role: this.role,
        preferred_language: this.preferredLanguage,
        profile_photo: this.profilePhoto,
        farm_details: this.farmDetails,
        notification_preferences: this.notificationPreferences,
        is_active: this.isActive,
      })
      .eq('id', this.id || this._id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new UserDocument(data);
  }
}

// Intercept password setter to flag modification
Object.defineProperty(UserDocument.prototype, 'password', {
  get() {
    return this._passwordValue;
  },
  set(val) {
    if (this._passwordValue && this._passwordValue !== val) {
      this._passwordModified = true;
    }
    this._passwordValue = val;
  },
  configurable: true,
  enumerable: true,
});

class QueryBuilder {
  constructor(promiseFn) {
    this.promiseFn = promiseFn;
    this._includePassword = false;
  }

  select(fields) {
    if (typeof fields === 'string' && fields.includes('+password')) {
      this._includePassword = true;
    }
    return this;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      const res = await this.promiseFn(this._includePassword);
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

const User = {
  // Query by single criteria (e.g. { phoneNumber }, { _id })
  findOne(query) {
    return new QueryBuilder(async (includePassword) => {
      let q = supabase.from('users').select('*');
      if (query.phoneNumber) {
        q = q.eq('phone_number', query.phoneNumber.trim());
      } else if (query._id || query.id) {
        q = q.eq('id', query._id || query.id);
      } else if (query['farmDetails.district']) {
        q = q.eq('farm_details->>district', query['farmDetails.district']);
      }
      const { data, error } = await q.maybeSingle();
      if (error || !data) return null;
      if (!includePassword) delete data.password;
      return new UserDocument(data);
    });
  },

  findById(id) {
    return this.findOne({ _id: id });
  },

  find(query = {}) {
    return new QueryBuilder(async () => {
      let q = supabase.from('users').select('*');
      if (query['farmDetails.district']) {
        q = q.eq('farm_details->>district', query['farmDetails.district']);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map(row => {
        delete row.password;
        return new UserDocument(row);
      });
    });
  },

  async create(fields) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(fields.password, salt);

    const { data, error } = await supabase
      .from('users')
      .insert({
        name: fields.name,
        phone_number: fields.phoneNumber,
        password: hash,
        role: fields.role || 'farmer',
        preferred_language: fields.preferredLanguage || 'en',
        profile_photo: fields.profilePhoto || '',
        farm_details: fields.farmDetails || {},
        notification_preferences: fields.notificationPreferences || {
          pushEnabled: true,
          severeAlertsEnabled: true,
          photoPromptsEnabled: true,
        },
        is_active: fields.isActive !== undefined ? fields.isActive : true,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new UserDocument(data);
  },

  async findByIdAndUpdate(id, updates, options = {}) {
    // Flatten any dot-notation keys like 'farmDetails.village' or 'notificationPreferences.pushEnabled'
    const existing = await User.findById(id);
    if (!existing) return null;

    const farmDetails = { ...existing.farmDetails };
    const notificationPreferences = { ...existing.notificationPreferences };
    const patch = {};

    for (const [key, val] of Object.entries(updates)) {
      if (key.startsWith('farmDetails.')) {
        const subKey = key.split('.')[1];
        farmDetails[subKey] = val;
      } else if (key.startsWith('notificationPreferences.')) {
        const subKey = key.split('.')[1];
        notificationPreferences[subKey] = val;
      } else if (key === 'farmDetails') {
        Object.assign(farmDetails, val);
      } else if (key === 'notificationPreferences') {
        Object.assign(notificationPreferences, val);
      } else if (key === 'name') {
        patch.name = val;
      } else if (key === 'profilePhoto') {
        patch.profile_photo = val;
      } else if (key === 'preferredLanguage') {
        patch.preferred_language = val;
      } else if (key === 'isActive') {
        patch.is_active = val;
      }
    }

    patch.farm_details = farmDetails;
    patch.notification_preferences = notificationPreferences;

    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return new UserDocument(data);
  },
};

export default User;