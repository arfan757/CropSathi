import mongoose from 'mongoose';

const riskScoreSchema = new mongoose.Schema({
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: true,
  },
  computedAt: {
    type: Date,
    default: Date.now,
  },
  weatherComponent: { type: Number, default: 0, min: 0, max: 1 },
  ndviComponent: { type: Number, default: 0.5, min: 0, max: 1 },
  thermalComponent: { type: Number, default: 0.5, min: 0, max: 1 },
  pestHistoryComponent: { type: Number, default: 0, min: 0, max: 1 },
  compositeScore: { type: Number, default: 0, min: 0, max: 100 },
  healthLevel: { type: String, enum: ['healthy', 'watch', 'elevated', 'high', null], default: null },
  staleSignals: [{ type: String }],
  weightsUsed: { type: mongoose.Schema.Types.Mixed },
  triggeredAlert: { type: Boolean, default: false },
  diseaseHypothesis: { type: String, default: null },
  matchedWeatherRules: [{ type: mongoose.Schema.Types.Mixed }],
  thresholdUsed: { type: Number, default: 0.6 },
  inputsSnapshot: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

riskScoreSchema.index({ farmId: 1, computedAt: -1 });

// Risk scores are written every couple of hours per farm — keep roughly
// half a year of history for trends, then auto-expire.
riskScoreSchema.index({ computedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

const RiskScore = mongoose.model('RiskScore', riskScoreSchema);
export default RiskScore;
