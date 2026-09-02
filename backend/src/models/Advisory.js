import mongoose from 'mongoose';

const advisorySchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DiagnosisCase',
    required: true,
    unique: true,
  },
  version: {
    type: Number,
    default: 1,
    min: 1,
  },
  diseaseCode: {
    type: String,
    required: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  },
  cropStage: {
    type: String,
    enum: ['sowing', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested'],
    default: 'vegetative',
  },
  ipmCulturalActions: [{
    actionKey: String,
    en: String,
    hi: String,
    mr: String,
  }],
  ipmBiologicalActions: [{
    actionKey: String,
    en: String,
    hi: String,
    mr: String,
  }],
  chemicalRecommendation: {
    type: {
      productClass: String,
      dosage: String,
      unit: String,
      frequency: String,
      applicationTiming: String,
      preHarvestIntervalDays: Number,
    },
    default: null,
  },
  generatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Index for fast lookup by case
advisorySchema.index({ caseId: 1, version: -1 });

const Advisory = mongoose.model('Advisory', advisorySchema);
export default Advisory;
