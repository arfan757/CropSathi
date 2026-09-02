import axios from 'axios';
import { fromArrayBuffer } from 'geotiff';
import { computeBBox } from './copernicusClient.js';

// ─── Sentinel-2 NDVI/NDRE Service ────────────────────────────────────────
// Uses Copernicus Sentinel Hub Process API to compute per-pixel NDVI and NDRE
// from Sentinel-2 Level-2A (atmospherically corrected) imagery.
//
// NDVI = (B08 - B04) / (B08 + B04)  — Near-Infrared / Red
// NDRE = (B08 - B05) / (B08 + B05)  — Near-Infrared / Red Edge
//
// Resolution: 10m per pixel (Sentinel-2 native)
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
 * Compute NDVI/NDRE grids for a farm from Sentinel-2 data.
 *
 * @param {Object} farm - Farm document with boundary/centroid
 * @param {Object} options - { startDate, endDate, maxCloudCover }
 * @returns {Promise<Object>} { ndviGrid, ndreGrid, sceneInfo, observedAt }
 */
export async function fetchSentinelNdvi(farm, options = {}) {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    maxCloudCover = 40,
  } = options;

  // computeBBox handles GeoJSON, [{lat,lng}], and farm documents
  const bbox = computeBBox(farm);
  if (!bbox) throw new Error('Farm has no boundary geometry for satellite query');

  const token = await getToken();

  // Request both NDVI and NDRE in a single evalscript (4 bands: ndvi, ndre, b8, b4)
  const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B05", "B08", "dataMask"],
    output: { bands: 4, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const sum84 = sample.B08 + sample.B04;
  const sum85 = sample.B08 + sample.B05;
  const ndvi = sum84 === 0 ? 0 : (sample.B08 - sample.B04) / sum84;
  const ndre = sum85 === 0 ? 0 : (sample.B08 - sample.B05) / sum85;
  return [ndvi, ndre, sample.B08, sample.B04];
}`;

  const request = {
    input: {
      bounds: {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{
        type: 'sentinel-2-l2a',
        dataFilter: {
          timeRange: { from: startDate.toISOString(), to: endDate.toISOString() },
          maxCloudCover,
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

    // Parse TIFF using geotiff library (handles compression, endianness)
    // Convert Node.js Buffer to proper ArrayBuffer for geotiff
    const buf = Buffer.from(resp.data);
    const arrayBuffer = new ArrayBuffer(buf.length);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];
    const pixels = await parseTiffWithGeotiff(arrayBuffer);

    // Extract NDVI (band 0) and NDRE (band 1) grids
    // The TIFF has 4 bands interleaved: [ndvi, ndre, b8, b4, ndvi, ndre, b8, b4, ...]
    const ndviGrid = [];
    const ndreGrid = [];

    for (let row = 0; row < GRID_SIZE; row++) {
      const ndviRow = [];
      const ndreRow = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const idx = (row * GRID_SIZE + col) * 4; // 4 bands per pixel
        const ndvi = pixels[idx] ?? 0.5;
        const ndre = pixels[idx + 1] ?? 0.4;
        ndviRow.push(Math.max(-0.1, Math.min(0.95, Math.round(ndvi * 1000) / 1000)));
        ndreRow.push(Math.max(-0.1, Math.min(0.95, Math.round(ndre * 1000) / 1000)));
      }
      ndviGrid.push(ndviRow);
      ndreGrid.push(ndreRow);
    }

    // Extract scene metadata from response headers
    const sceneDate = resp.headers['sentinel-data-date'] || startDate.toISOString();

    return {
      ndviGrid,
      ndreGrid,
      sceneInfo: {
        sceneId: `sentinel-${Date.now()}`,
        sceneName: `Sentinel-2 L2A`,
        cloudCover: maxCloudCover,
        source: 'sentinel-2',
      },
      observedAt: new Date(sceneDate),
    };
  } catch (error) {
    console.warn('Sentinel-2 Processing API failed, using fallback:', error.message);
    return {
      ndviGrid: generateFallbackGrid('NDVI'),
      ndreGrid: generateFallbackGrid('NDRE'),
      sceneInfo: { sceneId: null, sceneName: 'Simulated', cloudCover: 0, source: 'simulated' },
      observedAt: new Date(),
    };
  }
}

// ─── TIFF Parser ──────────────────────────────────────────────────────────

/**
 * Parse a TIFF file using geotiff library.
 * Handles compression, endianness, and multi-band data automatically.
 *
 * @param {ArrayBuffer} buffer - Raw TIFF data
 * @returns {Promise<Array<number>>} Flat array of Float32 values in band-interleaved order
 */
async function parseTiffWithGeotiff(buffer) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const numBands = image.getSamplesPerPixel();

  // Read bands separately (more reliable than interleave)
  const bands = await image.readRasters({ interleave: false });

  // Convert to band-interleaved Float32 array:
  // [pixel0_band0, pixel0_band1, ..., pixel1_band0, pixel1_band1, ...]
  const pixels = new Float32Array(width * height * numBands);
  for (let b = 0; b < numBands; b++) {
    const band = bands[b];
    for (let i = 0; i < band.length; i++) {
      pixels[i * numBands + b] = band[i];
    }
  }

  return Array.from(pixels);
}

// ─── Fallback Grid ────────────────────────────────────────────────────────

function generateFallbackGrid(indexType) {
  const baseValue = indexType === 'NDVI' ? 0.55 : 0.45;
  const grid = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    const rowData = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const cx = (col - GRID_SIZE / 2) / GRID_SIZE;
      const cy = (row - GRID_SIZE / 2) / GRID_SIZE;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const noise = (Math.random() - 0.5) * 0.15;
      const value = baseValue + noise - dist * 0.1;
      rowData.push(Math.max(-0.1, Math.min(0.95, Math.round(value * 1000) / 1000)));
    }
    grid.push(rowData);
  }
  return grid;
}

// ─── Utilities ────────────────────────────────────────────────────────────

export function computeGridDelta(newGrid, oldGrid) {
  if (!oldGrid) return null;
  return newGrid.map((row, r) =>
    row.map((val, c) => {
      const old = oldGrid[r]?.[c] ?? val;
      return Math.round((val - old) * 1000) / 1000;
    })
  );
}

export function classifyNdvi(value) {
  if (value < 0.1) return { label: 'Water / Cloud', color: '#1565C0', severity: 'none' };
  if (value < 0.2) return { label: 'Bare Soil', color: '#D32F2F', severity: 'high' };
  if (value < 0.3) return { label: 'Very Low Vigor', color: '#E64A19', severity: 'high' };
  if (value < 0.4) return { label: 'Low Vigor', color: '#F57C00', severity: 'medium' };
  if (value < 0.5) return { label: 'Moderate Vigor', color: '#FBC02D', severity: 'low' };
  if (value < 0.6) return { label: 'Growing', color: '#C0CA33', severity: 'none' };
  if (value < 0.7) return { label: 'Healthy', color: '#7CB342', severity: 'none' };
  if (value < 0.8) return { label: 'High Vigor', color: '#43A047', severity: 'none' };
  return { label: 'Dense Canopy', color: '#2E7D32', severity: 'none' };
}

export function classifyNdre(value) {
  if (value < 0.1) return { label: 'Water / Cloud', color: '#1565C0', severity: 'none' };
  if (value < 0.2) return { label: 'Bare / Stressed', color: '#8D6E63', severity: 'high' };
  if (value < 0.3) return { label: 'Low Chlorophyll', color: '#A1887F', severity: 'high' };
  if (value < 0.4) return { label: 'Moderate Chlorophyll', color: '#FDD835', severity: 'medium' };
  if (value < 0.5) return { label: 'Developing', color: '#C0CA33', severity: 'low' };
  if (value < 0.6) return { label: 'Good', color: '#8BC34A', severity: 'none' };
  if (value < 0.7) return { label: 'High Chlorophyll', color: '#558B2F', severity: 'none' };
  return { label: 'Dense Active Canopy', color: '#1B5E20', severity: 'none' };
}
