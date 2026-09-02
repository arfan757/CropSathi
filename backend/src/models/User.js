import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide your name'],
      trim: true,
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Please provide a valid phone number'],
      unique: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian phone number'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false,
    },
    role: {
      type: String,
      enum: ['farmer', 'agronomist', 'admin'],
      default: 'farmer',
    },
    preferredLanguage: {
      type: String,
      enum: ['en', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'pa', 'bn', 'or', 'as', 'ur', 'ml'],
      default: 'en',
    },
    profilePhoto: {
      type: String,
      default: '',
      maxlength: [2000000, 'Profile photo too large (max 500KB)'],
    },
    farmDetails: {
      state: { type: String, default: '' },
      district: { type: String, default: '' },
      village: { type: String, default: '' },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      fullAddress: { type: String, default: '' },
      country: { type: String, default: '' },
      soilType: {
        type: String,
        enum: ['Alluvial', 'Black', 'Red', 'Laterite', 'Clayey', 'Sandy', 'Loamy', 'Other'],
        default: 'Other',
      },
      farmSizeInAcres: { type: Number, default: 0 },
      primaryCrops: [{ type: String }],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;