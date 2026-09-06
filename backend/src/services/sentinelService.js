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
 * Uses a progressive retry strategy: tries a 90-day window first, then
 * widens to 120 and 180 days if all pixels are cloud-masked. This handles
 * monsoon regions (e.g. Maharashtra Jun–Sep) where 45-day windows can
 * have every scene fully cloudy.
 *
 * @param {Object} farm - Farm document with boundary/centroid
 * @param {Object} options - { startDate, endDate, maxCloudCover }
 * @returns {Promise<Object>} { ndviGrid, ndreGrid, sceneInfo, observedAt }
 */
export async function fetchSentinelNdvi(farm, options = {}) {
  const {
    endDate = new Date(),
    maxCloudCover = 90,
  } = options;

  // Progressive retry: 90 → 120 → 180 days
  const RETRY_WINDOWS = [90, 120, 180];
  let lastError = null;

  for (const days of RETRY_WINDOWS) {
    const startDate = options.startDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const result = await fetchSentinelNdviOnce(farm, { startDate, endDate, maxCloudCover });
      if (result.sceneInfo?.source !== 'simulated') {
        console.log(`Sentinel-2: found clear scene in ${days}-day window`);
        return result;
      }
      // All pixels masked — store error and try wider window
      lastError = new Error(`All ${days}-day window pixels cloud-masked`);
      console.warn(`Sentinel-2: ${days}-day window fully cloud-masked, trying wider window...`);
    } catch (e) {
      lastError = e;
      console.warn(`Sentinel-2: ${days}-day window failed: ${e.message}, trying wider...`);
    }
  }

  // All windows exhausted — return simulated fallback
  console.warn('Sentinel-2: all search windows exhausted, using simulated fallback');
  return {
    ndviGrid: generateFallbackGrid('NDVI'),
    ndreGrid: generateFallbackGrid('NDRE'),
    sceneInfo: { sceneId: null, sceneName: 'Simulated', cloudCover: 100, source: 'simulated' },
    observedAt: new Date(),
  };
}

/**
 * Single attempt at fetching Sentinel-2 NDVI. Throws on API error or
 * returns a simulated fallback if all pixels are cloud-masked.
 */
async function fetchSentinelNdviOnce(farm, { startDate, endDate, maxCloudCover }) {

  // computeBBox handles GeoJSON, [{lat,lng}], and farm documents
  const bbox = computeBBox(farm);
  if (!bbox) throw new Error('Farm has no boundary geometry for satellite query');

  const token = await getToken();

  // Request NDVI, NDRE, and an explicit dataMask band (5 bands total).
  // Uses multi-temporal ORBIT mosaicking with Scene Classification Layer (SCL)
  // filtering to penetrate cloud gaps across orbital passes in the time window.
  // Pixels with cloud/shadow (SCL 1, 3, 8, 9, 10, 11) are rejected in favor of
  // the most recent clear ground observation.
  const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B05", "B08", "SCL", "dataMask"],
    output: { bands: 5, sampleType: "FLOAT32" },
    mosaicking: "ORBIT"
  };
}
function isCloudOrShadow(scl) {
  return scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11;
}
function evaluatePixel(samples) {
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (s.dataMask === 1 && !isCloudOrShadow(s.SCL)) {
      var sum84 = s.B08 + s.B04;
      var sum85 = s.B08 + s.B05;
      var ndvi = sum84 === 0 ? 0 : (s.B08 - s.B04) / sum84;
      var ndre = sum85 === 0 ? 0 : (s.B08 - s.B05) / sum85;
      return [ndvi, ndre, s.B08, s.B04, 1];
    }
  }
  return [0, 0, 0, 0, 0];
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

    // Extract NDVI (band 0), NDRE (band 1), and dataMask (band 4) grids.
    // The TIFF has 5 bands interleaved: [ndvi, ndre, b8, b4, mask, ndvi, ndre, ...]
    // Masked pixels (mask === 0) are emitted as null.
    const ndviGrid = [];
    const ndreGrid = [];

    for (let row = 0; row < GRID_SIZE; row++) {
      const ndviRow = [];
      const ndreRow = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const pixelBase = (row * GRID_SIZE + col) * 5; // 5 bands per pixel
        const ndvi = pixels[pixelBase];
        const ndre = pixels[pixelBase + 1];
        const mask = pixels[pixelBase + 4];
        const valid = mask !== undefined && mask !== 0 && ndvi !== undefined && ndre !== undefined;
        ndviRow.push(valid ? Math.max(-0.1, Math.min(0.95, Math.round(ndvi * 1000) / 1000)) : null);
        ndreRow.push(valid ? Math.max(-0.1, Math.min(0.95, Math.round(ndre * 1000) / 1000)) : null);
      }
      ndviGrid.push(ndviRow);
      ndreGrid.push(ndreRow);
    }

    const validPixelCount = ndviGrid.flat().filter(v => v !== null).length;
    if (validPixelCount === 0) {
      throw new Error('Sentinel-2 scene fully cloud-masked — no valid pixels across search window');
    }

    const cloudCover = Math.round((1 - validPixelCount / (GRID_SIZE * GRID_SIZE)) * 100);
    console.log(`Sentinel-2: ${validPixelCount}/${GRID_SIZE * GRID_SIZE} valid pixels, ${cloudCover}% cloud-masked`);
    // Extract scene metadata from response headers (or use endDate = latest in window)
    const sceneDate = resp.headers['sentinel-data-date'] || endDate.toISOString();

    return {
      ndviGrid,
      ndreGrid,
      sceneInfo: {
        sceneId: `sentinel-${Date.now()}`,
        sceneName: `Sentinel-2 L2A`,
        cloudCover,
        source: 'sentinel-2',
      },
      observedAt: new Date(sceneDate),
    };
  } catch (error) {
    // Re-throw so the outer retry loop can try a wider window or fall back
    throw error;
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
  if (width !== GRID_SIZE || height !== GRID_SIZE) {
    // fetchSentinelNdvi indexes into the flat pixel array assuming a
    // GRID_SIZE x GRID_SIZE layout; a mismatch would silently misalign
    // every pixel read rather than throwing.
    console.warn(`Sentinel-2 response grid is ${width}x${height}, expected ${GRID_SIZE}x${GRID_SIZE} — pixel indexing may be misaligned.`);
  }

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