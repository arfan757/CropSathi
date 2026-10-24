import 'dotenv/config';
import Field from '../src/models/Field.js';
import WeatherReading from '../src/models/WeatherReading.js';
import { pollWeatherForActiveFarms } from '../src/cron/pollWeather.js';
import { fetchNdviForFarm } from '../src/services/ndviService.js';
import { computeThermalReading } from '../src/services/thermalService.js';
import { computeRiskScore } from '../src/services/riskService.js';

async function refreshAllFields() {
  console.log('=== 🛰️ LIVE SATELLITE SCAN & RISK SCORE RECOMPUTATION ===\n');

  console.log('Step 1: Polling latest weather data...');
  try {
    const weatherResult = await pollWeatherForActiveFarms();
    console.log('Weather polling done:', weatherResult);
  } catch (err) {
    console.warn('Weather polling warning:', err.message);
  }

  const fields = await Field.find({ deletedAt: null });
  console.log(`\nStep 2: Processing ${fields.length} active field(s) with live Copernicus Sentinel-2...`);

  for (const farm of fields) {
    console.log(`\n--- Field: "${farm.name}" (${farm.cropType}, ${farm.areaInHectares} ha) ---`);
    console.log(`    Centroid: [${farm.centerLat}, ${farm.centerLng}]`);

    // 1. Fetch live Sentinel-2 NDVI/NDRE from Copernicus
    let ndviRes = null;
    try {
      console.log('    Fetching Copernicus Sentinel-2 L2A tile...');
      ndviRes = await fetchNdviForFarm(farm);
      if (ndviRes) {
        console.log(`    ✅ Sentinel-2 Success: NDVI=${ndviRes.ndvi?.toFixed(3)}, NDRE=${ndviRes.ndre?.toFixed(3)}, Source=${ndviRes.sceneSource}, Age=${ndviRes.sceneAgeDays}d, Cloud=${ndviRes.cloudCoverPct}%`);
      } else {
        console.warn('    ⚠️ Sentinel-2 returned null reading');
      }
    } catch (e) {
      console.error('    ❌ Sentinel-2 fetch error:', e.message);
    }

    // 2. Compute thermal reading
    try {
      const weather = await WeatherReading.findOne({ farmId: farm._id }).sort({ observedAt: -1 }).lean();
      if (weather) {
        const thermalRes = await computeThermalReading(farm, weather);
        console.log(`    ✅ Thermal Reading computed: CWSI=${thermalRes.cwsi ?? 'N/A'}, Source=${thermalRes.sceneSource}`);
      }
    } catch (e) {
      console.warn('    ⚠️ Thermal compute error:', e.message);
    }

    // 3. Compute Risk Score
    try {
      console.log('    Computing full vegetation health & risk score...');
      const score = await computeRiskScore(farm._id);
      console.log(`    🎉 Score Computed: ${score.compositeScore}/100, Level: ${score.healthLevel}, Confidence: ${score.confidence}, Satellite: ${score.sceneSource} (${score.sceneAgeDays}d ago)`);
    } catch (e) {
      console.error('    ❌ Risk score compute error:', e.message);
    }
  }

  console.log('\n=== ✅ ALL FIELDS REFRESHED WITH REAL SATELLITE DATA! ===');
}

refreshAllFields().catch(console.error);
