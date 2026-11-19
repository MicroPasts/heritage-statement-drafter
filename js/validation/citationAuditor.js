import { normalizeAssetMeta } from '../intake/arcgisClient.js';

/**
 * Extracts all numeric List Entry citations from drafted Markdown and verifies
 * them against the ground-truth screened assets.
 */
export function auditDraftCitations(markdownText, assets = []) {
  const validEntries = new Map();
  for (const feat of assets) {
    const meta = normalizeAssetMeta(feat);
    if (meta.listEntry && /^\d{5,8}$/.test(meta.listEntry)) {
      validEntries.set(meta.listEntry, meta.name);
    }
  }

  // Match 5-to-8 digit numbers following "List Entry", "NHLE", "Entry", or "No."
  const citationRegex = /\b(?:List\s*Entry|NHLE|Entry|No\.?)\s*#?:?\s*(\d{5,8})\b/gi;
  const citedSet = new Set();
  let match;
  while ((match = citationRegex.exec(markdownText)) !== null) {
    citedSet.add(match[1]);
  }

  const verified = [];
  const unverified = [];

  for (const id of citedSet) {
    if (validEntries.has(id)) {
      verified.push({ id, name: validEntries.get(id) });
    } else {
      unverified.push(id);
    }
  }

  return {
    totalAvailableInBuffer: validEntries.size,
    citedCount: citedSet.size,
    verified,
    unverified,
  };
}