import axios from 'axios';
import { fromArrayBuffer } from 'geotiff';
import { computeBBox } from './copernicusClient.js';

// ─── Landsat 8/9 Thermal LST Service ─────────────────────────────────────
// Uses Copernicus Sentinel Hub Process API to extract Land Surface Temperature
// from Landsat 8/9 Band 10 (TIRS) at 100m resolution.
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
    startDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    maxCloudCoverage = 30,
  } = options;

  const bbox = computeBBox(farm);
  if (!bbox) throw new Error('Farm has no boundary geometry for satellite query');

  const token = await getToken();

  // Evalscript for Landsat 8/9 Collection 2 Level-2
  // B10 = Thermal Infrared (TIRS) 1, surface temperature
  const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B10", "dataMask"],
    output: { bands: 2, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0];
  // Landsat C2L2 B10 is in Kelvin — convert to Celsius
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
        type: 'landsat-ot-l2',
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

    // Extract LST grid (band 0 = temperature in Celsius)
    const thermalGrid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      const rowData = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const idx = (row * GRID_SIZE + col) * 2; // 2 bands per pixel
        const lstC = pixels[idx] ?? 30;
        rowData.push(Math.round(lstC * 100) / 100);
      }
      thermalGrid.push(rowData);
    }

    const sceneDate = resp.headers['landsat-data-date'] || startDate.toISOString();

    return {
      thermalGrid,
      sceneInfo: {
        sceneId: `landsat-${Date.now()}`,
        sceneName: 'Landsat 8/9 C2L2',
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
