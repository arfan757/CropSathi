import mongoose from 'mongoose';

const ndviReadingSchema = new mongoose.Schema({
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: true,
  },
  observedAt: {
    type: Date,
    required: true,
  },
  ndvi: {
    type: Number,
    required: true,
    min: -1,
    max: 1,
  },
  ndre: {
    type: Number,
    default: null,
    min: -1,
    max: 1,
  },
  cloudCoverPct: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  trailingAvgNdvi28d: {
    type: Number,
    default: null,
  },
  anomalyScore: {
    type: Number,
    default: 0,
  },
  pixelCountPureCrop: {
    type: Number,
    default: null,
  },
  ndviGrid: {
    type: [[Number]],
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return Array.isArray(v) && v.length === 10 && v.every(row => Array.isArray(row) && row.length === 10);
      },
      message: 'NDVI grid must be a 10x10 array',
    },
  },
  ndreGrid: {
    type: [[Number]],
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return Array.isArray(v) && v.length === 10 && v.every(row => Array.isArray(row) && row.length === 10);
      },
      message: 'NDRE grid must be a 10x10 array',
    },
  },
  sceneSource: {
    type: String,
    enum: ['sentinel-2', 'simulated'],
    default: 'simulated',
  },
  sceneId: {
    type: String,
    default: null,
  },
}, { timestamps: true });

ndviReadingSchema.index({ farmId: 1, observedAt: -1 });

const NdviReading = mongoose.model('NdviReading', ndviReadingSchema);
export default NdviReading;
