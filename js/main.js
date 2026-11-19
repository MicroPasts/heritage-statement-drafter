import { initMvpOverlayAndTour } from './ui/onboarding.js';
import { SAMPLE_SITES, HERITAGE_LAYERS } from './config/services.js';
import { geocodeQuery } from './intake/geocoder.js';
import { screenSiteDirectly, normalizeAssetMeta } from './intake/arcgisClient.js';
import { loadScreenerOrBoundaryGeoJSON } from './intake/geojsonLoader.js';
import {
  PROVIDERS,
  fetchOllamaModels,
  streamSectionCompletion,
} from './llm/providerClient.js';
import {
  STATEMENT_SECTIONS,
  buildGroundedContext,
  buildSectionPrompt,
} from './llm/sectionPrompts.js';
import { auditDraftCitations } from './validation/citationAuditor.js';

const studioState = {
  screening: null, // { siteFeature, buffered, bufferMeters, assets, sensitivity }
  drafts: {
    context: '',
    baseline: '',
    setting: '',
    archaeology_policy: '',
  },
  sectionStatus: {
    context: 'idle',
    baseline: 'idle',
    setting: 'idle',
    archaeology_policy: 'idle',
  },
  abortController: null,
};

let activePopup = null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildAssetPopupHtml(props) {
  const meta = normalizeAssetMeta({ properties: props });
  const badgeColor = props._color || '#d97706';

  const distanceText = meta.intersects
    ? '<span class="text-rose-700 font-semibold">Intersects Site</span>'
    : meta.distanceMeters !== null
      ? `${meta.distanceMeters} m from site`
      : '';

  const gradeOrType = meta.grade
    ? `<span class="font-semibold">${escapeHtml(meta.grade)}</span>`
    : meta.reportType
      ? `<span>${escapeHtml(meta.reportType)}</span>`
      : '';

  const entryRow = meta.listEntry
    ? `<div class="text-[11px] text-slate-600">ID / List Entry: <span class="font-mono font-semibold">${escapeHtml(meta.listEntry)}</span></div>`
    : '';

  const conditionRow = meta.condition
    ? `<div class="text-[11px] text-rose-700">Condition: ${escapeHtml(meta.condition)}</div>`
    : '';

  const linkRow = meta.hyperlink
    ? `<div class="pt-1"><a href="${escapeHtml(meta.hyperlink)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-emerald-700 hover:underline">Open Official Record ↗</a></div>`
    : '';

  return `
    <div class="text-xs text-slate-900 space-y-1 max-w-[240px]">
      <div class="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style="background-color:${escapeHtml(badgeColor)}">
        ${escapeHtml(meta.category)}
      </div>
      <div class="font-bold leading-snug text-slate-900">${escapeHtml(meta.name)}</div>
      <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
        ${gradeOrType}
        ${distanceText ? `<span>• ${distanceText}</span>` : ''}
      </div>
      ${entryRow}
      ${conditionRow}
      ${linkRow}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 1. Locator Map (MapLibre GL — Polygons, Clickable Dots & Info Popups)
// ---------------------------------------------------------------------------
const miniMap = new maplibregl.Map({
  container: 'mini-map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  center: [-0.5586, 51.7634],
  zoom: 14,
});

miniMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

miniMap.on('load', () => {
  miniMap.addSource('studio-data', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Screening buffer ring
  miniMap.addLayer({
    id: 'buffer-fill',
    type: 'fill',
    source: 'studio-data',
    filter: ['==', ['get', '_role'], 'buffer'],
    paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.08 },
  });

  miniMap.addLayer({
    id: 'buffer-line',
    type: 'line',
    source: 'studio-data',
    filter: ['==', ['get', '_role'], 'buffer'],
    paint: { 'line-color': '#2563eb', 'line-width': 1.25, 'line-dasharray': [3, 2] },
  });

  // Designated polygon assets (WHS, Battlefields, Scheduled Monuments, Parks & Gardens, Conservation Areas)
  miniMap.addLayer({
    id: 'asset-polygons-fill',
    type: 'fill',
    source: 'studio-data',
    filter: [
      'all',
      ['==', ['get', '_role'], 'asset'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ],
    paint: {
      'fill-color': ['coalesce', ['get', '_color'], '#0d9488'],
      'fill-opacity': 0.14,
    },
  });

  miniMap.addLayer({
    id: 'asset-polygons-line',
    type: 'line',
    source: 'studio-data',
    filter: [
      'all',
      ['==', ['get', '_role'], 'asset'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ],
    paint: {
      'line-color': ['coalesce', ['get', '_color'], '#0d9488'],
      'line-width': 1.75,
    },
  });

  // Point markers for point assets (Listed Buildings, Heritage at Risk, ADS reports)
  miniMap.addLayer({
    id: 'asset-points',
    type: 'circle',
    source: 'studio-data',
    filter: [
      'all',
      ['==', ['get', '_role'], 'asset'],
      ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
    ],
    paint: {
      'circle-radius': 5.5,
      'circle-color': ['coalesce', ['get', '_color'], '#d97706'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  });

  // Screened red-line site boundary or pin
  miniMap.addLayer({
    id: 'site-fill',
    type: 'fill',
    source: 'studio-data',
    filter: [
      'all',
      ['==', ['get', '_role'], 'site'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ],
    paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.25 },
  });

  miniMap.addLayer({
    id: 'site-line',
    type: 'line',
    source: 'studio-data',
    filter: [
      'all',
      ['==', ['get', '_role'], 'site'],
      ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    ],
    paint: { 'line-color': '#dc2626', 'line-width': 2 },
  });

  miniMap.addLayer({
    id: 'site-point',
    type: 'circle',
    source: 'studio-data',
    filter: ['all', ['==', ['get', '_role'], 'site'], ['==', ['geometry-type'], 'Point']],
    paint: {
      'circle-radius': 7,
      'circle-color': '#dc2626',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // Pointer cursor over interactive asset dots and polygons
  const interactiveLayers = ['asset-points', 'asset-polygons-fill'];
  for (const layerId of interactiveLayers) {
    miniMap.on('mouseenter', layerId, () => {
      miniMap.getCanvas().style.cursor = 'pointer';
    });
    miniMap.on('mouseleave', layerId, () => {
      miniMap.getCanvas().style.cursor = '';
    });
  }
});

miniMap.on('click', async (e) => {
  // 1. Check if the user clicked an existing heritage asset dot or polygon first
  const hitFeatures = miniMap.queryRenderedFeatures(e.point, {
    layers: ['asset-points', 'asset-polygons-fill'].filter((id) => miniMap.getLayer(id)),
  });

  if (hitFeatures.length > 0) {
    const topHit = hitFeatures[0];
    const coords =
      topHit.geometry.type === 'Point'
        ? topHit.geometry.coordinates.slice()
        : [e.lngLat.lng, e.lngLat.lat];

    activePopup?.remove();
    activePopup = new maplibregl.Popup({ offset: 10, maxWidth: '260px' })
      .setLngLat(coords)
      .setHTML(buildAssetPopupHtml(topHit.properties))
      .addTo(miniMap);
    return;
  }

  // 2. Otherwise move the site pin and run a fresh screening
  activePopup?.remove();
  const pt = turf.point([e.lngLat.lng, e.lngLat.lat], {
    label: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,
  });
  const bufferMeters = Number(document.getElementById('buffer-select').value || 500);
  await applyScreeningResult(await screenSiteDirectly(pt, bufferMeters));
});

function updateMiniMap(screening) {
  if (!miniMap.isStyleLoaded() || !screening) return;

  const features = [];
  const siteClone = JSON.parse(JSON.stringify(screening.siteFeature));
  siteClone.properties = { ...(siteClone.properties || {}), _role: 'site' };
  features.push(siteClone);

  if (screening.buffered) {
    const bufClone = JSON.parse(JSON.stringify(screening.buffered));
    bufClone.properties = { ...(bufClone.properties || {}), _role: 'buffer' };
    features.push(bufClone);
  }

  for (const asset of screening.assets || []) {
    if (!asset.geometry) continue;
    const assetClone = JSON.parse(JSON.stringify(asset));
    assetClone.properties = {
      ...(assetClone.properties || {}),
      _role: 'asset',
    };
    features.push(assetClone);
  }

  miniMap.getSource('studio-data')?.setData({
    type: 'FeatureCollection',
    features,
  });

  const center = turf.centroid(screening.siteFeature).geometry.coordinates;
  miniMap.flyTo({ center, zoom: 14.5, duration: 700 });
}

// ---------------------------------------------------------------------------
// 2. Spatial Evidence & Section Cards Rendering
// ---------------------------------------------------------------------------
async function applyScreeningResult(screening) {
  studioState.screening = screening;
  updateMiniMap(screening);

  const titleInput = document.getElementById('proposal-title');
  if (titleInput && !titleInput.value.trim() && screening.siteFeature.properties?.label) {
    titleInput.value = screening.siteFeature.properties.label;
  }

  const designatedCount = screening.assets.filter(
    (a) => a.properties?._layerId !== 'ads-records'
  ).length;
  const intersectingCount = screening.assets.filter(
    (a) => a.properties?._layerId !== 'ads-records' && a.properties?._intersects
  ).length;
  const harCount = screening.assets.filter(
    (a) => a.properties?._category === 'Heritage at Risk'
  ).length;
  const adsCount = screening.assets.filter(
    (a) => a.properties?._layerId === 'ads-records'
  ).length;

  const legendItemsHtml = HERITAGE_LAYERS.map(
    (l) => `
      <span class="inline-flex items-center gap-1 text-[10px] text-slate-600">
        <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background-color:${l.color}"></span>
        ${l.category}
      </span>
    `
  ).join('');

  const summaryEl = document.getElementById('evidence-summary');
  summaryEl.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <span class="font-bold text-slate-800 truncate">${escapeHtml(screening.siteFeature.properties?.label || 'Screened Site')}</span>
      <span class="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-semibold shrink-0">
        ${screening.bufferMeters} m buffer
      </span>
    </div>
    <div class="text-[11px] font-medium text-slate-700">Sensitivity: ${escapeHtml(screening.sensitivity)}</div>
    <div class="grid grid-cols-4 gap-1 pt-1 text-center">
      <div class="rounded bg-white border border-slate-200 p-1">
        <div class="font-bold text-slate-900">${designatedCount}</div>
        <div class="text-[9px] text-slate-500">NHLE</div>
      </div>
      <div class="rounded bg-white border border-slate-200 p-1">
        <div class="font-bold text-rose-700">${intersectingCount}</div>
        <div class="text-[9px] text-slate-500">On-Site</div>
      </div>
      <div class="rounded bg-white border border-slate-200 p-1">
        <div class="font-bold text-amber-700">${harCount}</div>
        <div class="text-[9px] text-slate-500">At Risk</div>
      </div>
      <div class="rounded bg-white border border-slate-200 p-1">
        <div class="font-bold text-indigo-700">${adsCount}</div>
        <div class="text-[9px] text-slate-500">ADS</div>
      </div>
    </div>
    <div class="pt-1.5 border-t border-slate-200/80 flex flex-wrap gap-x-2.5 gap-y-1">
      ${legendItemsHtml}
      <span class="inline-flex items-center gap-1 text-[10px] text-slate-600">
        <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background-color:#4f46e5"></span>
        ADS Reports
      </span>
    </div>
  `;

  refreshCitationAudit();
}

function renderSectionCards() {
  const container = document.getElementById('section-cards-list');
  container.innerHTML = STATEMENT_SECTIONS.map((sec) => {
    const status = studioState.sectionStatus[sec.id];
    const badgeMap = {
      idle: '<span class="text-[10px] text-slate-400">Ready</span>',
      streaming: '<span class="text-[10px] font-semibold text-emerald-600 animate-pulse">Drafting...</span>',
      done: '<span class="text-[10px] font-semibold text-emerald-700">✓ Complete</span>',
      error: '<span class="text-[10px] font-semibold text-rose-600">Error</span>',
    };

    return `
      <div class="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5 shadow-2xs">
        <div class="flex items-start justify-between gap-2">
          <div class="text-xs font-bold text-slate-800">${sec.title}</div>
          ${badgeMap[status] || ''}
        </div>
        <p class="text-[11px] text-slate-500 leading-snug">${sec.description}</p>
        <div class="pt-1 flex justify-end">
          <button
            type="button"
            data-gen-section="${sec.id}"
            class="rounded border border-slate-300 hover:border-emerald-600 hover:text-emerald-700 px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors"
          >
            ${studioState.drafts[sec.id] ? 'Regenerate Section' : 'Draft Section'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('button[data-gen-section]').forEach((btn) => {
    btn.addEventListener('click', () => generateSingleSection(btn.dataset.genSection));
  });
}

function getProposalInputs() {
  return {
    title: document.getElementById('proposal-title')?.value || '',
    type: document.getElementById('proposal-type')?.value || '',
    scale: document.getElementById('proposal-scale')?.value || '',
    notes: document.getElementById('proposal-notes')?.value || '',
  };
}

function assembleFullMarkdown() {
  const proposal = getProposalInputs();
  const title =
    proposal.title.trim() ||
    studioState.screening?.siteFeature?.properties?.label ||
    'Proposed Development Site';

  const bodySections = STATEMENT_SECTIONS.map((s) => studioState.drafts[s.id]?.trim())
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!bodySections) return '';

  return [
    `# Desk-Based Heritage Statement & Setting Assessment`,
    `**Site:** ${title}  \n**Scheme:** ${proposal.type}  \n**Screening Buffer:** ${studioState.screening?.bufferMeters || 500} m  \n**Generated:** ${new Date().toLocaleDateString('en-GB')}`,
    `---`,
    bodySections,
    `---`,
    `*Contains Historic England Open Data © Historic England (OGL v3.0) and Archaeological Data Service metadata via DataCite. Drafted via Heritage Statement Drafter — verify all statutory designations prior to formal LPA submission.*`,
  ].join('\n\n');
}

function updateDocumentPreview() {
  const previewEl = document.getElementById('statement-preview');
  const fullMd = assembleFullMarkdown();
  if (!fullMd) return;

  if (typeof window.marked?.parse === 'function') {
    previewEl.innerHTML = window.marked.parse(fullMd);
  } else {
    previewEl.textContent = fullMd;
  }

  refreshCitationAudit();
}

function refreshCitationAudit() {
  const fullMd = assembleFullMarkdown();
  const badgeEl = document.getElementById('audit-badge');
  const detailsEl = document.getElementById('audit-details');

  if (!fullMd || !studioState.screening) {
    badgeEl.textContent = 'Awaiting draft';
    badgeEl.className = 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600';
    return;
  }

  const audit = auditDraftCitations(fullMd, studioState.screening.assets);

  if (audit.unverified.length > 0) {
    badgeEl.textContent = `${audit.unverified.length} Unverified ID`;
    badgeEl.className = 'rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700';
    detailsEl.innerHTML = `<span class="text-rose-700 font-semibold">Warning:</span> List Entry ID(s) <code>${audit.unverified.join(', ')}</code> were not found in the screened dataset. Regenerate or verify manually.`;
  } else if (audit.citedCount > 0) {
    badgeEl.textContent = `${audit.verified.length} Verified`;
    badgeEl.className = 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800';
    detailsEl.textContent = `All ${audit.verified.length} cited NHLE List Entry number(s) match your screened Historic England records.`;
  } else {
    badgeEl.textContent = 'No IDs cited yet';
    badgeEl.className = 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600';
    detailsEl.textContent = `${audit.totalAvailableInBuffer} NHLE List Entry record(s) available in buffer.`;
  }
}

// ---------------------------------------------------------------------------
// 3. Multi-Provider LLM Orchestration & Detailed Ollama Diagnostics
// ---------------------------------------------------------------------------
const providerSelect = document.getElementById('provider-select');
const modelSelect = document.getElementById('model-select');
const apiKeyInput = document.getElementById('api-key-input');
const endpointInput = document.getElementById('endpoint-input');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
let providerProbeId = 0;

async function syncProviderUI(preserveCustomEndpoint = false) {
  const currentProbe = ++providerProbeId;
  const providerId = providerSelect.value;
  const cfg = PROVIDERS[providerId];

  apiKeyInput.classList.toggle('hidden', !cfg.requiresKey);
  if (!preserveCustomEndpoint || !endpointInput.value.trim()) {
    endpointInput.value = cfg.defaultEndpoint;
  }

  if (cfg.requiresKey) {
    apiKeyInput.value = sessionStorage.getItem(`hsd_key_${providerId}`) || '';
  }

  modelSelect.innerHTML = cfg.defaultModels
    .map((m) => `<option value="${m}">${m}</option>`)
    .join('');

  if (providerId === 'ollama') {
    const targetUrl = endpointInput.value.trim() || cfg.defaultEndpoint;
    statusDot.className = 'inline-block w-2 h-2 rounded-full bg-amber-400';
    statusText.textContent = `Probing local Ollama at ${targetUrl}...`;
    try {
      const localModels = await fetchOllamaModels(targetUrl);
      if (currentProbe !== providerProbeId) return;

      if (localModels.length > 0) {
        modelSelect.innerHTML = localModels
          .map((m) => `<option value="${m}">${m}</option>`)
          .join('');
        statusDot.className = 'inline-block w-2 h-2 rounded-full bg-emerald-400';
        statusText.textContent = `Local Ollama connected (${localModels.length} model${localModels.length === 1 ? '' : 's'} ready)`;
      } else {
        statusDot.className = 'inline-block w-2 h-2 rounded-full bg-amber-400';
        statusText.textContent = 'Ollama connected, but no models installed (run: ollama pull qwen2.5:3b)';
      }
    } catch (err) {
      if (currentProbe !== providerProbeId) return;
      console.warn('[Heritage Statement Drafter] Ollama probe failed:', err);
      statusDot.className = 'inline-block w-2 h-2 rounded-full bg-rose-400';
      statusText.textContent = `Ollama unreachable: ${err.message}`;
      document.getElementById('cors-help-panel')?.classList.remove('hidden');
    }
  } else {
    statusDot.className = 'inline-block w-2 h-2 rounded-full bg-emerald-400';
    statusText.textContent = `${cfg.label} selected — key stays strictly in browser sessionStorage`;
  }
}

providerSelect.addEventListener('change', () => syncProviderUI(false));

apiKeyInput.addEventListener('input', () => {
  const providerId = providerSelect.value;
  sessionStorage.setItem(`hsd_key_${providerId}`, apiKeyInput.value);
});

document.getElementById('endpoint-toggle-btn').addEventListener('click', () => {
  document.getElementById('endpoint-bar').classList.toggle('hidden');
});

document.getElementById('refresh-ollama-btn').addEventListener('click', () => syncProviderUI(true));

document.getElementById('toggle-cors-help-btn').addEventListener('click', () => {
  document.getElementById('cors-help-panel').classList.toggle('hidden');
});

document.getElementById('close-cors-help-btn').addEventListener('click', () => {
  document.getElementById('cors-help-panel').classList.add('hidden');
});

async function generateSingleSection(sectionId) {
  if (!studioState.screening) {
    alert('Please screen a site or import a GeoJSON file first.');
    return;
  }

  const grounded = buildGroundedContext(studioState.screening, getProposalInputs());
  const { systemPrompt, userPrompt } = buildSectionPrompt(sectionId, grounded);

  studioState.drafts[sectionId] = '';
  studioState.sectionStatus[sectionId] = 'streaming';
  renderSectionCards();

  const controller = new AbortController();
  studioState.abortController = controller;

  try {
    await streamSectionCompletion({
      provider: providerSelect.value,
      model: modelSelect.value,
      apiKey: apiKeyInput.value,
      endpoint: endpointInput.value,
      systemPrompt,
      userPrompt,
      signal: controller.signal,
      onToken: (token) => {
        studioState.drafts[sectionId] += token;
        updateDocumentPreview();
      },
    });
    studioState.sectionStatus[sectionId] = 'done';
  } catch (err) {
    studioState.sectionStatus[sectionId] = 'error';
    studioState.drafts[sectionId] = `> **Generation Error (${sectionId}):** ${err.message}`;
    updateDocumentPreview();
  } finally {
    renderSectionCards();
  }
}

document.getElementById('draft-all-btn').addEventListener('click', async () => {
  if (!studioState.screening) {
    alert('Please screen a site or import a GeoJSON file first.');
    return;
  }
  const btn = document.getElementById('draft-all-btn');
  btn.disabled = true;
  btn.textContent = 'Drafting...';

  try {
    for (const sec of STATEMENT_SECTIONS) {
      await generateSingleSection(sec.id);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Draft Full Statement';
  }
});

// Copy full grounded prompt for pasting into any external LLM
document.getElementById('copy-full-prompt-btn').addEventListener('click', async () => {
  if (!studioState.screening) {
    alert('Screen a site first to build a grounded prompt.');
    return;
  }
  const grounded = buildGroundedContext(studioState.screening, getProposalInputs());
  const promptText = [
    'You are a senior UK heritage planning consultant drafting a Desk-Based Heritage Statement under the National Planning Policy Framework (NPPF, August 2026) and Historic England GPA3 (The Setting of Heritage Assets). Use ONLY the verified JSON facts below and cite exact List Entry numbers and distances in metres.',
    '',
    '```json',
    JSON.stringify(grounded, null, 2),
    '```',
  ].join('\n');

  await navigator.clipboard.writeText(promptText);
  const btn = document.getElementById('copy-full-prompt-btn');
  const orig = btn.textContent;
  btn.textContent = 'Copied Grounded Prompt!';
  setTimeout(() => {
    btn.textContent = orig;
  }, 2000);
});

// ---------------------------------------------------------------------------
// 4. Intake Event Listeners (GeoJSON Dropzone, Search & Samples)
// ---------------------------------------------------------------------------
const dropzone = document.getElementById('geojson-dropzone');
const fileInput = document.getElementById('geojson-file-input');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('border-emerald-500', 'bg-emerald-50');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('border-emerald-500', 'bg-emerald-50');
});
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('border-emerald-500', 'bg-emerald-50');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const bufferMeters = Number(document.getElementById('buffer-select').value || 500);
    const result = await loadScreenerOrBoundaryGeoJSON(await file.text(), bufferMeters);
    await applyScreeningResult(result);
  } catch (err) {
    alert(`GeoJSON import failed: ${err.message}`);
  }
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const bufferMeters = Number(document.getElementById('buffer-select').value || 500);
    const result = await loadScreenerOrBoundaryGeoJSON(await file.text(), bufferMeters);
    await applyScreeningResult(result);
  } catch (err) {
    alert(`GeoJSON import failed: ${err.message}`);
  }
});

document.getElementById('site-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('site-search-input').value.trim();
  if (!query) return;
  const bufferMeters = Number(document.getElementById('buffer-select').value || 500);
  try {
    const pt = await geocodeQuery(query);
    await applyScreeningResult(await screenSiteDirectly(pt, bufferMeters));
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('sample-site-select').addEventListener('change', async (e) => {
  const sample = SAMPLE_SITES[e.target.value];
  if (!sample) return;
  const bufferMeters = Number(document.getElementById('buffer-select').value || 500);
  const pt = turf.point(sample.center, { label: sample.label });
  await applyScreeningResult(await screenSiteDirectly(pt, bufferMeters));
});

// ---------------------------------------------------------------------------
// 5. Document Exports (Markdown, PDF & Screener-Compatible GeoJSON)
// ---------------------------------------------------------------------------
document.getElementById('export-md-btn').addEventListener('click', () => {
  const md = assembleFullMarkdown();
  if (!md) return alert('Draft at least one section before exporting.');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heritage-statement-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('export-pdf-btn').addEventListener('click', () => {
  const md = assembleFullMarkdown();
  if (!md) return alert('Draft at least one section before exporting.');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (neededMm) => {
    if (y + neededMm > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const stripInlineMd = (text) =>
    text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .trim();

  const writeWrapped = (text, { fontSize = 10, fontStyle = 'normal', color = [30, 41, 59], indent = 0, lineHeight = 5, spaceAfter = 2.5 } = {}) => {
    const clean = stripInlineMd(text);
    if (!clean) return;
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);

    const lines = doc.splitTextToSize(clean, maxWidth - indent);
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin + indent, y);
      y += lineHeight;
    }
    y += spaceAfter;
  };

  const rawLines = md.split('\n');
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i].trim();

    if (!line) {
      y += 1.5;
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      ensureSpace(5);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 4;
      i++;
      continue;
    }

    // Markdown pipe table block
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith('|')) {
        tableLines.push(rawLines[i].trim());
        i++;
      }

      const parsedRows = tableLines
        .filter((r) => !/^\|[\s:-]+\|/.test(r)) // skip |---|---| separator row
        .map((r) =>
          r
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => stripInlineMd(cell))
        );

      if (parsedRows.length > 0) {
        const [headRow, ...bodyRows] = parsedRows;
        doc.autoTable({
          startY: y,
          head: bodyRows.length > 0 ? [headRow] : undefined,
          body: bodyRows.length > 0 ? bodyRows : [headRow],
          margin: { left: margin, right: margin },
          styles: {
            font: 'helvetica',
            fontSize: 8.5,
            cellPadding: 2,
            textColor: [30, 41, 59],
            lineColor: [203, 213, 225],
            lineWidth: 0.2,
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
        });
        y = doc.lastAutoTable.finalY + 5;
      }
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      y += 1;
      writeWrapped(line.slice(2), {
        fontSize: 16,
        fontStyle: 'bold',
        color: [15, 23, 42],
        lineHeight: 7,
        spaceAfter: 3,
      });
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      y += 3;
      ensureSpace(12);
      writeWrapped(line.slice(3), {
        fontSize: 12.5,
        fontStyle: 'bold',
        color: [15, 23, 42],
        lineHeight: 6,
        spaceAfter: 1.5,
      });
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(margin, y - 1, pageWidth - margin, y - 1);
      y += 2.5;
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      y += 2;
      ensureSpace(10);
      writeWrapped(line.slice(4), {
        fontSize: 10.5,
        fontStyle: 'bold',
        color: [30, 41, 59],
        lineHeight: 5.5,
        spaceAfter: 2,
      });
      i++;
      continue;
    }

    // Bullet points
    if (/^[-*•]\s+/.test(line)) {
      const bulletText = line.replace(/^[-*•]\s+/, '');
      ensureSpace(5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('•', margin + 1.5, y);
      writeWrapped(bulletText, {
        fontSize: 9.5,
        indent: 5,
        lineHeight: 4.8,
        spaceAfter: 1.5,
      });
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      writeWrapped(line.replace(/^>\s*/, ''), {
        fontSize: 9,
        fontStyle: 'italic',
        color: [71, 85, 105],
        indent: 4,
        lineHeight: 4.6,
        spaceAfter: 2,
      });
      i++;
      continue;
    }

    // Standard paragraph
    writeWrapped(line, {
      fontSize: 9.5,
      lineHeight: 4.8,
      spaceAfter: 2.5,
    });
    i++;
  }

  // Add subtle page numbering footer on every page
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Desk-Based Heritage Statement · Page ${p} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 8,
      { align: 'right' }
    );
  }

  doc.save(`heritage-statement-${Date.now()}.pdf`);
});

document.getElementById('export-geojson-btn').addEventListener('click', () => {
  if (!studioState.screening) return alert('No screened site data to export.');
  const { siteFeature, buffered, bufferMeters, assets } = studioState.screening;

  const siteOut = JSON.parse(JSON.stringify(siteFeature));
  siteOut.properties = { ...(siteOut.properties || {}), _role: 'site', bufferMeters };

  const bufOut = JSON.parse(JSON.stringify(buffered));
  bufOut.properties = { ...(bufOut.properties || {}), _role: 'buffer', bufferMeters };

  const fc = {
    type: 'FeatureCollection',
    features: [siteOut, bufOut, ...(assets || [])],
  };

  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heritage-constraints-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// Initialize Studio
// ---------------------------------------------------------------------------
initMvpOverlayAndTour();
renderSectionCards();
syncProviderUI(false);
miniMap.once('load', async () => {
  const defaultSample = SAMPLE_SITES.berkhamsted;
  const pt = turf.point(defaultSample.center, { label: defaultSample.label });
  await applyScreeningResult(await screenSiteDirectly(pt, 500));
});