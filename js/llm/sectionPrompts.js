import { normalizeAssetMeta } from '../intake/arcgisClient.js';

export const STATEMENT_SECTIONS = [
  {
    id: 'context',
    title: '1. Site Context & Proposal Scope',
    description: 'Location, spatial buffer, proposal parameters & policy framework',
  },
  {
    id: 'baseline',
    title: '2. Baseline Designated Heritage Assets',
    description: 'Intersecting & nearby NHLE designations, grades & Heritage at Risk',
  },
  {
    id: 'setting',
    title: '3. Setting & Significance Assessment (GPA3)',
    description: 'Historic England GPA3 5-step setting contribution & visual impact',
  },
  {
    id: 'archaeology_policy',
    title: '4. Archaeological Potential & Policy Conclusions',
    description: 'ADS grey literature synthesis, NPPF balance & mitigation recommendations',
  },
];

const SYSTEM_GROUNDING_RULES = [
  'You are a senior UK heritage planning consultant drafting one section of a Desk-Based Heritage Statement.',
  'STRICT RULES:',
  '- Rely EXCLUSIVELY on the JSON evidence provided. NEVER invent List Entry numbers, dates, asset names, or historical claims.',
  '- Cite exact List Entry numbers (e.g. List Entry 1011234), designation grades, and distances in metres from the JSON.',
  '- Apply current English planning policy principles under the National Planning Policy Framework (NPPF, August 2026) and Historic England Good Practice Advice in Planning Note 3 (GPA3: The Setting of Heritage Assets). Do not cite obsolete pre-2026 NPPF paragraph numbers.',
  '- Keep each section focused and concise (300–450 words) in authoritative British English planning prose using Markdown subheadings and bullet points where helpful.',
].join('\n');

export function buildGroundedContext(screeningData, proposal) {
  const { siteFeature, bufferMeters, assets, sensitivity } = screeningData;
  const centroid = turf.centroid(siteFeature).geometry.coordinates;
  const areaHa =
    siteFeature.geometry.type === 'Polygon' || siteFeature.geometry.type === 'MultiPolygon'
      ? Number((turf.area(siteFeature) / 10000).toFixed(3))
      : null;

  const normalized = (assets || []).map((f) => normalizeAssetMeta(f));

  const designated = normalized
    .filter((a) => !a.isResearchReport)
    .slice(0, 15)
    .map((a) => ({
      name: a.name,
      category: a.category,
      listEntry: a.listEntry,
      grade: a.grade,
      intersectsSite: a.intersects,
      distanceMeters: a.distanceMeters,
      heritageAtRisk: a.isHeritageAtRisk,
      condition: a.condition,
      priority: a.priorityCategory,
    }));

  const adsReports = normalized
    .filter((a) => a.isResearchReport)
    .slice(0, 8)
    .map((r) => ({
      title: r.name,
      doiOrId: r.listEntry,
      authors: r.authors,
      year: r.year,
      type: r.reportType,
      distanceMeters: r.distanceMeters,
    }));

  return {
    proposal: {
      projectTitle:
        proposal.title?.trim() ||
        siteFeature.properties?.label ||
        'Proposed Development Site',
      schemeType: proposal.type,
      scaleAndMassing: proposal.scale?.trim() || 'Not specified',
      settingAndDesignNotes: proposal.notes?.trim() || 'None provided',
    },
    spatialScreening: {
      centroidLatLon: [Number(centroid[1].toFixed(5)), Number(centroid[0].toFixed(5))],
      geometryType: siteFeature.geometry.type,
      siteAreaHectares: areaHa,
      bufferRadiusMeters: bufferMeters,
      overallSensitivityRating: sensitivity,
      totalDesignatedInBuffer: normalized.filter((a) => !a.isResearchReport).length,
      intersectingCount: normalized.filter((a) => !a.isResearchReport && a.intersects).length,
      heritageAtRiskCount: normalized.filter((a) => a.isHeritageAtRisk).length,
      adsReportsCount: normalized.filter((a) => a.isResearchReport).length,
    },
    designatedAssets: designated,
    adsGreyLiterature: adsReports,
  };
}

export function buildSectionPrompt(sectionId, groundedContext) {
  const jsonBlock = `\`\`\`json\n${JSON.stringify(groundedContext, null, 2)}\n\`\`\``;

  const instructionsBySection = {
    context: `Draft "## 1. Site Context & Proposal Scope". Summarise the site location (WGS84 centroid), boundary type/area, the ${groundedContext.spatialScreening.bufferRadiusMeters}m screening study area, the proposed development parameters (${groundedContext.proposal.schemeType}), and the governing NPPF historic environment and Historic England GPA3 framework.`,
    baseline: `Draft "## 2. Baseline Designated Heritage Assets". Present a structured summary of all intersecting and buffered designated heritage assets in the JSON, explicitly citing their exact names, categories, grades, List Entry numbers, distances in metres, and any Heritage at Risk status/condition. If zero designated assets exist in the buffer, state that clearly.`,
    setting: `Draft "## 3. Setting & Significance Assessment (GPA3)". Apply Historic England GPA3 (Step 1: identify affected assets; Step 2: assess how setting contributes to significance; Step 3: assess the effect of the proposed scheme on setting) to the highest-significance and closest assets in the JSON, factoring in the proposed scale/massing and site notes.`,
    archaeology_policy: `Draft "## 4. Archaeological Potential & Policy Conclusions". Synthesise the Archaeology Data Service (ADS) grey literature reports in the JSON to comment on known archaeological interventions in the vicinity, state the overall heritage sensitivity conclusion under current NPPF historic environment principles, and recommend proportionate next steps (e.g. Local HER consultation, WSI, or Heritage Statement verification).`,
  };

  return {
    systemPrompt: SYSTEM_GROUNDING_RULES,
    userPrompt: `${instructionsBySection[sectionId]}\n\nScreened Evidence JSON:\n${jsonBlock}`,
  };
}