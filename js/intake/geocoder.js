/**
 * Resolves UK postcodes (postcodes.io), place names (Nominatim GB),
 * or raw "lat, lon" coordinates into a WGS84 GeoJSON Point.
 */
export async function geocodeQuery(rawQuery) {
  const query = rawQuery.trim();
  if (!query) throw new Error('Enter a UK postcode, town, or coordinates.');

  // 1. Raw WGS84 lat, lon
  const coordMatch = query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lon = Number(coordMatch[2]);
    if (lat >= 49 && lat <= 61 && lon >= -9 && lon <= 3) {
      return turf.point([lon, lat], { label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    }
  }

  // 2. UK Postcode via postcodes.io
  const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  if (ukPostcodeRegex.test(query)) {
    const clean = query.replace(/\s+/g, '');
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.result) {
        return turf.point([data.result.longitude, data.result.latitude], {
          label: `${data.result.postcode} (${data.result.admin_district || 'UK'})`,
        });
      }
    }
  }

  // 3. Place / street search via OpenStreetMap Nominatim (restricted to GB)
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=gb&limit=1&q=${encodeURIComponent(query)}`;
  const nomRes = await fetch(nomUrl, {
    headers: { Accept: 'application/json' },
  });
  if (nomRes.ok) {
    const results = await nomRes.json();
    if (results.length > 0) {
      const hit = results[0];
      return turf.point([Number(hit.lon), Number(hit.lat)], {
        label: hit.display_name.split(',').slice(0, 3).join(', '),
      });
    }
  }

  throw new Error(`No UK location found for "${query}"`);
}