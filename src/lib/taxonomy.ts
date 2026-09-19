export interface TaxonomyGroup {
  id: string;
  label: string;
  description: string;
  values: string[];
  matches?: (entry: TaxonomyEntry) => boolean;
}

export interface TaxonomyOption {
  value: string;
  label: string;
  description: string;
}

export interface TaxonomyEntry {
  slug?: string;
  flavors: string[];
  styles: string[];
}

/**
 * These groups are a browsing layer over the raw recipe vocabulary. The raw
 * values stay in content and are still used by detail pages and search.
 */
export const flavorGroups: TaxonomyGroup[] = [
  {
    id: 'citrus-refreshing',
    label: '清爽柑橘',
    description: '柑橘酸度、清新感或轻盈气泡带来的爽口风味。',
    values: ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'],
    matches: (entry) => entry.flavors.some((value) => ['fresh', 'refreshing', 'sour', 'tart', 'grapefruit', 'orange', 'dry', 'sparkling', 'tannic', 'agave', 'bright'].includes(value))
      || entry.styles.includes('sour'),
  },
  {
    id: 'fruity-tropical',
    label: '果香热带',
    description: '水果、桃子、椰子和热带果味主导的风味。',
    values: ['fruity', 'peach', 'tropical', 'coconut', 'apple', 'apricot', 'cherry', 'berry', 'grape'],
  },
  {
    id: 'herbal-floral',
    label: '草本花香',
    description: '草本、薄荷或花香带来的清幽香气。',
    values: ['herbal', 'floral', 'minty', 'mint', 'anise', 'cooling'],
  },
  {
    id: 'bitter-aperitif',
    label: '苦甜开胃',
    description: '苦味、甜苦或干爽结构，适合餐前慢慢品饮。',
    values: ['bitter', 'bittersweet', 'bitters', 'dry'],
  },
  {
    id: 'sweet-rounded',
    label: '甜润醇厚',
    description: '甜润、丝滑或带有可乐焦糖感的圆润风味。',
    values: ['sweet', 'creamy', 'silky', 'cola', 'honey', 'cocoa', 'rich'],
  },
  {
    id: 'spiced-smoky',
    label: '辛香烟熏',
    description: '香料、辛辣、姜、木质或烟熏带来的暖感。',
    values: ['spiced', 'spicy', 'ginger', 'woody', 'smoky', 'warming', 'strong'],
  },
  {
    id: 'coffee-nutty',
    label: '咖啡坚果',
    description: '咖啡烘焙香和杏仁、坚果等浓郁香气。',
    values: ['coffee', 'nutty', 'cocoa'],
  },
  {
    id: 'savory-salty',
    label: '咸鲜',
    description: '番茄、香料汁、盐和鲜味组成的餐食型风味。',
    values: ['savory', 'salty'],
  },
];

export const styleGroups: TaxonomyGroup[] = [
  {
    id: 'spirit-forward',
    label: '烈酒主导',
    description: '酒体集中、适合慢饮的经典短饮。',
    values: ['spirit-forward', 'stirred', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'],
    matches: (entry) => entry.styles.some((value) => ['spirit-forward', 'up', 'martini', 'equal-parts', 'absinthe-rinse', 'rocks'].includes(value))
      || (entry.styles.includes('stirred') && !entry.styles.includes('brunch') && !entry.styles.includes('highball')),
  },
  {
    id: 'sour-short',
    label: '酸酒短饮',
    description: '以柑橘和糖平衡酸度，摇匀后小杯享用。',
    values: ['sour', 'short', 'layered'],
    matches: (entry) => entry.styles.includes('sour') || entry.styles.includes('short'),
  },
  {
    id: 'refreshing-long',
    label: '清爽长饮',
    description: '加苏打、姜汁或其他 mixer，适合慢慢畅饮。',
    values: ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'],
    matches: (entry) => ['highball', 'long', 'fizz', 'mule', 'sling', 'punch', 'crushed-ice', 'cobbler', 'refreshing'].some((value) => entry.styles.includes(value)),
  },
  {
    id: 'sparkling-aperitif',
    label: '餐前与气泡',
    description: '带气泡或开胃酒风格，适合餐前和社交场合。',
    values: ['sparkling', 'aperitivo'],
    matches: (entry) => entry.styles.includes('aperitivo') || entry.styles.includes('sparkling'),
  },
  {
    id: 'tropical-iced',
    label: '热带冰饮',
    description: '热带风味、碎冰或搅打质地，适合轻松场合。',
    values: ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'],
    matches: (entry) => ['tropical', 'blended', 'frozen', 'muddled', 'swizzled', 'smash', 'tiki'].some((value) => entry.styles.includes(value))
      || entry.flavors.includes('tropical'),
  },
  {
    id: 'after-dinner',
    label: '餐后甜饮',
    description: '咖啡和甜香明显，适合餐后或夜晚饮用。',
    values: ['after-dinner', 'hot'],
    matches: (entry) => entry.styles.some((value) => ['after-dinner', 'hot'].includes(value)) || entry.flavors.some((value) => ['coffee', 'creamy'].includes(value)),
  },
];

export function groupValuesForEntry(entry: TaxonomyEntry, groups: TaxonomyGroup[], field: 'flavors' | 'styles'): string[] {
  const matched = groups
    .filter((group) => group.matches ? group.matches(entry) : group.values.some((value) => entry[field].includes(value)))
    .map((group) => group.id);
  // Imported recipes occasionally carry a method or flavor token outside the
  // browsing vocabulary. Keep them discoverable under an existing macro group
  // so every card remains reachable without adding raw filter options.
  if (matched.length) return matched;
  if (field === 'flavors') return groups.some((group) => group.id === 'citrus-refreshing') ? ['citrus-refreshing'] : [];
  return groups.some((group) => group.id === 'refreshing-long') ? ['refreshing-long'] : [];
}

export function groupLabel(value: string, groups: TaxonomyGroup[]): string {
  return groups.find((group) => group.id === value)?.label ?? value;
}

export function groupOptions(groups: TaxonomyGroup[], entries: any[], field: 'flavors' | 'styles'): TaxonomyOption[] {
  return groups
    .filter((group) => entries.some((entry) => groupValuesForEntry(entry.data, groups, field).includes(group.id)))
    .map(({ id, label, description }) => ({ value: id, label, description }));
}

export function assertTaxonomyCoverage(entries: any[]): void {
  const missing = entries
    .filter((entry) => !groupValuesForEntry(entry.data, flavorGroups, 'flavors').length
      || !groupValuesForEntry(entry.data, styleGroups, 'styles').length)
    .map((entry) => entry.data.slug);
  if (missing.length) throw new Error(`Taxonomy coverage missing for: ${missing.join(', ')}`);

  const ids = (slug: string) => {
    const entry = entries.find((item) => item.data.slug === slug);
    if (!entry) throw new Error(`Taxonomy assertion recipe not found: ${slug}`);
    return groupValuesForEntry(entry.data, styleGroups, 'styles');
  };
  if (ids('bloody-mary').includes('spirit-forward')) throw new Error('Bloody Mary must not be spirit-forward');
  if (ids('espresso-martini').includes('sour-short')) throw new Error('Espresso Martini must not be a sour short drink');
  if (!ids('old-fashioned').includes('spirit-forward')) throw new Error('Old Fashioned must be spirit-forward');
  const sling = ids('singapore-sling');
  if (!sling.includes('refreshing-long') || !sling.includes('tropical-iced')) {
    throw new Error('Singapore Sling must be a refreshing long tropical drink');
  }
  const bloody = entries.find((item) => item.data.slug === 'bloody-mary');
  const bloodyFlavors = groupValuesForEntry(bloody.data, flavorGroups, 'flavors');
  if (!bloodyFlavors.includes('savory-salty')) throw new Error('Bloody Mary must be savory-salty');
  if (!ids('bloody-mary').includes('refreshing-long')) throw new Error('Bloody Mary must be a refreshing long drink');
}
