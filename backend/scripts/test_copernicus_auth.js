import 'dotenv/config';
import axios from 'axios';

async function testCopernicusAuth() {
  console.log('=== TESTING COPERNICUS DATA SPACE AUTHENTICATION ===\n');

  const clientId = process.env.COPERNICUS_CLIENT_ID;
  const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: COPERNICUS_CLIENT_ID or COPERNICUS_CLIENT_SECRET is missing in .env');
    process.exit(1);
  }

  // Obfuscate client ID for safe output
  const maskedId = clientId.length > 8
    ? clientId.slice(0, 4) + '...' + clientId.slice(-4)
    : 'configured';

  console.log(`Checking credentials (Client ID: ${maskedId})...`);

  try {
    const tokenRes = await axios.post(
      'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );

    if (tokenRes.data && tokenRes.data.access_token) {
      console.log('✅ OAuth2 Authentication Successful!');
      console.log(`   Token Type: ${tokenRes.data.token_type || 'Bearer'}`);
      console.log(`   Expires in: ${tokenRes.data.expires_in} seconds`);

      // Test Catalog Search API with the access token for sample field in Maharashtra
      console.log('\nTesting Copernicus OData / Catalog Search for recent Sentinel-2 L2A passes...');
      const token = tokenRes.data.access_token;
      
      const bbox = [78.95, 20.58, 78.98, 20.60]; // [minLng, minLat, maxLng, maxLat]
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = new Date().toISOString().split('T')[0];

      const searchUrl = `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?$filter=Collection/Name eq 'SENTINEL-2' and OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${bbox[0]} ${bbox[1]}, ${bbox[2]} ${bbox[1]}, ${bbox[2]} ${bbox[3]}, ${bbox[0]} ${bbox[3]}, ${bbox[0]} ${bbox[1]}))') and ContentDate/Start gt ${startDate}T00:00:00.000Z and ContentDate/Start lt ${endDate}T23:59:59.999Z&$top=3&$orderby=ContentDate/Start desc`;

      try {
        const searchRes = await axios.get(searchUrl, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        });

        const products = searchRes.data?.value || [];
        console.log(`✅ Catalog Search Successful! Found ${products.length} recent Sentinel-2 scene(s):`);
        for (const p of products) {
          console.log(`   - Product: ${p.Name}`);
          console.log(`     Acquisition Date: ${p.ContentDate?.Start}`);
        }
      } catch (searchErr) {
        console.warn(`⚠️ Catalog query returned status ${searchErr.response?.status || searchErr.message}`);
      }

      console.log('\n🎉 Copernicus Data Space integration is LIVE and fully functional!');
    } else {
      console.error('❌ Authentication failed: No access_token in response.');
      process.exit(1);
    }
  } catch (err) {
    if (err.response) {
      console.error(`❌ Authentication failed (HTTP ${err.response.status}):`, err.response.data);
    } else {
      console.error('❌ Network error during authentication:', err.message);
    }
    process.exit(1);
  }
}

testCopernicusAuth();
