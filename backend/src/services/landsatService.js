import axios from 'axios';
import { fromArrayBuffer } from 'geotiff';
import { computeBBox } from './copernicusClient.js';

// ─── Landsat 8/9 Thermal Service ────────────────────────────────────────
// Uses Copernicus Sentinel Hub Process API to extract thermal data from
// Landsat 8/9 Band 10 (TIRS).
//
// NOTE on collection: we request landsat-ot-l1, NOT landsat-ot-l2. On the
// current Copernicus Data Space Processing API (sh.dataspace.copernicus.eu)
// the L2 collection is unresolvable server-side ("Unable to resolve: LOTL2",
// HTTP 500) while L1 works. L1 exposes B10 as TOA brightness temperature in
// Kelvin (docs: "Thermal infrared bands B10-B11 Brightness Temperature"),
// which the evalscript converts to Celsius. The physical quantity is
// at-sensor brightness temperature rather than land surface temperature,
// but it is real satellite data and fully usable for the app's relative
// farm-vs-baseline anomaly detection.
//
// Resolution: 100m per pixel (Landsat thermal band native)
// Grid: Sampled into a 10x10 grid per field for heatmap visualization

const GRID_SIZE = 10;
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/process/v1';

// ─── Token Management ────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 300_000) return cachedToken;

  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Copernicus credentials not configured');

  const { data } = await axios.post(
    'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 }
  );

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 600) * 1000;
  return cachedToken;
}

// ─── Main Export ──────────────────────────────────────────────────────────

/**
 * Compute LST grid for a farm from Landsat thermal data.
 *
 * @param {Object} farm - Farm document with boundary/centroid
 * @param {Object} options - { startDate, endDate, maxCloudCover }
 * @returns {Promise<Object>} { thermalGrid, sceneInfo, observedAt }
 */
export async function fetchLandsatLst(farm, options = {}) {
  const {
    // 90-day lookback (was 45): Maharashtra's monsoon (Jun-Sep) leaves many
    // 45-day windows with zero cloud-free pixels, which silently degraded
    // thermal to the formula path for months. 90 days still picks the most
    // recent clear scene; its acquisition date becomes observedAt and the
    // existing staleness rules (thermal stale after 20 days) keep old scenes
    // from inflating current risk scores.
    startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    maxCloudCoverage = 30,
  } = options;

  const bbox = computeBBox(farm);
  if (!bbox) throw new Error('Farm has no boundary geometry for satellite query');

  const token = await getToken();

  // Evalscript for Landsat 8/9 Level-1
  // B10 = Thermal Infrared (TIRS) 1, TOA brightness temperature in Kelvin
  // (the L1 collection serves B10 pre-calibrated to Kelvin on this API)
  const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B10", "dataMask"],
    output: { bands: 2, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0];
  // Landsat L1 B10 is TOA brightness temperature in Kelvin — convert to Celsius
  const lstC = sample.B10 - 273.15;
  return [lstC, sample.dataMask];
}`;

  const request = {
    input: {
      bounds: {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{
        type: 'landsat-ot-l1',
        dataFilter: {
          timeRange: { from: startDate.toISOString(), to: endDate.toISOString() },
          maxCloudCoverage,
        },
      }],
    },
    output: {
      width: GRID_SIZE,
      height: GRID_SIZE,
      responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
    },
    evalscript,
  };

  try {
    const resp = await axios.post(PROCESS_URL, request, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'image/tiff',
      },
      timeout: 120_000,
      responseType: 'arraybuffer',
    });

    if (resp.data.byteLength < 100) {
      throw new Error('Empty response from Processing API');
    }

    // Parse TIFF using geotiff library
    const buf = Buffer.from(resp.data);
    const arrayBuffer = new ArrayBuffer(buf.length);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];
    const pixels = await parseTiffWithGeotiff(arrayBuffer);

    // Extract LST grid (band 0 = temperature in Celsius, band 1 = dataMask).
    // The evalscript emits [0, 0] for cloud-covered / off-scene pixels
    // (dataMask === 0). Those were previously read as a literal 0°C and
    // folded into the field average via averageGrid()'s `!= null` filter,
    // which silently corrupted the whole farm's reading on any cloudy or
    // edge-of-scene pixel (0°C looks like an extreme cold anomaly). Emit
    // null for masked pixels instead so averageGrid() correctly excludes
    // them, the same way it already excludes actual nulls.
    const thermalGrid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      const rowData = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const pixelBase = (row * GRID_SIZE + col) * 2; // 2 bands per pixel
        const lstC = pixels[pixelBase];
        const mask = pixels[pixelBase + 1];
        const valid = mask !== undefined && mask !== 0 && lstC !== undefined && !isNaN(lstC);
        rowData.push(valid ? Math.round(lstC * 100) / 100 : null);
      }
      thermalGrid.push(rowData);
    }

    const validPixelCount = thermalGrid.flat().filter(v => v !== null).length;
    if (validPixelCount === 0) {
      // Every pixel was cloud-covered or off-scene. averageGrid() would
      // silently fall back to its 30C default here — indistinguishable
      // from a real reading once returned — and this result gets labeled
      // sceneInfo.source: 'landsat-8-9' with a real sceneId, so
      // computeThermalReading has no way to know it's fabricated. Throw
      // so the caller falls through to the honest simulated/formula path
      // instead of storing a fake number as authentic satellite data.
      throw new Error('Landsat scene fully cloud-masked — no valid pixels');
    }

    const sceneDate = resp.headers['landsat-data-date'] || startDate.toISOString();

    return {
      thermalGrid,
      sceneInfo: {
        sceneId: `landsat-${Date.now()}`,
        sceneName: 'Landsat 8/9 L1',
        cloudCover: maxCloudCoverage,
        source: 'landsat-8-9',
      },
      observedAt: new Date(sceneDate),
    };
  } catch (error) {
    console.warn('Landsat Processing API failed, using fallback:', error.message);
    return {
      thermalGrid: generateFallbackThermalGrid(),
      sceneInfo: { sceneId: null, sceneName: 'Simulated', cloudCover: 0, source: 'formula' },
      observedAt: new Date(),
    };
  }
}

// ─── TIFF Parser ──────────────────────────────────────────────────────────

async function parseTiffWithGeotiff(buffer) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const numBands = image.getSamplesPerPixel();
  if (width !== GRID_SIZE || height !== GRID_SIZE) {
    // fetchLandsatLst indexes into the flat pixel array assuming a
    // GRID_SIZE x GRID_SIZE layout; a mismatch here would silently
    // misalign every pixel read rather than throwing. Surfacing it as a
    // warning is a stopgap — a real fix would resample to GRID_SIZE.
    console.warn(`Landsat response grid is ${width}x${height}, expected ${GRID_SIZE}x${GRID_SIZE} — pixel indexing may be misaligned.`);
  }

  const bands = await image.readRasters({ interleave: false });
  const pixels = new Float32Array(width * height * numBands);
  for (let b = 0; b < numBands; b++) {
    const band = bands[b];
    for (let i = 0; i < band.length; i++) {
      pixels[i * numBands + b] = band[i];
    }
  }
  return Array.from(pixels);
}

// ─── Fallback ─────────────────────────────────────────────────────────────

function generateFallbackThermalGrid() {
  const baseTemp = 32;
  const grid = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    const rowData = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const noise = (Math.random() - 0.5) * 4;
      const edge = ((row === 0 || row === GRID_SIZE - 1 || col === 0 || col === GRID_SIZE - 1) ? 1.5 : 0);
      rowData.push(Math.round((baseTemp + noise + edge) * 100) / 100);
    }
    grid.push(rowData);
  }
  return grid;
}

// ─── Classification ───────────────────────────────────────────────────────

export function classifyThermal(value, baseline = 30) {
  const anomaly = value - baseline;
  if (anomaly < -5) return { label: 'Very Cold (Frost Risk)', color: '#1565C0', severity: 'high' };
  if (anomaly < -2) return { label: 'Cool', color: '#42A5F5', severity: 'low' };
  if (anomaly < 0) return { label: 'Below Baseline', color: '#81D4FA', severity: 'none' };
  if (anomaly < 2) return { label: 'Normal', color: '#A5D6A7', severity: 'none' };
  if (anomaly < 5) return { label: 'Warm (Monitor)', color: '#FFF176', severity: 'low' };
  if (anomaly < 8) return { label: 'Hot (Stress)', color: '#FFB74D', severity: 'medium' };
  return { label: 'Extreme Heat', color: '#EF5350', severity: 'high' };
}

export function computeThermalAnomaly(thermalGrid, baselineTemp) {
  if (!baselineTemp) return null;
  return thermalGrid.map(row =>
    row.map(temp => Math.round((temp - baselineTemp) * 100) / 100)
  );
}