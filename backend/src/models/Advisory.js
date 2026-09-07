import mongoose from 'mongoose';

const advisorySchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DiagnosisCase',
    required: true,
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
  // ── TNAU-grade advisory fields (additive — legacy tier fields above stay) ──
  summary: { type: String, default: '' },
  pathogenName: { type: String, default: '' },
  symptoms: { type: String, default: '' },
  remedies: [{
    type: { type: String, enum: ['cultural', 'physical', 'biological', 'chemical'], required: true },
    action: { type: String, default: '' },
    productName: { type: String, default: '' },
    dosage: { type: String, default: '' },
    frequency: { type: String, default: '' },
    timing: { type: String, default: '' },
    preHarvestIntervalDays: { type: Number, default: null },
    safetyNotes: { type: String, default: '' },
  }],
  followUpDays: { type: Number, default: null },
  escalateToCropsap: { type: Boolean, default: false },
  escalationReason: { type: String, default: null },
  // Provenance: which engine wrote this version. Lets the UI badge an
  // advisory as AI-written vs generic rule guidance.
  source: { type: String, enum: ['gemini', 'rules'], default: 'rules' },
  isGeneric: { type: Boolean, default: false },
  prevention: [{
    type: String,
  }],
  generatedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Index for fast lookup by case
advisorySchema.index({ caseId: 1, version: -1 });

const Advisory = mongoose.model('Advisory', advisorySchema);
export default Advisory;
