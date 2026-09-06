import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiagnosisCase', required: true, index: true },
  advisoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Advisory', required: true, index: true },
  farmId: { type: mongoose.Schema.Types.ObjectId, ref: 'Field', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduledFor: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'completed_improved', 'completed_unimproved', 'unresponsive', 'escalated'],
    default: 'pending',
    index: true
  },
  completedAt: Date,
  notes: String,
  farmerResponse: {
    appliedRemedy: Boolean,
    cropCondition: { type: String, enum: ['better', 'same', 'worse'] },
    photoUploaded: Boolean
  },
  reminderCount: { type: Number, default: 0 },
  lastReminderSent: Date,
  escalatedAt: Date,
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

followUpSchema.index({ userId: 1, status: 1, scheduledFor: 1 });
followUpSchema.index({ caseId: 1, status: 1 });

export default mongoose.model('FollowUp', followUpSchema);
