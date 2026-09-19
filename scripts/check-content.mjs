// @ts-nocheck
import { readdir, readFile, stat } from 'node:fs/promises';
import { parse } from 'yaml';

const root = new URL('../src/content/cocktails/', import.meta.url);
const imageRoot = new URL('../public/', import.meta.url);
const required = [
  'slug', 'nameZh', 'nameEn', 'category', 'baseSpirit', 'flavors', 'styles',
  'ingredients', 'tags', 'summary', 'steps', 'glass', 'garnish', 'image',
  'imageAlt', 'imageCredit', 'source',
];
const expectedCount = 102;

// This is the six-page IBA All Cocktails directory checked on 2026-09-19.
// Names are compared after case, accents, apostrophes, punctuation, and
// whitespace are normalized so typography differences do not create false
// negatives (for example, Piña/Pina or Dark ‘N’/Dark 'N').
const officialNames = [
  'Alexander', 'Americano', 'Angel Face', 'Aviation', 'Bee’s Knees',
  'Bellini', 'Between the Sheets', 'Black Russian', 'Bloody Mary',
  'Boulevardier', 'Bramble', 'Brandy Crusta', 'Caipirinha', 'Canchanchara',
  'Cardinale', 'Casino', 'Champagne Cocktail', 'Chartreuse Swizzle',
  'Clover Club', 'Corpse Reviver #2',
  'Cosmopolitan', 'Cuba Libre', 'Daiquiri', 'Dark ‘N’ Stormy',
  "Don's Special Daiquiri", 'Dry Martini', 'Espresso Martini', 'Fernandito',
  'French 75', 'French Connection', 'French Martini', 'Garibaldi',
  'Gin Basil Smash', 'Gin Fizz', 'Grand Margarita', 'Grasshopper',
  'Hanky Panky', 'Hemingway Special', "Horse’s Neck", 'IBA Tiki',
  'Illegal', 'Irish Coffee', 'John Collins', 'Jungle Bird', 'Kir', 'Last Word',
  'Lemon Drop Martini', 'Long Island Iced Tea', 'Mai-Tai', 'Manhattan',
  'Margarita', 'Martinez', 'Mary Pickford', 'Mimosa', 'Mint Julep',
  "Missionary's Downfall", 'Mojito', 'Monkey Gland', 'Moscow Mule',
  'Naked and Famous', 'Negroni', 'New York Sour', 'Old Cuban', 'Old Fashioned',
  'Paloma', 'Paper Plane', 'Paradise', 'Penicillin', 'Pina Colada',
  'Pisco Punch', 'Pisco Sour', 'Planters Punch', 'Porn Star Martini',
  'Porto Flip', 'Rabo de Galo', 'Ramos Fizz', 'Remember the Maine',
  'Russian Spring Punch', 'Rusty Nail', 'Sazerac', 'Sea Breeze',
  'Sex on the Beach', 'Sherry Cobbler', 'Sidecar', 'Singapore Sling',
  'South Side', 'Spicy Fifty', 'Spritz', 'Stinger', 'Suffering Bastard',
  'Tequila Sunrise', 'Three Dots and a Dash', 'Tipperary', "Tommy's Margarita",
  'Trinidad Sour', 'Tuxedo', 'Ve.N.To', 'Vesper', 'Vieux Carré', 'Whiskey Sour',
  'White Lady', 'Zombie',
];

const normalizeName = (value) => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[’‘'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const officialNameSet = new Set(officialNames.map(normalizeName));
const files = [];
const slugs = new Set();
const names = new Map();
const errors = [];

async function walk(url) {
  for (const item of await readdir(url, { withFileTypes: true })) {
    const child = new URL(`${item.name}${item.isDirectory() ? '/' : ''}`, url);
    if (item.isDirectory()) await walk(child);
    else if (item.name.endsWith('.md')) files.push(child);
  }
}

function sourceError(source, label) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return `${label} must be an object`;
  if (typeof source.label !== 'string' || !source.label.trim()) return `${label}.label is required`;
  if (typeof source.url !== 'string' || !/^https?:\/\/\S+$/i.test(source.url)) return `${label}.url must be an http(s) URL`;
  if (!source.checkedAt) return `${label}.checkedAt is required`;
  try {
    const checkedAt = new Date(source.checkedAt);
    if (Number.isNaN(checkedAt.getTime())) return `${label}.checkedAt is not a valid date`;
  } catch {
    return `${label}.checkedAt is not a valid date`;
  }
  return null;
}

const flavorRules = [
  { values: ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'], match: (e) => e.styles.includes('sour') || e.flavors.some((value) => ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'].includes(value)) },
  { values: ['fruity', 'peach', 'tropical', 'coconut', 'apple', 'apricot', 'cherry', 'berry', 'grape'] },
  { values: ['herbal', 'floral', 'minty', 'mint', 'anise', 'cooling'] },
  { values: ['bitter', 'bittersweet', 'bitters', 'dry', 'fortified-wine'] },
  { values: ['sweet', 'creamy', 'silky', 'cola', 'honey', 'cocoa', 'rich'] },
  { values: ['spiced', 'spicy', 'ginger', 'woody', 'smoky', 'warming', 'strong'] },
  { values: ['coffee', 'nutty', 'cocoa'] },
  { values: ['savory', 'salty'] },
];

const styleRules = [
  { values: ['spirit-forward', 'stirred', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'], match: (e) => e.styles.some((value) => ['spirit-forward', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'].includes(value)) || (e.styles.includes('stirred') && !e.styles.includes('brunch') && !e.styles.includes('highball')) },
  { values: ['sour', 'short', 'layered'] },
  { values: ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'], match: (e) => e.styles.some((value) => ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'].includes(value)) },
  { values: ['sparkling', 'aperitivo'] },
  { values: ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'], match: (e) => e.flavors.includes('tropical') || e.styles.some((value) => ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'].includes(value)) },
  { values: ['after-dinner', 'hot'], match: (e) => e.flavors.some((value) => ['coffee', 'creamy'].includes(value)) || e.styles.some((value) => ['after-dinner', 'hot'].includes(value)) },
];

function coveredByRules(entry, rules) {
  return rules.some((rule) => rule.values.some((value) => entry.values.includes(value)) || rule.match?.(entry));
}

try {
  await stat(root);
  await walk(root);
} catch {
  console.error('Missing src/content/cocktails; refusing to publish without the recipe collection.');
  process.exit(1);
}

if (files.length !== expectedCount) {
  errors.push(`expected exactly ${expectedCount} recipe files from the IBA directory, found ${files.length}`);
}

for (const file of files) {
  const pathname = file.pathname;
  const text = await readFile(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    errors.push(`${pathname}: missing frontmatter`);
    continue;
  }

  let data;
  try {
    data = parse(match[1]);
  } catch (error) {
    errors.push(`${pathname}: invalid YAML frontmatter (${error.message})`);
    continue;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push(`${pathname}: frontmatter must be a mapping`);
    continue;
  }

  for (const field of required) {
    if (!(field in data)) errors.push(`${pathname}: missing ${field}`);
  }

  const expected = pathname.split('/').at(-1).replace(/\.md$/, '');
  const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) errors.push(`${pathname}: invalid slug ${slug || '(empty)'}`);
  if (slug !== expected) errors.push(`${pathname}: filename and slug differ`);
  if (slug && slugs.has(slug)) errors.push(`${pathname}: duplicate slug ${slug}`);
  if (slug) slugs.add(slug);

  const nameEn = typeof data.nameEn === 'string' ? data.nameEn.trim() : '';
  const normalizedName = normalizeName(nameEn);
  if (!nameEn) errors.push(`${pathname}: nameEn is empty`);
  else if (!officialNameSet.has(normalizedName)) errors.push(`${pathname}: nameEn is not in the IBA All Cocktails directory: ${nameEn}`);
  else if (names.has(normalizedName)) errors.push(`${pathname}: duplicate IBA name ${nameEn} (also ${names.get(normalizedName)})`);
  else names.set(normalizedName, pathname);

  if (!Array.isArray(data.flavors) || !data.flavors.length) errors.push(`${pathname}: flavors must be a non-empty array`);
  if (!Array.isArray(data.styles) || !data.styles.length) errors.push(`${pathname}: styles must be a non-empty array`);
  const flavors = Array.isArray(data.flavors) ? data.flavors.map(String) : [];
  const styles = Array.isArray(data.styles) ? data.styles.map(String) : [];
  if (flavors.length && !coveredByRules({ values: flavors, flavors, styles }, flavorRules)) errors.push(`${pathname}: flavors do not map to one of the 8 flavor groups (${flavors.join(', ')})`);
  if (styles.length && !coveredByRules({ values: styles, flavors, styles }, styleRules)) errors.push(`${pathname}: styles do not map to one of the 6 style groups (${styles.join(', ')})`);

  const image = typeof data.image === 'string' ? data.image : '';
  if (!/^\/images\/cocktails\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|avif|png|jpe?g)$/.test(image)) {
    errors.push(`${pathname}: image must point to /images/cocktails/`);
  } else {
    try {
      const imageFile = new URL(`.${image}`, imageRoot);
      const imageStats = await stat(imageFile);
      if (!imageStats.isFile() || imageStats.size < 1) errors.push(`${pathname}: image is empty ${image}`);
    } catch {
      errors.push(`${pathname}: missing local image ${image}`);
    }
  }

  if (!data.imageCredit || data.imageCredit.kind !== 'generated') errors.push(`${pathname}: imageCredit.kind must be generated`);
  for (const field of ['creator', 'source', 'license']) {
    if (typeof data.imageCredit?.[field] !== 'string' || !data.imageCredit[field].trim()) errors.push(`${pathname}: imageCredit.${field} is required`);
  }

  const sourceIssue = sourceError(data.source, 'source');
  if (sourceIssue) errors.push(`${pathname}: ${sourceIssue}`);
  if (typeof data.background !== 'string' || (data.background.match(/[\u3400-\u9fff]/g) ?? []).length < 160) {
    errors.push(`${pathname}: background must contain at least 160 Chinese characters`);
  }
  if (!Array.isArray(data.historySources) || !data.historySources.length) {
    errors.push(`${pathname}: historySources must contain at least one source`);
  } else {
    data.historySources.forEach((historySource, index) => {
      const issue = sourceError(historySource, `historySources[${index}]`);
      if (issue) errors.push(`${pathname}: ${issue}`);
    });
  }
}

const missingNames = [...officialNameSet].filter((name) => !names.has(name));
if (slugs.size !== expectedCount) errors.push(`expected exactly ${expectedCount} unique slugs, found ${slugs.size}`);
if (names.size !== expectedCount) errors.push(`expected exactly ${expectedCount} unique IBA English names, found ${names.size}`);
if (missingNames.length) errors.push(`missing IBA names: ${missingNames.join(', ')}`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Content smoke check passed for exactly ${files.length} IBA recipe files and ${names.size} unique names.`);
