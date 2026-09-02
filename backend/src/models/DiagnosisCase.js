import mongoose from 'mongoose';

const diagnosisCaseSchema = new mongoose.Schema({
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  triggeredBy: {
    type: String,
    enum: ['risk_alert', 'farmer_initiated'],
    required: true,
  },
  triggeringRiskScoreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RiskScore',
    default: null,
  },
  status: {
    type: String,
    enum: [
      'awaiting_photo',
      'diagnosing',
      'report_ready',
      'retry_failed',
      'deleted',
    ],
    default: 'awaiting_photo',
  },
  // Gemini AI diagnosis result (structured)
  geminiResult: {
    imageQualityOk: { type: Boolean, default: null },
    cropIdentified: { type: String, default: null },
    detectedIssue: { type: String, default: null },
    confidence: { type: Number, default: null },
    severity: { type: String, enum: ['none', 'mild', 'moderate', 'severe', null], default: null },
    symptomsObserved: [{ type: String }],
    matchesRiskSignal: { type: Boolean, default: null },
    notes: { type: String, default: null },
    modelVersion: { type: String, default: null },
  },
  // Summary fields for quick access
  finalDiseaseCode: { type: String, default: null },
  finalSeverity: { type: String, enum: ['none', 'mild', 'moderate', 'severe', null], default: null },
  confidence: { type: Number, default: null },
  outcome: {
    type: String,
    enum: ['confirmed', 'false_alarm', 'expert_review', 'retry', null],
    default: null,
  },
  requiresExpertReview: { type: Boolean, default: false },
  gpsPoint: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  capturedAt: { type: Date, default: Date.now },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

diagnosisCaseSchema.index({ farmId: 1, status: 1 });
diagnosisCaseSchema.index({ status: 1, requiresExpertReview: 1 });

const DiagnosisCase = mongoose.model('DiagnosisCase', diagnosisCaseSchema);
export default DiagnosisCase;
