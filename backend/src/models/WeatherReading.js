import mongoose from 'mongoose';

const weatherReadingSchema = new mongoose.Schema({
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: true,
  },
  source: {
    type: String,
    enum: ['open_meteo', 'imd'],
    default: 'open_meteo',
  },
  observedAt: {
    type: Date,
    required: true,
  },
  temperatureC: { type: Number },
  humidityPct: { type: Number },
  rainfallMm24h: { type: Number, default: 0 },
  windSpeedMs: { type: Number, default: 0 },
  soilTempC: { type: Number },
  rawPayload: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

weatherReadingSchema.index({ farmId: 1, observedAt: -1 });

const WeatherReading = mongoose.model('WeatherReading', weatherReadingSchema);
export default WeatherReading;
