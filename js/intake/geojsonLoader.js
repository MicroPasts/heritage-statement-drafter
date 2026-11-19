import { screenSiteDirectly } from './arcgisClient.js';

/**
 * Parses either:
 * 1. A multi-feature GeoJSON exported from Heritage Constraints Screener
 * 2. A raw site boundary GeoJSON Feature / FeatureCollection
 */
export async function loadScreenerOrBoundaryGeoJSON(rawText, fallbackBufferMeters = 500) {
  const parsed = JSON.parse(rawText);

  if (parsed.type === 'Feature') {
    return screenSiteDirectly(parsed, fallbackBufferMeters);
  }

  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features) || parsed.features.length === 0) {
    throw new Error('GeoJSON contains no valid features.');
  }

  // Detect Screener export structure (_role === 'site' or 'buffer' or _category)
  const siteFeature =
    parsed.features.find((f) => f.properties?._role === 'site') ||
    parsed.features.find((f) => !f.properties?._category && f.properties?._role !== 'buffer');

  const bufferFeature = parsed.features.find((f) => f.properties?._role === 'buffer');
  const assetFeatures = parsed.features.filter(
    (f) => f !== siteFeature && f !== bufferFeature && Boolean(f.properties?._category)
  );

  // If this came straight from Heritage Constraints Screener with assets intact, reuse them directly
  if (siteFeature && assetFeatures.length > 0) {
    const bufferMeters =
      bufferFeature?.properties?.bufferMeters ||
      siteFeature.properties?.bufferMeters ||
      fallbackBufferMeters;

    const buffered =
      bufferFeature || turf.buffer(siteFeature, bufferMeters / 1000, { units: 'kilometers' });

    const hasIntersection = assetFeatures.some((a) => a.properties?._intersects);
    const sensitivity = hasIntersection
      ? 'High (Direct Intersection)'
      : 'Moderate–High (Imported Screener Dataset)';

    return {
      siteFeature,
      buffered,
      bufferMeters,
      assets: assetFeatures,
      sensitivity,
      importedFromScreener: true,
    };
  }

  // Otherwise treat the first feature as a red-line site boundary and screen it live
  const boundary = siteFeature || parsed.features[0];
  return screenSiteDirectly(boundary, fallbackBufferMeters);
}