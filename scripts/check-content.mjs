// Content smoke checks for the strict IBA manifest and the vendored community
// snapshot. This intentionally stays independent from Astro's runtime so it
// can catch missing files before a production build.
// @ts-nocheck
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(repoRoot, 'src', 'content', 'cocktails');
const imageRoot = path.join(repoRoot, 'public', 'images', 'cocktails');
const manifestPath = path.join(repoRoot, 'src', 'data', 'community-import-manifest.json');
const curatedAllowlistPath = path.join(repoRoot, 'src', 'data', 'community-curated-allowlist.json');
const communityClassificationsPath = path.join(repoRoot, 'src', 'data', 'community-classifications.json');
const vendorManifestPath = path.join(repoRoot, 'vendor', 'bar-assistant-data-v5', 'manifest.json');
const vendorRoot = path.join(repoRoot, 'vendor', 'bar-assistant-data-v5');
const expectedVendorCommit = '5a504d474614494119882eb91a8ffdc5491a483f';
const required = [
  'slug', 'nameZh', 'nameEn', 'category', 'baseSpirit', 'flavors', 'styles', 'ingredients', 'tags',
  'summary', 'background', 'historySources', 'steps', 'glass', 'garnish', 'image', 'imageAlt',
  'imageCredit', 'source',
];
const officialNames = [
  'Alexander', 'Americano', 'Angel Face', 'Aviation', 'Bee’s Knees', 'Bellini', 'Between the Sheets',
  'Black Russian', 'Bloody Mary', 'Boulevardier', 'Bramble', 'Brandy Crusta', 'Caipirinha', 'Canchanchara',
  'Cardinale', 'Casino', 'Champagne Cocktail', 'Chartreuse Swizzle', 'Clover Club', 'Corpse Reviver #2',
  'Cosmopolitan', 'Cuba Libre', 'Daiquiri', 'Dark ‘N’ Stormy', "Don's Special Daiquiri", 'Dry Martini',
  'Espresso Martini', 'Fernandito', 'French 75', 'French Connection', 'French Martini', 'Garibaldi',
  'Gin Basil Smash', 'Gin Fizz', 'Grand Margarita', 'Grasshopper', 'Hanky Panky', 'Hemingway Special',
  'Horse’s Neck', 'IBA Tiki', 'Illegal', 'Irish Coffee', 'John Collins', 'Jungle Bird', 'Kir', 'Last Word',
  'Lemon Drop Martini', 'Long Island Iced Tea', 'Mai-Tai', 'Manhattan', 'Margarita', 'Martinez', 'Mary Pickford',
  'Mimosa', 'Mint Julep', "Missionary's Downfall", 'Mojito', 'Monkey Gland', 'Moscow Mule', 'Naked and Famous',
  'Negroni', 'New York Sour', 'Old Cuban', 'Old Fashioned', 'Paloma', 'Paper Plane', 'Paradise', 'Penicillin',
  'Pina Colada', 'Pisco Punch', 'Pisco Sour', 'Planters Punch', 'Porn Star Martini', 'Porto Flip', 'Rabo de Galo',
  'Ramos Fizz', 'Remember the Maine', 'Russian Spring Punch', 'Rusty Nail', 'Sazerac', 'Sea Breeze', 'Sex on the Beach',
  'Sherry Cobbler', 'Sidecar', 'Singapore Sling', 'South Side', 'Spicy Fifty', 'Spritz', 'Stinger', 'Suffering Bastard',
  'Tequila Sunrise', 'Three Dots and a Dash', 'Tipperary', "Tommy's Margarita", 'Trinidad Sour', 'Tuxedo', 'Ve.N.To',
  'Vesper', 'Vieux Carré', 'Whiskey Sour', 'White Lady', 'Zombie',
];
const normalizeName = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const chineseCount = (value) => (String(value ?? '').match(/[\u3400-\u9fff]/g) ?? []).length;
const unique = (values) => [...new Set(values.filter(Boolean))];
const officialSet = new Set(officialNames.map(normalizeName));
const errors = [];
const warnings = [];

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.name.endsWith('.md')) files.push(file);
  }
  return files;
}

function sourceIssue(source, label) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return `${label} must be an object`;
  if (typeof source.label !== 'string' || !source.label.trim()) return `${label}.label is required`;
  if (typeof source.url !== 'string' || !/^https?:\/\/\S+$/i.test(source.url)) return `${label}.url must be an http(s) URL`;
  if (!source.checkedAt || Number.isNaN(new Date(source.checkedAt).getTime())) return `${label}.checkedAt must be a valid date`;
  return null;
}

const flavorRules = [
  { values: ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'], match: (e) => e.styles.includes('sour') },
  { values: ['fruity', 'peach', 'tropical', 'coconut', 'apple', 'apricot', 'cherry', 'berry', 'grape'] },
  { values: ['herbal', 'floral', 'minty', 'mint', 'anise', 'cooling'] },
  { values: ['bitter', 'bittersweet', 'bitters', 'dry'] },
  { values: ['sweet', 'creamy', 'silky', 'cola', 'honey', 'cocoa', 'rich'] },
  { values: ['spiced', 'spicy', 'ginger', 'woody', 'smoky', 'warming', 'strong'] },
  { values: ['coffee', 'nutty', 'cocoa'] },
  { values: ['savory', 'salty'] },
];
const styleRules = [
  { values: ['spirit-forward', 'stirred', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'], match: (e) => e.styles.some((v) => ['spirit-forward', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'].includes(v)) || (e.styles.includes('stirred') && !e.styles.includes('brunch') && !e.styles.includes('highball')) },
  { values: ['sour', 'short', 'layered'] },
  { values: ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'] },
  { values: ['sparkling', 'aperitivo'] },
  { values: ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'], match: (e) => e.flavors.includes('tropical') },
  { values: ['after-dinner', 'hot'], match: (e) => e.flavors.some((v) => ['coffee', 'creamy'].includes(v)) },
];
const covered = (entry, rules, field) => rules.some((rule) => rule.values.some((value) => entry[field].includes(value)) || rule.match?.(entry));

let files;
try {
  files = await walk(contentRoot);
} catch {
  console.error('Missing src/content/cocktails; refusing to publish without the recipe collection.');
  process.exit(1);
}

let importManifest = null;
try { importManifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { errors.push('missing or invalid src/data/community-import-manifest.json'); }
let curatedAllowlist = null;
try { curatedAllowlist = JSON.parse(await readFile(curatedAllowlistPath, 'utf8')); } catch { errors.push('missing or invalid src/data/community-curated-allowlist.json'); }
let communityClassifications = null;
try { communityClassifications = JSON.parse(await readFile(communityClassificationsPath, 'utf8')); } catch { errors.push('missing or invalid src/data/community-classifications.json'); }
let vendorManifest = null;
try { vendorManifest = JSON.parse(await readFile(vendorManifestPath, 'utf8')); } catch { errors.push('missing or invalid vendor/bar-assistant-data-v5/manifest.json'); }

const communityManifestEntries = new Map((importManifest?.entries ?? []).map((entry) => [entry.slug, entry]));
const curatedSlugs = new Set((curatedAllowlist?.slugs ?? []).map((slug) => String(slug)));
const curatedManualSlugs = new Set((curatedAllowlist?.manualSlugs ?? []).map((slug) => String(slug)));
const expectedCommunity = Number(importManifest?.communityCount ?? 0);
const expectedTotal = officialNames.length + expectedCommunity;
if (importManifest && importManifest.combinedCount !== expectedTotal) errors.push(`community manifest combinedCount ${importManifest.combinedCount} does not equal ${expectedTotal}`);
if (curatedAllowlist && curatedSlugs.size !== 38) errors.push(`curated community allowlist must contain 38 Bar Assistant slugs, found ${curatedSlugs.size}`);
if (curatedAllowlist && curatedManualSlugs.size !== 1) errors.push(`curated community allowlist must contain 1 manual slug, found ${curatedManualSlugs.size}`);
if (importManifest && expectedCommunity !== 39) errors.push(`curated community manifest must contain 39 entries, found ${expectedCommunity}`);
if (importManifest && expectedTotal !== 141) errors.push(`curated catalog must contain 141 recipes, found ${expectedTotal}`);
if (communityClassifications && Object.keys(communityClassifications).length !== 39) errors.push(`community classifications must contain 39 entries, found ${Object.keys(communityClassifications).length}`);
if (vendorManifest) {
  if (vendorManifest.commit !== expectedVendorCommit) errors.push(`vendor snapshot commit mismatch: ${vendorManifest.commit}`);
  if (vendorManifest.recipeCount !== 663) errors.push(`vendor snapshot expected 663 recipe rows, found ${vendorManifest.recipeCount}`);
  if (!Array.isArray(vendorManifest.files) || vendorManifest.files.length !== vendorManifest.recipeCount) errors.push('vendor manifest file list is incomplete');
}

const slugs = new Set();
const names = new Map();
const officialPaths = new Set();
const communityPaths = new Set();
const imagePaths = new Set();
const entries = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const pathname = path.relative(repoRoot, file).replaceAll(path.sep, '/');
  if (!match) { errors.push(`${pathname}: missing frontmatter`); continue; }
  let data;
  try { data = parse(match[1]); } catch (error) { errors.push(`${pathname}: invalid YAML (${error.message})`); continue; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push(`${pathname}: frontmatter must be a mapping`); continue; }
  entries.push({ file, pathname, data });
  for (const field of required) if (!(field in data)) errors.push(`${pathname}: missing ${field}`);
  const expectedSlug = path.basename(file, '.md');
  const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push(`${pathname}: invalid slug ${slug || '(empty)'}`);
  if (slug !== expectedSlug) errors.push(`${pathname}: filename and slug differ`);
  if (slug && slugs.has(slug)) errors.push(`${pathname}: duplicate slug ${slug}`);
  if (slug) slugs.add(slug);
  const community = data.category === 'Bar Assistant Community' || pathname.includes('/community/');
  if (community) communityPaths.add(pathname); else officialPaths.add(pathname);
  const nameEn = typeof data.nameEn === 'string' ? data.nameEn.trim() : '';
  const normalizedName = normalizeName(nameEn);
  if (!nameEn) errors.push(`${pathname}: nameEn is empty`);
  if (names.has(normalizedName)) errors.push(`${pathname}: duplicate English name ${nameEn} (also ${names.get(normalizedName)})`);
  else if (nameEn) names.set(normalizedName, pathname);
  if (!community && !officialSet.has(normalizedName)) errors.push(`${pathname}: nameEn is not in the IBA manifest: ${nameEn}`);
  if (community && officialSet.has(normalizedName)) errors.push(`${pathname}: community name overlaps IBA manifest: ${nameEn}`);
  if (!Array.isArray(data.flavors) || !data.flavors.length) errors.push(`${pathname}: flavors must be a non-empty array`);
  if (!Array.isArray(data.styles) || !data.styles.length) errors.push(`${pathname}: styles must be a non-empty array`);
  const flavors = Array.isArray(data.flavors) ? data.flavors.map(String) : [];
  const styles = Array.isArray(data.styles) ? data.styles.map(String) : [];
  if (flavors.length && !covered({ flavors, styles }, flavorRules, 'flavors')) errors.push(`${pathname}: flavors do not map to an existing macro group`);
  if (styles.length && !covered({ flavors, styles }, styleRules, 'styles')) errors.push(`${pathname}: styles do not map to an existing macro group`);
  const image = typeof data.image === 'string' ? data.image : '';
  if (!/^\/images\/cocktails\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|avif|svg|png|jpe?g)$/.test(image)) errors.push(`${pathname}: invalid image path ${image}`);
  else {
    imagePaths.add(image);
      try {
      const imageFile = path.join(repoRoot, 'public', image.slice(1));
      const imageStats = await stat(imageFile);
      if (!imageStats.isFile() || imageStats.size < 1) errors.push(`${pathname}: image is empty ${image}`);
    } catch {
      if (community) warnings.push(`${pathname}: missing pending community image ${image}`);
      else errors.push(`${pathname}: missing local image ${image}`);
    }
  }
  if (!data.imageCredit || data.imageCredit.kind !== 'generated') errors.push(`${pathname}: imageCredit.kind must be generated`);
  for (const field of ['creator', 'source', 'license']) if (typeof data.imageCredit?.[field] !== 'string' || !data.imageCredit[field].trim()) errors.push(`${pathname}: imageCredit.${field} is required`);
  const sourceProblem = sourceIssue(data.source, 'source');
  if (sourceProblem) errors.push(`${pathname}: ${sourceProblem}`);
  if (chineseCount(data.background) < 160) errors.push(`${pathname}: background must contain at least 160 Chinese characters`);
  if (community && chineseCount(data.background) > 260) warnings.push(`${pathname}: community background is longer than 260 Chinese characters`);
  if (community) {
    if (chineseCount(data.summary) < 2) errors.push(`${pathname}: summary must be Chinese-first`);
    if (chineseCount(data.garnish) < 1) errors.push(`${pathname}: garnish must be Chinese-first`);
    if (!Array.isArray(data.steps) || data.steps.some((step) => chineseCount(step) < 2)) errors.push(`${pathname}: steps must be Chinese-first`);
    if (!communityManifestEntries.has(slug)) errors.push(`${pathname}: missing community manifest entry`);
    else {
      const manifestEntry = communityManifestEntries.get(slug);
      if (manifestEntry.nameEn !== data.nameEn || manifestEntry.file !== pathname || manifestEntry.image !== data.image) errors.push(`${pathname}: differs from community import manifest`);
      const manual = Boolean(manifestEntry.manual);
      if (manual) {
        if (!curatedManualSlugs.has(slug)) errors.push(`${pathname}: manual community slug is not in the curated allowlist`);
      } else {
        if (!curatedSlugs.has(slug)) errors.push(`${pathname}: community slug is not in the curated Bar Assistant allowlist`);
        if (!/^https:\/\/github\.com\/bar-assistant\/data\/blob\//.test(String(data.source?.url ?? ''))) errors.push(`${pathname}: community source must point to the Bar Assistant snapshot`);
      }
      if (path.extname(image) !== '.webp') errors.push(`${pathname}: community image must use the reserved WebP path`);
      if (data.imageCredit.creator !== 'OpenAI image generation' || data.imageCredit.source !== 'OpenAI built-in image generation') errors.push(`${pathname}: community image credit must identify OpenAI image generation`);
    }
    const expectedClassification = communityClassifications?.[slug];
    if (!expectedClassification) errors.push(`${pathname}: missing curated classification entry`);
    else {
      for (const field of ['baseSpirit', 'flavors', 'styles']) {
        if (JSON.stringify(data[field]) !== JSON.stringify(expectedClassification[field])) errors.push(`${pathname}: ${field} differs from curated classification`);
      }
    }
  }
  if (!Array.isArray(data.historySources) || !data.historySources.length) errors.push(`${pathname}: historySources must contain at least one source`);
  else data.historySources.forEach((item, index) => { const issue = sourceIssue(item, `historySources[${index}]`); if (issue) errors.push(`${pathname}: ${issue}`); });
}

if (officialPaths.size !== officialNames.length) errors.push(`expected exactly ${officialNames.length} IBA recipe files, found ${officialPaths.size}`);
if (communityPaths.size !== expectedCommunity) errors.push(`expected ${expectedCommunity} community recipe files, found ${communityPaths.size}`);
if (files.length !== expectedTotal) errors.push(`expected ${expectedTotal} total recipe files, found ${files.length}`);
if (slugs.size !== files.length) errors.push(`expected unique slugs for ${files.length} recipes, found ${slugs.size}`);
if (names.size !== files.length) errors.push(`expected unique English names for ${files.length} recipes, found ${names.size}`);
for (const name of officialSet) if (![...names.keys()].includes(name)) errors.push(`missing IBA name: ${name}`);
for (const slug of communityManifestEntries.keys()) if (!slugs.has(slug)) errors.push(`manifest community slug has no Markdown: ${slug}`);
const generatedManifestEntries = [...communityManifestEntries.values()].filter((entry) => !entry.manual);
const manualManifestEntries = [...communityManifestEntries.values()].filter((entry) => entry.manual);
if (generatedManifestEntries.length !== curatedSlugs.size) errors.push(`community manifest has ${generatedManifestEntries.length} generated entries; expected ${curatedSlugs.size}`);
for (const slug of curatedSlugs) if (!communityManifestEntries.has(slug)) errors.push(`curated allowlist slug has no manifest entry: ${slug}`);
for (const slug of curatedManualSlugs) if (!communityManifestEntries.has(slug)) errors.push(`curated manual slug has no manifest entry: ${slug}`);
for (const entry of generatedManifestEntries) if (!curatedSlugs.has(entry.slug)) errors.push(`manifest generated entry is outside curated allowlist: ${entry.slug}`);
for (const entry of manualManifestEntries) if (!curatedManualSlugs.has(entry.slug)) errors.push(`manifest manual entry is outside curated allowlist: ${entry.slug}`);
if (communityClassifications) for (const slug of Object.keys(communityClassifications)) if (!communityManifestEntries.has(slug)) errors.push(`community classification has no manifest entry: ${slug}`);
for (const missing of importManifest?.missingNameZh ?? []) warnings.push(`missing community Chinese name mapping: ${missing}`);

if (vendorManifest?.files) {
  for (const item of vendorManifest.files) {
    const file = path.join(vendorRoot, item.path.replaceAll('/', path.sep));
    try {
      const bytes = await readFile(file);
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) errors.push(`vendor checksum mismatch: ${item.path}`);
    } catch { errors.push(`vendor file missing: ${item.path}`); }
  }
}

if (importManifest?.entries) {
  for (const item of importManifest.entries) {
    if (item.manual) continue;
    const sourceFile = path.join(vendorRoot, 'data', 'cocktails', item.sourceId, 'data.json');
    try {
      const bytes = await readFile(sourceFile);
      if (sha256(bytes) !== item.sourceSha256) errors.push(`community source checksum mismatch: ${item.slug}`);
    } catch { errors.push(`community source file missing: ${item.slug}`); }
  }
}

try {
  for (const item of await readdir(imageRoot, { withFileTypes: true })) {
    if (!item.isFile()) continue;
    const relative = `/images/cocktails/${item.name}`;
    if (!imagePaths.has(relative)) errors.push(`orphan cocktail image without Markdown: ${relative}`);
  }
} catch { errors.push('missing public/images/cocktails'); }

if (warnings.length) console.warn(`Warnings:\n${unique(warnings).join('\n')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Content smoke check passed for ${officialPaths.size} IBA + ${communityPaths.size} community = ${files.length} recipes, ${names.size} unique English names.`);
