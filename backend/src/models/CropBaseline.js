import mongoose from 'mongoose';

/**
 * CropBaseline stores dynamic NDVI/NDRE percentile baselines per crop/region.
 *
 * Recomputed weekly by the baselineRecompute cron job from trailing 90-day
 * satellite readings (real Sentinel-2 only, cloudCoverPct < 40%).
 *
 * On cold start (no calibrated data for a crop/region), the vegetationHealth
 * module falls back to literature defaults:
 *   NDVI: min=0.0, max=0.9
 *   NDRE: min=-0.1, max=0.7  (literature-typical; NEEDS_CALIBRATION)
 *
 * The `source` field distinguishes calibrated vs default baselines so the
 * frontend/advisory layer can treat early scores with appropriate caution.
 */
const cropBaselineSchema = new mongoose.Schema({
  cropType: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  region: {
    type: String,
    default: 'global',
    trim: true,
    lowercase: true,
  },
  ndviP05: {
    type: Number,
    default: 0.0,
    min: -1,
    max: 1,
  },
  ndviP95: {
    type: Number,
    default: 0.9,
    min: -1,
    max: 1,
  },
  ndreP05: {
    type: Number,
    default: -0.1,
    min: -1,
    max: 1,
  },
  ndreP95: {
    type: Number,
    default: 0.7,
    min: -1,
    max: 1,
  },
  sampleSize: {
    type: Number,
    default: 0,
    min: 0,
  },
  lastRecomputedAt: {
    type: Date,
    default: null,
  },
  source: {
    type: String,
    enum: ['calibrated', 'default'],
    default: 'default',
  },
}, { timestamps: true });

// One baseline per crop + region combination
cropBaselineSchema.index({ cropType: 1, region: 1 }, { unique: true });

const CropBaseline = mongoose.model('CropBaseline', cropBaselineSchema);
export default CropBaseline;
