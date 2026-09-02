import mongoose from 'mongoose';

const cropCatalogSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  nameEn: { type: String, required: true },
  nameHi: { type: String, default: '' },
  nameMr: { type: String, default: '' },
  typicalSowingWindow: {
    startMonth: { type: Number, min: 1, max: 12 },
    startDay: { type: Number, min: 1, max: 31 },
    endMonth: { type: Number, min: 1, max: 12 },
    endDay: { type: Number, min: 1, max: 31 },
  },
  priorityMaharashtra: { type: Boolean, default: false },
}, { timestamps: true });

cropCatalogSchema.index({ code: 1 }, { unique: true });

const CropCatalog = mongoose.model('CropCatalog', cropCatalogSchema);
export default CropCatalog;
