import 'dotenv/config';
import axios from 'axios';

async function test() {
  const bbox = { west: 73.1, south: 18.9, east: 73.2, north: 19.0 };
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const endDate = new Date().toISOString().split('T')[0];

  const filter = [
    "Collection/Name eq 'SENTINEL-2'",
    `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${bbox.west} ${bbox.south},${bbox.east} ${bbox.south},${bbox.east} ${bbox.north},${bbox.west} ${bbox.north},${bbox.west} ${bbox.south}))')`,
    `ContentDate/Start gt ${startDate}T00:00:00.000Z`,
    `ContentDate/Start lt ${endDate}T23:59:59.999Z`,
  ].join(' and ');

  try {
    const res = await axios.get('https://catalogue.dataspace.copernicus.eu/odata/v1/Products', {
      params: {
        $filter: filter,
        $top: 5,
        $orderby: 'ContentDate/Start desc',
        $expand: 'Attributes',
      },
      timeout: 15000,
    });
    console.log('✅ OData success! Found:', res.data.value?.length);
    for (const p of res.data.value || []) {
      console.log(`- ${p.Name} (${p.ContentDate?.Start})`);
    }
  } catch (err) {
    console.error('❌ OData error:', err.response?.status, err.response?.data || err.message);
  }
}

test();
