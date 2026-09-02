import axios from 'axios';

// ─── Copernicus Data Space Ecosystem API ──────────────────────────────────
// Docs: https://documentation.dataspace.copernicus.eu/
// Auth: OAuth2 client_credentials flow
// Search: OData API for scene discovery
// Processing: OGC Processing API for on-the-fly band computation

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const ODATA_BASE = 'https://catalogue.dataspace.copernicus.eu/odata/v1';
const PROCESSING_BASE = 'https://sh.dataspace.copernicus.eu/ogc/process';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Get or refresh the OAuth2 access token for Copernicus API.
 * Tokens last ~600 seconds; we cache with a 5-minute buffer.
 */
async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 300_000) {
    return cachedToken;
  }

  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Copernicus credentials not configured. Set COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET in .env. ' +
      'Register free at https://dataspace.copernicus.eu/'
    );
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const { data } = await axios.post(TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });

  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 600) * 1000;

  return cachedToken;
}

/**
 * Search for Sentinel-2 scenes covering a bounding box.
 * Returns array of scene metadata sorted by cloud cover ascending.
 *
 * @param {Object} bbox - { west, south, east, north } in degrees
 * @param {Date} startDate - Start of search window
 * @param {Date} endDate - End of search window
 * @param {Object} options - { maxCloudCover, maxResults }
 * @returns {Promise<Array>} Scene metadata
 */
export async function searchSentinel2Scenes(bbox, startDate, endDate, options = {}) {
  const { maxCloudCover = 40, maxResults = 5 } = options;

  const formatDate = (d) => d.toISOString().split('T')[0];
  const filter = [
    `Collection/Name eq 'SENTINEL-2'`,
    `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${bbox.west} ${bbox.south},${bbox.east} ${bbox.south},${bbox.east} ${bbox.north},${bbox.west} ${bbox.north},${bbox.west} ${bbox.south}))')`,
    `ContentDate/Start gt ${formatDate(startDate)}T00:00:00.000Z`,
    `ContentDate/Start lt ${formatDate(endDate)}T23:59:59.999Z`,
    `Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq 'S2MSI2A')`,
    `Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt ${maxCloudCover})`,
  ].join(' and ');

  const { data } = await axios.get(`${ODATA_BASE}/Products`, {
    params: {
      $filter: filter,
      $orderby: 'Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq \'cloudCover\' and att/OData.CSC.DoubleAttribute/Value) asc',
      $top: maxResults,
      $expand: 'Attributes',
    },
    timeout: 30_000,
  });

  return (data.value || []).map(scene => ({
    id: scene.Id,
    name: scene.Name,
    cloudCover: extractAttribute(scene.Attributes, 'cloudCover'),
    orbitNumber: extractAttribute(scene.Attributes, 'orbitNumber'),
    beginPosition: scene.ContentDate?.Start,
    endPosition: scene.ContentDate?.End,
    productType: extractAttribute(scene.Attributes, 'productType'),
  }));
}

/**
 * Search for Landsat 8/9 scenes covering a bounding box.
 * Returns array of scene metadata sorted by cloud cover ascending.
 */
export async function searchLandsatScenes(bbox, startDate, endDate, options = {}) {
  const { maxCloudCover = 30, maxResults = 5 } = options;

  const formatDate = (d) => d.toISOString().split('T')[0];
  const filter = [
    `Collection/Name eq 'LANDSAT-OLI-TIRS-C2L2'`,
    `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${bbox.west} ${bbox.south},${bbox.east} ${bbox.south},${bbox.east} ${bbox.north},${bbox.west} ${bbox.north},${bbox.west} ${bbox.south}))')`,
    `ContentDate/Start gt ${formatDate(startDate)}T00:00:00.000Z`,
    `ContentDate/Start lt ${formatDate(endDate)}T23:59:59.999Z`,
    `Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt ${maxCloudCover})`,
  ].join(' and ');

  const { data } = await axios.get(`${ODATA_BASE}/Products`, {
    params: {
      $filter: filter,
      $orderby: 'Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq \'cloudCover\' and att/OData.CSC.DoubleAttribute/Value) asc',
      $top: maxResults,
      $expand: 'Attributes',
    },
    timeout: 30_000,
  });

  return (data.value || []).map(scene => ({
    id: scene.Id,
    name: scene.Name,
    cloudCover: extractAttribute(scene.Attributes, 'cloudCover'),
    beginPosition: scene.ContentDate?.Start,
    endPosition: scene.ContentDate?.End,
  }));
}

/**
 * Get an OAuth token for the Processing API.
 * Processing uses a different token endpoint.
 */
export async function getProcessingToken() {
  // The Processing API uses the same identity provider
  return getToken();
}

/**
 * Execute a processing request against the Copernicus OGC Processing API.
 * Used for NDVI/NDRE/LST computation from raw bands.
 *
 * @param {Object} requestBody - OGC Processing API request body
 * @returns {Promise<ArrayBuffer>} Binary response (GeoTIFF or JSON)
 */
export async function executeProcessingRequest(requestBody) {
  const token = await getToken();

  const { data } = await axios.post(
    `${PROCESSING_BASE}`,
    requestBody,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 120_000, // Processing can take a while
      responseType: 'arraybuffer',
    }
  );

  return data;
}

/**
 * Extract an attribute value from the Copernicus Attributes array.
 * Format: { '@odata.type': '#OData.CSC.DoubleAttribute', Name: 'cloudCover', Value: 14.24 }
 */
function extractAttribute(attributes, name) {
  if (!attributes) return null;
  const attr = attributes.find(a => a.Name === name);
  if (!attr) return null;
  return attr.Value ?? null;
}

/**
 * Build a GeoJSON polygon from bounding box.
 */
export function bboxToGeoJSON(bbox) {
  return {
    type: 'Polygon',
    coordinates: [[
      [bbox.west, bbox.south],
      [bbox.east, bbox.south],
      [bbox.east, bbox.north],
      [bbox.west, bbox.north],
      [bbox.west, bbox.south],
    ]],
  };
}

/**
 * Compute bounding box from various geometry formats:
 * - GeoJSON Polygon: { type: 'Polygon', coordinates: [[[lng, lat], ...]] }
 * - Array of [lng, lat] pairs: [[73.1, 19.0], [73.2, 19.0], ...]
 * - Array of {lat, lng} objects: [{lat: 19.0, lng: 73.1}, ...]
 * - Farm document with boundary or polygon fields
 */
export function computeBBox(geometry) {
  if (!geometry) return null;

  let coords = null;

  // GeoJSON Polygon
  if (geometry.type === 'Polygon' && geometry.coordinates?.length > 0) {
    coords = geometry.coordinates[0];
  }
  // Array of [lng, lat] pairs
  else if (Array.isArray(geometry) && geometry.length >= 3) {
    // Check first element format
    const first = geometry[0];
    if (Array.isArray(first)) {
      coords = geometry; // [[lng, lat], ...]
    } else if (first && typeof first === 'object' && 'lat' in first && 'lng' in first) {
      // [{lat, lng}] objects — convert to [lng, lat]
      coords = geometry.map(p => [p.lng, p.lat]);
    }
  }
  // Object with boundary.coordinates (from farm document)
  else if (geometry.boundary?.coordinates?.length > 0) {
    coords = geometry.boundary.coordinates[0];
  }
  // Object with polygon array (from farm document)
  else if (geometry.polygon?.length >= 3) {
    const first = geometry.polygon[0];
    if (Array.isArray(first)) {
      coords = geometry.polygon;
    } else if (first && typeof first === 'object' && 'lat' in first && 'lng' in first) {
      coords = geometry.polygon.map(p => [p.lng, p.lat]);
    }
  }

  if (!coords || coords.length < 3) return null;

  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of coords) {
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  if (west === Infinity) return null; // no valid coords found

  // Add a small buffer (0.001 degrees ~ 100m) for edge cases
  const buffer = 0.001;
  return {
    west: west - buffer,
    south: south - buffer,
    east: east + buffer,
    north: north + buffer,
  };
}
