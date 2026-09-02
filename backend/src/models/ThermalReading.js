import mongoose from 'mongoose';

const thermalReadingSchema = new mongoose.Schema({
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: true,
  },
  observedAt: {
    type: Date,
    required: true,
  },
  estimatedCanopyTempC: {
    type: Number,
    required: true,
  },
  baselineTempC: {
    type: Number,
    default: null,
  },
  anomalyC: {
    type: Number,
    default: 0,
  },
  resolution: {
    type: String,
    enum: ['district', 'farm_simulated', 'landsat-8-9'],
    default: 'farm_simulated',
  },
  thermalGrid: {
    type: [[Number]],
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return Array.isArray(v) && v.length === 10 && v.every(row => Array.isArray(row) && row.length === 10);
      },
      message: 'Thermal grid must be a 10x10 array',
    },
  },
  sceneSource: {
    type: String,
    enum: ['landsat-8-9', 'formula'],
    default: 'formula',
  },
  sceneId: {
    type: String,
    default: null,
  },
}, { timestamps: true });

thermalReadingSchema.index({ farmId: 1, observedAt: -1 });

const ThermalReading = mongoose.model('ThermalReading', thermalReadingSchema);
export default ThermalReading;
