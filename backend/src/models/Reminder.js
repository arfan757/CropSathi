import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  advisoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Advisory', required: true, index: true },
  reminderType: {
    type: String,
    enum: ['application', 'reapplication', 'harvest_wait'],
    required: true,
    index: true
  },
  dueAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'done', 'snoozed', 'missed'],
    default: 'pending',
    index: true
  },
  snoozeCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

reminderSchema.index({ advisoryId: 1, reminderType: 1, dueAt: 1 });
reminderSchema.index({ dueAt: 1, status: 1 });

export default mongoose.model('Reminder', reminderSchema);
