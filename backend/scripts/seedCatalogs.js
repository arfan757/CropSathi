/**
 * Seed crop_catalog and disease_catalog collections.
 * Run with: node scripts/seedCatalogs.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import CropCatalog from '../src/models/CropCatalog.js';
import DiseaseCatalog from '../src/models/DiseaseCatalog.js';

const crops = [
  {
    code: 'cotton',
    nameEn: 'Cotton',
    nameHi: 'कपास',
    nameMr: 'कापूस',
    typicalSowingWindow: { startMonth: 6, startDay: 1, endMonth: 7, endDay: 15 },
    priorityMaharashtra: true,
  },
  {
    code: 'soybean',
    nameEn: 'Soybean',
    nameHi: 'सोयाबीन',
    nameMr: 'सोयाबीन',
    typicalSowingWindow: { startMonth: 6, startDay: 15, endMonth: 7, endDay: 15 },
    priorityMaharashtra: true,
  },
  {
    code: 'tur',
    nameEn: 'Pigeon Pea (Tur)',
    nameHi: 'अरहर',
    nameMr: 'तूर',
    typicalSowingWindow: { startMonth: 6, startDay: 15, endMonth: 7, endDay: 31 },
    priorityMaharashtra: true,
  },
  {
    code: 'wheat',
    nameEn: 'Wheat',
    nameHi: 'गेहूं',
    nameMr: 'गहू',
    typicalSowingWindow: { startMonth: 10, startDay: 15, endMonth: 12, endDay: 15 },
    priorityMaharashtra: true,
  },
  {
    code: 'rice',
    nameEn: 'Rice',
    nameHi: 'चावल',
    nameMr: 'तांदूळ',
    typicalSowingWindow: { startMonth: 6, startDay: 1, endMonth: 7, endDay: 31 },
    priorityMaharashtra: true,
  },
  {
    code: 'maize',
    nameEn: 'Maize',
    nameHi: 'मक्का',
    nameMr: 'मका',
    typicalSowingWindow: { startMonth: 6, startDay: 1, endMonth: 7, endDay: 15 },
    priorityMaharashtra: true,
  },
  {
    code: 'sugarcane',
    nameEn: 'Sugarcane',
    nameHi: 'गन्ना',
    nameMr: 'उस',
    typicalSowingWindow: { startMonth: 1, startDay: 1, endMonth: 3, endDay: 31 },
    priorityMaharashtra: true,
  },
  {
    code: 'potato',
    nameEn: 'Potato',
    nameHi: 'आलू',
    nameMr: 'बटाटा',
    typicalSowingWindow: { startMonth: 10, startDay: 1, endMonth: 12, endDay: 31 },
    priorityMaharashtra: true,
  },
  {
    code: 'grapes',
    nameEn: 'Grapes',
    nameHi: 'अंगूर',
    nameMr: 'द्राक्ष',
    typicalSowingWindow: { startMonth: 1, startDay: 1, endMonth: 2, endDay: 28 },
    priorityMaharashtra: true,
  },
];

const diseases = [
  // Cotton diseases
  {
    code: 'cotton_bollworm',
    nameEn: 'Cotton Bollworm',
    nameHi: 'कपास बोलवर्म',
    nameMr: 'कापूस बोलवर्म',
    cropCode: 'cotton',
    pathogenType: 'pest',
    severityScale: 'high',
  },
  {
    code: 'cotton_wilt',
    nameEn: 'Cotton Wilt',
    nameHi: 'कपास विल्ट',
    nameMr: 'कापूस विल्ट',
    cropCode: 'cotton',
    pathogenType: 'fungal',
    severityScale: 'critical',
  },
  // Soybean diseases
  {
    code: 'soybean_rust',
    nameEn: 'Soybean Rust',
    nameHi: 'सोयाबीन रस्ट',
    nameMr: 'सोयाबीन रस्ट',
    cropCode: 'soybean',
    pathogenType: 'fungal',
    severityScale: 'high',
  },
  {
    code: 'soybean_leaf_spot',
    nameEn: 'Soybean Leaf Spot',
    nameHi: 'सोयाबीन पत्ता धब्बा',
    nameMr: 'सोयाबीन पानांचा डाळ',
    cropCode: 'soybean',
    pathogenType: 'fungal',
    severityScale: 'medium',
  },
  // Tur diseases
  {
    code: 'tur_wilt',
    nameEn: 'Tur Wilt',
    nameHi: 'अरहर विल्ट',
    nameMr: 'तूर विल्ट',
    cropCode: 'tur',
    pathogenType: 'fungal',
    severityScale: 'critical',
  },
  {
    code: 'tur_pod_borer',
    nameEn: 'Tur Pod Borer',
    nameHi: 'अरहर पॉड बोरर',
    nameMr: 'तूर शेंग बोरर',
    cropCode: 'tur',
    pathogenType: 'pest',
    severityScale: 'high',
  },
  // Wheat diseases
  {
    code: 'wheat_rust',
    nameEn: 'Wheat Rust',
    nameHi: 'गेहूं रस्ट',
    nameMr: 'गहू रस्ट',
    cropCode: 'wheat',
    pathogenType: 'fungal',
    severityScale: 'high',
  },
  {
    code: 'wheat_powdery_mildew',
    nameEn: 'Wheat Powdery Mildew',
    nameHi: 'गेहूं पाउडरी मिल्ड्यू',
    nameMr: 'गहू पावडरी मिल्ड्यू',
    cropCode: 'wheat',
    pathogenType: 'fungal',
    severityScale: 'medium',
  },
  // Rice diseases
  {
    code: 'rice_blast',
    nameEn: 'Rice Blast',
    nameHi: 'चावल ब्लास्ट',
    nameMr: 'तांदूळ ब्लास्ट',
    cropCode: 'rice',
    pathogenType: 'fungal',
    severityScale: 'critical',
  },
  {
    code: 'rice_bacterial_leaf_blight',
    nameEn: 'Bacterial Leaf Blight',
    nameHi: 'बैक्टीरियल लीफ ब्लाइट',
    nameMr: 'बॅक्टेरियल पानांचा बर्न',
    cropCode: 'rice',
    pathogenType: 'bacterial',
    severityScale: 'high',
  },
  // Maize diseases
  {
    code: 'maize_fall_armyworm',
    nameEn: 'Fall Armyworm',
    nameHi: 'फॉल आर्मीवर्म',
    nameMr: 'फॉल आर्मीवर्म',
    cropCode: 'maize',
    pathogenType: 'pest',
    severityScale: 'high',
  },
  // Potato diseases
  {
    code: 'potato_late_blight',
    nameEn: 'Potato Late Blight',
    nameHi: 'आलू लेट ब्लाइट',
    nameMr: 'बटाटा लेट ब्लाइट',
    cropCode: 'potato',
    pathogenType: 'fungal',
    severityScale: 'critical',
  },
  // Sugarcane diseases
  {
    code: 'sugarcane_red_rot',
    nameEn: 'Sugarcane Red Rot',
    nameHi: 'गन्ना रेड रॉट',
    nameMr: 'उस रेड रॉट',
    cropCode: 'sugarcane',
    pathogenType: 'fungal',
    severityScale: 'critical',
  },
  // Grapes diseases
  {
    code: 'grapes_downy_mildew',
    nameEn: 'Grapes Downy Mildew',
    nameHi: 'अंगूर डाउनी मिल्ड्यू',
    nameMr: 'द्राक्ष डाउनी मिल्ड्यू',
    cropCode: 'grapes',
    pathogenType: 'fungal',
    severityScale: 'medium',
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connected to MongoDB');

    // Upsert crops
    for (const crop of crops) {
      await CropCatalog.findOneAndUpdate(
        { code: crop.code },
        crop,
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${crops.length} crops`);

    // Upsert diseases
    for (const disease of diseases) {
      await DiseaseCatalog.findOneAndUpdate(
        { code: disease.code },
        disease,
        { upsert: true, new: true }
      );
    }
    console.log(`Seeded ${diseases.length} diseases`);

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
}

seed();
