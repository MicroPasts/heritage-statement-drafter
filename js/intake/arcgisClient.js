import { HERITAGE_LAYERS } from '../config/services.js';

/**
 * Normalizes disparate Historic England, Heritage at Risk, and ADS schemas.
 */
export function normalizeAssetMeta(feature) {
  const p = feature.properties || {};
  const isResearchReport =
    p._layerId === 'ads-records' ||
    p._layerId === 'research-reports' ||
    Boolean(p.Report_Num || p.Report_title);

  const isHeritageAtRisk =
    p._category === 'Heritage at Risk' ||
    Boolean(p.Condition || p.CurrentCondition || p.Vulnerability || p.PriorityCategory);

  const name =
    p.BuildingName ||
    p.BUILDINGNAME ||
    p.Building_Name ||
    p.MonumentName ||
    p.MONUMENTNAME ||
    p.EntryName ||
    p.ENTRYNAME ||
    p.Name ||
    p.NAME ||
    p.SiteName ||
    p.SITE_NAME ||
    p.Report_title ||
    p.TITLE ||
    p.Title ||
    'Unnamed Heritage Asset';

  const listEntry =
    p.ListEntry ||
    p.LISTENTRY ||
    p.HAR_ID ||
    p.HARId ||
    p.EntryNumber ||
    p.Report_Num ||
    p.UID ||
    null;

  const grade = p.Grade || p.GRADE || null;

  const hyperlink =
    p.Hyperlink ||
    p.HYPERLINK ||
    p.Report_URL ||
    p.URL ||
    (listEntry && /^\d+$/.test(String(listEntry)) && !isResearchReport
      ? `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}`
      : null);

  return {
    name: String(name).trim(),
    category: p._category || 'Heritage Constraint',
    isResearchReport,
    isHeritageAtRisk,
    listEntry: listEntry ? String(listEntry).trim() : null,
    grade: grade ? `Grade ${grade}` : null,
    distanceMeters: p._distanceMeters ?? null,
    intersects: Boolean(p._intersects),
    hyperlink,
    condition: p.Condition || p.CONDITION || p.CurrentCondition || null,
    priorityCategory: p.PriorityCategory || p.PRIORITYCATEGORY || p.Priority || null,
    authors: p.Author_s_ ? String(p.Author_s_).trim() : null,
    year: p.Year ? String(Math.round(Number(p.Year))) : null,
    reportType: p.Simple_Report_type || p.Project_type || null,
    localAuthority: p.LocalAuthority || p.LPA || p.District || null,
  };
}

/**
 * Queries Historic England ArcGIS layers + ADS DataCite records around a site feature.
 */
export async function screenSiteDirectly(siteFeature, bufferMeters = 500) {
  const buffered = turf.buffer(siteFeature, bufferMeters / 1000, { units: 'kilometers' });
  const bbox = turf.bbox(buffered);
  const geometryEnvelope = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;

  const layerPromises = HERITAGE_LAYERS.map(async (layer) => {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      geometry: geometryEnvelope,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      resultRecordCount: '100',
    });

    try {
      const res = await fetch(`${layer.url}/query?${params.toString()}`);
      if (!res.ok) return [];
      const fc = await res.json();
      return (fc.features || []).map((f) => {
        f.properties = {
          ...(f.properties || {}),
          _layerId: layer.id,
          _category: layer.category,
          _color: layer.color,
        };
        return f;
      });
    } catch {
      return [];
    }
  });

  // Query ADS Grey Literature via DataCite REST API using bounding box
  const adsPromise = (async () => {
    try {
      const url = `https://api.datacite.org/dois?client-id=bl.ads&page[size]=15&query=geoLocations.geoLocationBox.westBoundLongitude:[${bbox[0] - 0.02}+TO+${bbox[2] + 0.02}]+AND+geoLocations.geoLocationBox.southBoundLatitude:[${bbox[1] - 0.02}+TO+${bbox[3] + 0.02}]`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || [])
        .map((item) => {
          const attr = item.attributes || {};
          const box = attr.geoLocations?.[0]?.geoLocationBox;
          const pt = attr.geoLocations?.[0]?.geoLocationPoint;
          let coords = null;
          if (pt?.pointLongitude && pt?.pointLatitude) {
            coords = [Number(pt.pointLongitude), Number(pt.pointLatitude)];
          } else if (box) {
            coords = [
              (Number(box.westBoundLongitude) + Number(box.eastBoundLongitude)) / 2,
              (Number(box.southBoundLatitude) + Number(box.northBoundLatitude)) / 2,
            ];
          }
          if (!coords || Number.isNaN(coords[0])) return null;
          return turf.point(coords, {
            _layerId: 'ads-records',
            _category: 'ADS Grey Literature',
            _color: '#4f46e5',
            Report_title: attr.titles?.[0]?.title || item.id,
            Report_Num: item.id,
            Author_s_: (attr.creators || []).map((c) => c.name).join('; '),
            Year: attr.publicationYear,
            Simple_Report_type: attr.types?.resourceType || 'Grey Literature Report',
            Report_URL: attr.url || `https://doi.org/${item.id}`,
          });
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  })();

  const [layerArrays, adsFeatures] = await Promise.all([
    Promise.all(layerPromises),
    adsPromise,
  ]);

  const rawFeatures = [...layerArrays.flat(), ...adsFeatures];
  const siteCenter = turf.centroid(siteFeature);

  // Filter strictly to buffer circle and compute exact distances & intersections
  const screenedAssets = [];
  for (const feat of rawFeatures) {
    if (!feat.geometry) continue;
    const intersects = turf.booleanIntersects(siteFeature, feat);
    const inBuffer = intersects || turf.booleanIntersects(buffered, feat);
    if (!inBuffer) continue;

    let distanceMeters = 0;
    if (!intersects) {
      const featCenter = turf.centroid(feat);
      distanceMeters = Math.round(
        turf.distance(siteCenter, featCenter, { units: 'meters' })
      );
    }

    feat.properties._intersects = intersects;
    feat.properties._distanceMeters = distanceMeters;
    screenedAssets.push(feat);
  }

  screenedAssets.sort((a, b) => {
    if (a.properties._intersects !== b.properties._intersects) {
      return a.properties._intersects ? -1 : 1;
    }
    return (a.properties._distanceMeters ?? 0) - (b.properties._distanceMeters ?? 0);
  });

  const sensitivity = computeSensitivity(screenedAssets);

  return {
    siteFeature,
    buffered,
    bufferMeters,
    assets: screenedAssets,
    sensitivity,
  };
}

function computeSensitivity(assets) {
  const designated = assets.filter((a) => a.properties?._layerId !== 'ads-records');
  if (designated.some((a) => a.properties?._intersects)) return 'High (Direct Intersection)';
  if (
    designated.some((a) =>
      ['Scheduled Monuments', 'World Heritage Sites', 'Heritage at Risk'].includes(
        a.properties?._category
      )
    )
  ) {
    return 'High (Statutory Setting)';
  }
  if (designated.length > 0) return 'Moderate (Buffered Setting)';
  return 'Low (No Designated Assets in Buffer)';
}