/**
 * backend/src/db/users.js
 *
 * Data-access layer for the `users` table.
 * Replaces: src/models/User.js (Mongoose)
 *
 * bcrypt hashing and JWT signing kept here so controllers don't change.
 */

import bcrypt       from 'bcryptjs';
import jwt          from 'jsonwebtoken';
import supabase     from '../config/supabase.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a Supabase row (snake_case) to the shape controllers expect (camelCase).
 * Returns a plain object — no Mongoose document methods.
 * Methods that were on the Mongoose model (matchPassword, getSignedJwtToken)
 * are now standalone exports below.
 */
export function rowToUser(row) {
  if (!row) return null;
  return {
    _id:                     row.id,          // keep _id alias so JWT middleware still works
    id:                      row.id,
    name:                    row.name,
    phoneNumber:             row.phone_number,
    password:                row.password,    // only present when explicitly selected
    role:                    row.role,
    preferredLanguage:       row.preferred_language,
    profilePhoto:            row.profile_photo ?? '',
    farmDetails:             row.farm_details ?? {},
    notificationPreferences: row.notification_preferences ?? {},
    isActive:                row.is_active,
    createdAt:               row.created_at,
    updatedAt:               row.updated_at,
  };
}

// ─── read ─────────────────────────────────────────────────────────────────────

export async function findUserById(id, { includePassword = false } = {}) {
  let query = supabase.from('users').select('*').eq('id', id).single();
  const { data, error } = await query;
  if (error || !data) return null;
  if (!includePassword) delete data.password;
  return rowToUser(data);
}

export async function findUserByPhone(phoneNumber, { includePassword = false } = {}) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();
  if (error || !data) return null;
  if (!includePassword) delete data.password;
  return rowToUser(data);
}

// ─── write ────────────────────────────────────────────────────────────────────

export async function createUser({ name, phoneNumber, password, role = 'farmer', farmDetails = {} }) {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);

  const { data, error } = await supabase
    .from('users')
    .insert({
      name,
      phone_number:  phoneNumber,
      password:      hash,
      role,
      farm_details:  farmDetails,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  delete data.password;
  return rowToUser(data);
}

export async function updateUser(id, fields) {
  // Convert camelCase fields → snake_case for Postgres
  const patch = {};
  if (fields.name               !== undefined) patch.name               = fields.name;
  if (fields.phoneNumber        !== undefined) patch.phone_number        = fields.phoneNumber;
  if (fields.preferredLanguage  !== undefined) patch.preferred_language  = fields.preferredLanguage;
  if (fields.profilePhoto       !== undefined) patch.profile_photo       = fields.profilePhoto;
  if (fields.farmDetails        !== undefined) patch.farm_details        = fields.farmDetails;
  if (fields.notificationPreferences !== undefined)
    patch.notification_preferences = fields.notificationPreferences;
  if (fields.isActive           !== undefined) patch.is_active           = fields.isActive;

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  delete data.password;
  return rowToUser(data);
}

export async function updateUserPassword(id, newPassword) {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(newPassword, salt);

  const { error } = await supabase
    .from('users')
    .update({ password: hash })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

// ─── auth helpers (replaces Mongoose instance methods) ────────────────────────

export function getSignedJwtToken(user) {
  return jwt.sign(
    { id: user.id || user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );
}

export async function matchPassword(enteredPassword, storedHash) {
  return bcrypt.compare(enteredPassword, storedHash);
}
