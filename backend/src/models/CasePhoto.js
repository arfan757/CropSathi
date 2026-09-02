import mongoose from 'mongoose';

const casePhotoSchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DiagnosisCase',
    required: true,
  },
  storageKey: { type: String, required: true },
  filename: { type: String, default: '' },
  mimeType: { type: String, default: 'image/jpeg' },
  fileSize: { type: Number, default: 0 },
  isRecapture: { type: Boolean, default: false },
  leafSegmentationApplied: { type: Boolean, default: false },
  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

casePhotoSchema.index({ caseId: 1, uploadedAt: -1 });

const CasePhoto = mongoose.model('CasePhoto', casePhotoSchema);
export default CasePhoto;
