// @ts-nocheck
// Generate a compact, static search index from the Markdown collection.
// This runs before Astro's build so client-side search can span paginated
// catalog pages without putting every recipe card into the initial HTML.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(repoRoot, 'src', 'content', 'cocktails');
const outputFile = path.join(repoRoot, 'public', 'data', 'recipes-index.json');

const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[\p{P}\p{S}\s]+/gu, '');

const flavorGroups = [
  { id: 'citrus-refreshing', label: '清爽柑橘', values: ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'] },
  { id: 'fruity-tropical', label: '果香热带', values: ['fruity', 'peach', 'tropical', 'coconut', 'apple', 'apricot', 'cherry', 'berry', 'grape'] },
  { id: 'herbal-floral', label: '草本花香', values: ['herbal', 'floral', 'minty', 'mint', 'anise', 'cooling'] },
  { id: 'bitter-aperitif', label: '苦甜开胃', values: ['bitter', 'bittersweet', 'bitters', 'dry'] },
  { id: 'sweet-rounded', label: '甜润醇厚', values: ['sweet', 'creamy', 'silky', 'cola', 'honey', 'cocoa', 'rich'] },
  { id: 'spiced-smoky', label: '辛香烟熏', values: ['spiced', 'spicy', 'ginger', 'woody', 'smoky', 'warming', 'strong'] },
  { id: 'coffee-nutty', label: '咖啡坚果', values: ['coffee', 'nutty', 'cocoa'] },
  { id: 'savory-salty', label: '咸鲜', values: ['savory', 'salty'] },
];
const styleGroups = [
  { id: 'spirit-forward', label: '烈酒主导', values: ['spirit-forward', 'stirred', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'] },
  { id: 'sour-short', label: '酸酒短饮', values: ['sour', 'short', 'layered'] },
  { id: 'refreshing-long', label: '清爽长饮', values: ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'] },
  { id: 'sparkling-aperitif', label: '餐前与气泡', values: ['sparkling', 'aperitivo'] },
  { id: 'tropical-iced', label: '热带冰饮', values: ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'] },
  { id: 'after-dinner', label: '餐后甜饮', values: ['after-dinner', 'hot'] },
];
const baseLabels = {
  gin: '金酒', vodka: '伏特加', rum: '朗姆酒', tequila: '龙舌兰', whiskey: '威士忌', brandy: '白兰地',
  pisco: '皮斯科', cachaca: '卡莎萨', wine: '葡萄酒', aperitif: '开胃酒', mixed: '混合基酒', multi: '多种基酒', none: '无基酒',
};

const groupValues = (entry, groups, field) => groups
  .filter((group) => {
    const values = entry[field] ?? [];
    const matches = group.values.some((value) => values.includes(value));
    if (field === 'flavors' && group.id === 'citrus-refreshing') return matches || (entry.styles ?? []).includes('sour');
    if (field === 'styles' && group.id === 'spirit-forward') return matches || ((entry.styles ?? []).includes('stirred') && !(entry.styles ?? []).includes('brunch') && !(entry.styles ?? []).includes('highball'));
    if (field === 'styles' && group.id === 'refreshing-long') return matches;
    if (field === 'styles' && group.id === 'tropical-iced') return matches || (entry.flavors ?? []).includes('tropical');
    if (field === 'styles' && group.id === 'after-dinner') return matches || (entry.flavors ?? []).some((value) => ['coffee', 'creamy'].includes(value));
    return matches;
  })
  .map((group) => group.id);

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.name.endsWith('.md')) files.push(file);
  }
  return files;
}

const entries = [];
for (const file of await walk(contentRoot)) {
  const text = await readFile(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) continue;
  const data = parse(match[1]);
  const flavorGroupIds = groupValues(data, flavorGroups, 'flavors');
  const styleGroupIds = groupValues(data, styleGroups, 'styles');
  const searchParts = [
    data.nameZh, data.nameEn, data.category, data.baseSpirit, data.tags?.join(' '),
    data.flavors?.join(' '), data.styles?.join(' '),
    ...(data.ingredients ?? []).flatMap((item) => [item.nameZh, item.nameEn, ...(item.aliases ?? [])]),
  ];
  entries.push({
    slug: data.slug,
    nameZh: data.nameZh,
    nameEn: data.nameEn,
    category: data.category,
    baseSpirit: data.baseSpirit,
    baseLabel: baseLabels[data.baseSpirit] || data.baseSpirit,
    flavorGroups: flavorGroupIds,
    flavorLabels: flavorGroupIds.map((id) => flavorGroups.find((group) => group.id === id)?.label || id),
    styleGroups: styleGroupIds,
    styleLabels: styleGroupIds.map((id) => styleGroups.find((group) => group.id === id)?.label || id),
    ingredients: (data.ingredients ?? []).map((item) => ({ nameZh: item.nameZh, nameEn: item.nameEn, aliases: item.aliases ?? [] })),
    tags: data.tags ?? [],
    image: data.image,
    imageAlt: data.imageAlt,
    search: normalize(searchParts.join(' ')),
  });
}
entries.sort((a, b) => a.nameEn.localeCompare(b.nameEn));
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify({ format: 1, generatedAt: new Date().toISOString(), count: entries.length, entries })}\n`, 'utf8');
console.log(`Generated ${entries.length} recipe index records at ${path.relative(repoRoot, outputFile)}`);
