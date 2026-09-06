import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  farmId: { type: mongoose.Schema.Types.ObjectId, ref: 'Field', required: true, index: true },
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiagnosisCase', index: true },
  advisoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Advisory', index: true },
  followUpId: { type: mongoose.Schema.Types.ObjectId, ref: 'FollowUp', index: true },
  type: {
    type: String,
    enum: ['advisory_ready', 'remedy_reminder', 'reapplication_reminder', 'follow_up_check', 'harvest_safety_wait', 'escalation_alert', 'weather_alert'],
    required: true,
    index: true
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', index: true },
  deepLink: String,
  read: { type: Boolean, default: false, index: true },
  readAt: Date,
  actionTaken: { type: String, enum: ['done', 'snoozed', 'dismissed'] },
  snoozedUntil: Date,
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ farmId: 1, type: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
