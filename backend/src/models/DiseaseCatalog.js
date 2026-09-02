import mongoose from 'mongoose';

const diseaseCatalogSchema = new mongoose.Schema({
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
  cropCode: {
    type: String,
    required: true,
    ref: 'CropCatalog',
  },
  pathogenType: {
    type: String,
    enum: ['fungal', 'bacterial', 'viral', 'pest', 'nutrient_deficiency', 'abiotic'],
    required: true,
  },
  severityScale: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },
}, { timestamps: true });

diseaseCatalogSchema.index({ cropCode: 1 });

const DiseaseCatalog = mongoose.model('DiseaseCatalog', diseaseCatalogSchema);
export default DiseaseCatalog;
