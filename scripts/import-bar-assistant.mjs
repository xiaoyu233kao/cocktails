// Import the vendored Bar Assistant snapshot without copying its source images.
// Run with `node scripts/import-bar-assistant.mjs`; set BAR_ASSISTANT_DATA_DIR
// to use an external snapshot while developing. The checked-in vendor copy is
// the default so CI never needs network access.
// @ts-nocheck
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, unlink, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultVendorRoot = path.join(repoRoot, 'vendor', 'bar-assistant-data-v5');
const vendorRoot = path.resolve(process.env.BAR_ASSISTANT_DATA_DIR || defaultVendorRoot);
const vendorCocktails = path.join(vendorRoot, 'data', 'cocktails');
const contentRoot = path.join(repoRoot, 'src', 'content', 'cocktails');
const communityRoot = path.join(contentRoot, 'community');
const dataRoot = path.join(repoRoot, 'src', 'data');
const imageRoot = path.join(repoRoot, 'public', 'images', 'cocktails');
const importManifestPath = path.join(dataRoot, 'community-import-manifest.json');
const checkedAt = process.env.CONTENT_CHECKED_AT || '2026-09-20';
const snapshotCommit = '5a504d474614494119882eb91a8ffdc5491a483f';
const snapshotBaseUrl = `https://github.com/bar-assistant/data/tree/${snapshotCommit}`;
const snapshotFileUrl = (id) => `https://github.com/bar-assistant/data/blob/${snapshotCommit}/data/cocktails/${id}/data.json`;
const dryRun = process.argv.includes('--dry-run');

const normalizeName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[’‘'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const slugify = (value, fallback = 'recipe') => {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/№/g, ' no ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
};

const unique = (values) => [...new Set(values.filter(Boolean))];
const hasHan = (value) => /[\u3400-\u9fff]/u.test(value);
const chineseCount = (value) => (String(value).match(/[\u3400-\u9fff]/g) ?? []).length;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  return match ? parse(match[1]) : null;
}

async function readNameMap(file) {
  if (!(await exists(file))) return new Map();
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const map = new Map();
  const add = (nameEn, nameZh) => {
    if (typeof nameEn === 'string' && typeof nameZh === 'string' && nameZh.trim()) {
      map.set(normalizeName(nameEn), nameZh.trim());
    }
  };
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.entries)) {
      value.entries.forEach(visit);
      return;
    }
    if (typeof value.nameEn === 'string' && typeof value.nameZh === 'string') {
      add(value.nameEn, value.nameZh);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') add(key, item);
      else if (item && typeof item === 'object') {
        add(item.nameEn || key, item.nameZh);
        add(key, item.nameZh);
        for (const alias of item.aliases ?? []) add(alias, item.nameZh);
      }
    }
  };
  visit(raw);
  return map;
}

async function readAliases() {
  const file = path.join(dataRoot, 'community-aliases.json');
  if (!(await exists(file))) return [];
  const raw = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('community-aliases.json must contain an array');
  return raw.filter((item) => item && typeof item.targetSlug === 'string' && Array.isArray(item.aliases));
}

async function readIngredientLabels() {
  const file = path.join(dataRoot, 'ingredient-labels.json');
  const labels = (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : { exact: {}, contains: [] };
  const communityFile = path.join(dataRoot, 'community-ingredients-zh.json');
  labels.ids = (await exists(communityFile)) ? JSON.parse(await readFile(communityFile, 'utf8')) : {};
  return labels;
}

function ingredientNameZh(name, id, labels) {
  const original = String(name ?? '').trim();
  const key = original.toLowerCase();
  if (labels.ids?.[String(id ?? '').toLowerCase()]) return labels.ids[String(id).toLowerCase()];
  if (labels.exact?.[key]) return labels.exact[key];
  const match = (labels.contains ?? []).find(([needle]) => key.includes(needle));
  if (match) {
    const replacement = original.replace(new RegExp(match[0], 'ig'), match[1]);
    if (hasHan(replacement)) return replacement;
  }
  const wordMap = [
    ['passionfruit', '百香果'], ['grapefruit', '葡萄柚'], ['pineapple', '菠萝'],
    ['cranberry', '蔓越莓'], ['blackberry', '黑莓'], ['raspberry', '覆盆子'],
    ['strawberry', '草莓'], ['apricot', '杏子'], ['peach', '桃'], ['cherry', '樱桃'],
    ['orange', '橙'], ['lemon', '柠檬'], ['lime', '青柠'], ['apple', '苹果'],
    ['pear', '梨'], ['coconut', '椰子'], ['juice', '果汁'], ['syrup', '糖浆'],
    ['bitters', '苦精'], ['liqueur', '利口酒'], ['vermouth', '味美思'],
    ['whiskey', '威士忌'], ['whisky', '威士忌'], ['brandy', '白兰地'],
    ['cognac', '干邑白兰地'], ['rum', '朗姆酒'], ['rhum', '朗姆酒'],
    ['vodka', '伏特加'], ['tequila', '龙舌兰酒'], ['mezcal', '梅斯卡尔'],
    ['gin', '金酒'], ['coffee', '咖啡'], ['cream', '奶油'], ['milk', '牛奶'],
    ['honey', '蜂蜜'], ['sugar', '糖'], ['ginger beer', '姜汁啤酒'],
    ['ginger ale', '姜汁汽水'], ['soda', '苏打水'], ['champagne', '香槟'],
    ['prosecco', '普罗塞克'], ['wine', '葡萄酒'], ['mint', '薄荷'],
    ['basil', '罗勒'], ['rosemary', '迷迭香'], ['cinnamon', '肉桂'],
    ['salt', '盐'], ['water', '水'],
  ];
  let translated = original;
  for (const [needle, replacement] of wordMap) {
    translated = translated.replace(new RegExp(needle, 'ig'), replacement);
  }
  return hasHan(translated) ? translated : `原料 ${original}`;
}

function garnishZh(value) {
  const original = String(value ?? '').trim();
  if (!original) return '资料未指定';
  if (hasHan(original) && !/[a-z]/i.test(original)) return original;
  let translated = original.toLowerCase();
  const replacements = [
    ['orange twist', '橙皮扭饰'], ['lemon twist', '柠檬皮扭饰'], ['lime twist', '青柠皮扭饰'],
    ['grapefruit twist', '葡萄柚皮扭饰'], ['orange peel', '橙皮'], ['lemon peel', '柠檬皮'],
    ['lime peel', '青柠皮'], ['grapefruit peel', '葡萄柚皮'], ['orange wheel', '橙轮'],
    ['lemon wheel', '柠檬轮'], ['lime wheel', '青柠轮'], ['grapefruit wheel', '葡萄柚轮'],
    ['orange wedge', '橙角'], ['lemon wedge', '柠檬角'], ['lime wedge', '青柠角'],
    ['dehydrated pineapple', '脱水菠萝'], ['pineapple leaf', '菠萝叶'], ['pineapple fronds', '菠萝叶'],
    ['mint sprig', '薄荷枝'], ['mint leaves', '薄荷叶'], ['basil sprig', '罗勒枝'],
    ['rosemary sprig', '迷迭香枝'], ['thyme sprig', '百里香枝'], ['brandied cherries', '酒浸樱桃'],
    ['maraschino cherry', '马拉斯奇诺樱桃'], ['cocktail cherry', '鸡尾酒樱桃'], ['sea salt', '海盐'],
    ['sugar rim', '糖口'], ['salt rim', '盐口'], ['cinnamon stick', '肉桂棒'], ['instant coffee', '速溶咖啡'],
    ['whipped cream', '打发奶油'], ['aromatic bitters', '芳香苦精'], ['angostura bitters', '安高天娜苦精'],
    ['clover blossom', '三叶草花'], ['rose water', '玫瑰水'], ['bay leaf', '月桂叶'], ['harissa spice', '哈里萨香料'],
    ['passionfruit', '百香果'], ['grapefruit', '葡萄柚'], ['pineapple', '菠萝'], ['coconut', '椰子'],
    ['cherries', '樱桃'], ['cherry', '樱桃'], ['maraschino', '马拉斯奇诺'], ['olive', '橄榄'],
    ['berries', '浆果'], ['berry', '浆果'], ['currants', '醋栗'], ['orchid', '兰花'], ['fronds', '叶饰'],
    ['cinnamon', '肉桂'], ['nutmeg', '肉豆蔻粉'], ['cocoa', '可可'], ['coffee', '咖啡'], ['salt', '盐'],
    ['sugar', '糖'], ['mint', '薄荷'], ['basil', '罗勒'], ['rosemary', '迷迭香'], ['thyme', '百里香'],
    ['orange', '橙'], ['lemon', '柠檬'], ['lime', '青柠'], ['tangerine', '橘'], ['zest', '皮屑'],
    ['tajin', '辣椒盐'], ['chili', '辣椒'], ['pepper', '胡椒'], ['twist', '皮扭饰'], ['peel', '果皮'],
    ['wheel', '果轮'], ['wedge', '果角'], ['sprig', '枝饰'], ['sprigs', '枝饰'], ['slice', '薄片'],
    ['slices', '薄片'], ['powder', '粉'], ['dust', '薄撒'], ['rind', '果皮'], ['foam', '泡沫'], ['spray', '喷香'],
    ['leaf', '叶'], ['leaves', '叶'], ['blossom', '花'], ['flower', '花'], ['petal', '花瓣'], ['frond', '叶饰'],
  ];
  for (const [needle, replacement] of replacements) {
    translated = translated.replace(new RegExp(`\\b${needle}\\b`, 'ig'), replacement);
  }
  // Keep quantities but discard untranslated English words so the display field
  // remains Chinese even when the source uses a rare house garnish.
  translated = translated.replace(/\b[a-z][a-z0-9'’+\-]*\b/gi, ' ')
    .replace(/[,:;()\/]+/g, '、').replace(/\s+/g, '').replace(/、+/g, '、').replace(/^、|、$/g, '');
  return hasHan(translated) ? translated : '按资料指定的装饰';
}

function durationFacts(instructions) {
  const text = String(instructions ?? '');
  const facts = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/ig;
  for (const match of text.matchAll(pattern)) {
    const unit = /^s/i.test(match[2]) ? '秒' : /^m/i.test(match[2]) ? '分钟' : '小时';
    facts.push(`原资料标注约${match[1]}${unit}的处理时间`);
  }
  const temperatures = [...text.matchAll(/(-?\d+)\s*°?\s*([CF])/ig)];
  for (const match of temperatures) facts.push(`原资料标注约${match[1]}°${match[2].toUpperCase()}的温度`);
  return unique(facts).slice(0, 2);
}

function stepsZh(recipe, ingredients, glass, garnish) {
  const method = String(recipe.method ?? '').trim();
  const methodZh = methodLabels[method] || '调制';
  const glassZh = glassLabels[glass] || '合适的酒杯';
  const ingredientText = ingredients.slice(0, 5).map((item) => item.nameZh).filter(Boolean).join('、') || '配方原料';
  let first;
  if (/shake/i.test(method)) {
    first = `将${ingredientText}加入摇酒器，加入冰块后充分摇和至冰镇；滤入${glassZh}。`;
  } else if (/stir/i.test(method)) {
    first = `将${ingredientText}加入搅拌杯并加冰，搅拌至充分冰镇；滤入${glassZh}。`;
  } else if (/blend/i.test(method)) {
    first = `将${ingredientText}与冰块加入搅拌机，搅打至顺滑；倒入${glassZh}。`;
  } else if (/muddle/i.test(method)) {
    first = `先在${glassZh}或调酒杯中轻压部分原料，再加入${ingredientText}与冰块混合。`;
  } else if (/layer/i.test(method)) {
    first = `将${ingredientText}按密度由重至轻缓慢分层倒入${glassZh}，保持层次清晰。`;
  } else {
    first = `将${ingredientText}按配方顺序加入${glassZh}，采用${methodZh}完成混合并加入适量冰块。`;
  }
  const steps = [first, ...durationFacts(recipe.instructions).map((fact) => `${fact}，以便复核冰镇与稀释程度。`)];
  if (garnish && garnish !== '资料未指定') steps.push(`以${garnish}装饰后尽快饮用。`);
  else steps.push('完成后按需补充装饰，并在冰镇状态下饮用。');
  return steps;
}

function amountText(ingredient) {
  const amount = ingredient.amount;
  const maximum = ingredient.amount_max;
  const amountPart = maximum !== null && maximum !== undefined && maximum !== amount
    ? `${amount}–${maximum}`
    : String(amount);
  const unit = String(ingredient.units ?? '').trim();
  const note = String(ingredient.note ?? '').trim();
  return `${amountPart} ${unit}${note ? `（${note}）` : ''}`.trim();
}

function inferBaseSpirit(recipe) {
  const text = (recipe.ingredients ?? []).map((item) => `${item._id} ${item.name}`).join(' ').toLowerCase();
  if (/\b(cachaça|cachaca)\b/.test(text)) return 'cachaca';
  const kinds = [];
  if (/\b(gin|juniper)\b/.test(text)) kinds.push('gin');
  if (/\b(vodka)\b/.test(text)) kinds.push('vodka');
  if (/\b(rum|rhum|molasses)\b/.test(text)) kinds.push('rum');
  if (/\b(tequila|mezcal|agave)\b/.test(text)) kinds.push('tequila');
  if (/\b(whisk(?:e|y)|bourbon|rye|scotch)\b/.test(text)) kinds.push('whiskey');
  if (/\b(brandy|cognac|armagnac|calvados|apple brandy)\b/.test(text)) kinds.push('brandy');
  if (/\b(pisco)\b/.test(text)) kinds.push('pisco');
  if (/\b(vermouth|amaro|aperol|campari|cynar|fernet|chartreuse|liqueur|bitters)\b/.test(text)) kinds.push('aperitif');
  if (/\b(wine|champagne|prosecco|sherry|port|cava|beer|cider)\b/.test(text)) kinds.push('wine');
  const distinct = unique(kinds);
  if (distinct.length === 1) return distinct[0];
  if (distinct.length > 1) return 'multi';
  if ((recipe.tags ?? []).some((tag) => /virgin|non.?alcoholic/i.test(tag))) return 'none';
  return 'none';
}

function inferFlavors(recipe) {
  const text = `${(recipe.tags ?? []).join(' ')} ${(recipe.ingredients ?? []).map((item) => `${item._id} ${item.name}`).join(' ')}`.toLowerCase();
  const flavors = [];
  const add = (value) => { if (!flavors.includes(value)) flavors.push(value); };
  if (/citrus|citrusy|lemon|lime|orange|grapefruit|tart|sour|bright|refresh/.test(text)) add('fresh');
  if (/sour|tart/.test(text)) add('sour');
  if (/fruit|berry|cherry|apple|pear|peach|apricot|passion|pineapple|coconut|tropical/.test(text)) add('fruity');
  if (/tropical|pineapple|coconut|passion/.test(text)) add('tropical');
  if (/herbal|herbacious|mint|basil|rosemary|thyme|sage|floral|violet|chartreuse/.test(text)) add('herbal');
  if (/floral|violet|elderflower|hibiscus|chamomile/.test(text)) add('floral');
  if (/bitter|bitters|campari|aperol|amaro|cynar|fernet/.test(text)) add('bitter');
  if (/sweet|sugar|syrup|honey|orgeat|dessert|cream|cocoa|chocolate/.test(text)) add('sweet');
  if (/smok|mezcal|peat|scotch/.test(text)) add('smoky');
  if (/spic|ginger|pepper|cinnamon|clove|cardamom/.test(text)) add('spiced');
  if (/coffee|espresso|cacao|chocolate|nut/.test(text)) add('coffee');
  if (/savory|salty|tomato|olive|salt|worcester/.test(text)) add('savory');
  if (!flavors.length) flavors.push('fresh');
  return flavors;
}

function inferStyles(recipe, flavors) {
  const method = String(recipe.method ?? '').toLowerCase();
  const text = `${(recipe.tags ?? []).join(' ')} ${(recipe.glass ?? '')} ${method}`.toLowerCase();
  const styles = [];
  const add = (value) => { if (!styles.includes(value)) styles.push(value); };
  if (/shake/.test(method)) add('short');
  if (/stir/.test(method)) add('stirred');
  if (/build/.test(method)) {
    add('built');
    add(/highball|collins|mug|fizzio/.test(text) ? 'highball' : 'rocks');
  }
  if (/blend/.test(method)) add('blended');
  if (/muddle/.test(method)) add('muddled');
  if (/layer/.test(method)) add('layered');
  if (/fizz/.test(text)) add('fizz');
  if (/mule/.test(text)) add('mule');
  if (/sling/.test(text)) add('sling');
  if (/punch/.test(text)) add('punch');
  if (/spritz|sparkling|champagne|prosecco/.test(text)) add('sparkling');
  if (/aperitivo|aperitif/.test(text)) add('aperitivo');
  if (/tiki|tropical/.test(text) || flavors.includes('tropical')) add('tropical');
  if (/smash|julep/.test(text)) add('smash');
  if (/swizzle/.test(text)) add('swizzled');
  if (/highball|collins|mug|fizzio/.test(text)) add('highball');
  if (/lowball|rocks|old fashioned/.test(text)) add('rocks');
  if (/hot|coffee/.test(text)) add('hot');
  if (/dessert|after.?dinner|coffee/.test(text)) add('after-dinner');
  if (!styles.length) add('short');
  return styles;
}

const flavorLabels = {
  fresh: '清新', sour: '酸爽', fruity: '果香', tropical: '热带', herbal: '草本', floral: '花香',
  bitter: '苦香', sweet: '甜润', smoky: '烟熏', spiced: '辛香', coffee: '咖啡', savory: '咸鲜',
};
const baseLabels = {
  gin: '金酒', vodka: '伏特加', rum: '朗姆酒', tequila: '龙舌兰酒', whiskey: '威士忌', brandy: '白兰地',
  pisco: '皮斯科', cachaca: '卡莎萨', wine: '葡萄酒', aperitif: '开胃酒', multi: '复合基酒', none: '无酒精',
};
const methodLabels = { Shake: '摇和', Stir: '搅拌', Build: '直接调制', Blend: '搅打', Muddle: '捣压', Layer: '分层' };
const glassLabels = {
  Lowball: '古典杯', Highball: '高球杯', Coupe: '酒碟杯', Cocktail: '鸡尾酒杯', 'Nick and Nora': '尼克与诺拉杯',
  Wine: '葡萄酒杯', Hurricane: '飓风杯', 'Glass mug': '玻璃杯', Tiki: '提基杯', Champagne: '香槟杯',
  Fizzio: '菲士杯', Julep: '朱利普杯', Shot: '烈酒杯', Absinthe: '苦艾酒杯', Margarita: '玛格丽塔杯', 'Copper mug': '铜杯',
};

function backgroundText({ nameZh, ingredients, baseSpirit, method, glass, garnish, flavors }) {
  const core = ingredients.slice(0, 3).map((item) => item.nameZh).join('、') || '配方原料';
  const flavorText = unique(flavors.map((value) => flavorLabels[value] || value)).slice(0, 3).join('、') || '清晰';
  const methodZh = methodLabels[method] || method || '按配方混合';
  const glassZh = glassLabels[glass] || glass || '适合的酒杯';
  const garnishZh = garnish && garnish !== '资料未指定' ? garnish : '不额外添加装饰';
  const baseZh = baseLabels[baseSpirit] || baseSpirit;
  let result = `${nameZh}以${core}为核心，资料记录的基酒结构归入${baseZh}，并采用${methodZh}完成混合。成酒建议装入${glassZh}，以${garnishZh}收尾；${flavorText}共同构成它的主要风味，甜酸、酒体和稀释度会随原料与冰量变化。建议先充分冷却，再在合适的冰量下尽快饮用，以保持香气、口感和温度的平衡。当前快照未提供可核验的创制年份或作者，因此不对年代、地点和人物作历史推断；原始来源与快照地址见来源字段。`;
  if (chineseCount(result) > 240) {
    result = `${nameZh}以${core}为核心，采用${methodZh}完成混合，并建议装入${glassZh}，以${garnishZh}收尾。成酒呈现${flavorText}风味，甜酸、酒体和稀释度会随原料与冰量变化；建议充分冷却后尽快饮用。当前快照未提供可核验的创制年份或作者，因此不对年代、地点和人物作历史推断；原始来源与快照地址见来源字段。`;
  }
  while (chineseCount(result) < 160) {
    result += '这段说明只整理快照中可直接核对的配方事实，后续若有新的可靠资料，应单独补充来源并重新核对。';
  }
  return result;
}

function renderSvgLegacy({ slug, nameZh, recipe }) {
  const hash = sha256(slug);
  const number = (offset) => Number.parseInt(hash.slice(offset, offset + 2), 16);
  const liquidColors = ['#b84c2d', '#d59a35', '#c96b38', '#7c9b54', '#895f9f', '#8a4b35', '#d3bd6b', '#507d8f'];
  const accentColors = ['#f2bc62', '#d66f4b', '#a4c46b', '#79a9c4', '#d5a4c2', '#f4d18d'];
  const liquid = liquidColors[number(0) % liquidColors.length];
  const accent = accentColors[number(2) % accentColors.length];
  const bokeh = Array.from({ length: 8 }, (_, index) => {
    const x = 90 + number(4 + index * 2) * 4.2;
    const y = 90 + number(5 + index * 2) * 2.3;
    const radius = 9 + number(6 + index * 2) % 30;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${accent}" opacity="${(0.08 + (number(7 + index * 2) % 12) / 100).toFixed(2)}"/>`;
  }).join('');
  const glass = String(recipe.glass ?? '').toLowerCase();
  const kind = /highball|fizzio|mug/.test(glass) ? 'highball'
    : /coupe|cocktail|nick|wine|champagne/.test(glass) ? 'stem'
      : /hurricane|tiki|julep/.test(glass) ? 'curved' : /shot/.test(glass) ? 'shot' : 'rocks';
  const liquidY = kind === 'highball' ? 360 : kind === 'stem' ? 340 : kind === 'curved' ? 310 : kind === 'shot' ? 385 : 390;
  const liquidH = kind === 'highball' ? 270 : kind === 'stem' ? 145 : kind === 'curved' ? 250 : kind === 'shot' ? 95 : 145;
  let vessel;
  if (kind === 'stem') {
    vessel = `<path d="M405 245 Q600 350 795 245 L745 430 Q600 520 455 430 Z" fill="url(#drink)" stroke="#f5d6ad" stroke-width="5" opacity=".96"/><path d="M600 430 L600 635" stroke="#f5d6ad" stroke-width="6"/><path d="M485 650 Q600 625 715 650" fill="none" stroke="#f5d6ad" stroke-width="6"/>`;
  } else if (kind === 'highball') {
    vessel = `<path d="M435 240 L765 240 L735 700 Q600 760 465 700 Z" fill="url(#drink)" stroke="#f5d6ad" stroke-width="6" opacity=".96"/>`;
  } else if (kind === 'curved') {
    vessel = `<path d="M450 255 Q600 205 750 255 L715 680 Q600 745 485 680 Z" fill="url(#drink)" stroke="#f5d6ad" stroke-width="6" opacity=".96"/>`;
  } else if (kind === 'shot') {
    vessel = `<path d="M500 390 L700 390 L680 570 Q600 600 520 570 Z" fill="url(#drink)" stroke="#f5d6ad" stroke-width="6" opacity=".96"/>`;
  } else {
    vessel = `<path d="M425 310 L775 310 L745 600 Q600 690 455 600 Z" fill="url(#drink)" stroke="#f5d6ad" stroke-width="6" opacity=".96"/>`;
  }
  const ice = /shake|stir|muddle|build/i.test(recipe.method ?? '')
    ? `<g fill="#f3dfc0" opacity=".52"><rect x="500" y="${liquidY + 18}" width="70" height="55" rx="9" transform="rotate(-12 535 ${liquidY + 45})"/><rect x="600" y="${liquidY + 8}" width="70" height="55" rx="9" transform="rotate(17 635 ${liquidY + 35})"/><rect x="555" y="${liquidY + 80}" width="70" height="55" rx="9" transform="rotate(-4 590 ${liquidY + 107})"/></g>`
    : `<g fill="#f3dfc0" opacity=".45"><circle cx="550" cy="${liquidY + 45}" r="15"/><circle cx="610" cy="${liquidY + 65}" r="17"/><circle cx="665" cy="${liquidY + 35}" r="13"/><circle cx="585" cy="${liquidY + 105}" r="14"/></g>`;
  const garnishText = String(recipe.garnish ?? '').toLowerCase();
  const garnish = /lemon|lime|orange|grapefruit|citrus|twist|peel|wheel|wedge/.test(garnishText)
    ? `<path d="M735 300 Q805 225 850 300" fill="none" stroke="#e9b64e" stroke-width="16" stroke-linecap="round"/><path d="M740 300 Q804 240 844 300" fill="none" stroke="#6f8e4f" stroke-width="4"/>`
    : /mint|basil|rosemary|herb/.test(garnishText)
      ? `<path d="M730 305 Q790 210 845 275" fill="none" stroke="#83a85c" stroke-width="8"/><ellipse cx="770" cy="255" rx="16" ry="35" fill="#83a85c" transform="rotate(35 770 255)"/><ellipse cx="810" cy="230" rx="16" ry="35" fill="#9abd71" transform="rotate(60 810 230)"/>`
      : /cherry|olive|berry/.test(garnishText)
        ? `<circle cx="790" cy="265" r="24" fill="#a94348"/><path d="M790 245 Q785 190 820 180" fill="none" stroke="#6f8e4f" stroke-width="6"/>`
        : `<ellipse cx="800" cy="270" rx="45" ry="10" fill="#f0ca79" opacity=".75"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" role="img" aria-labelledby="title desc" data-slug="${escapeXml(slug)}">
  <title id="title">${escapeXml(nameZh)}程序化示意图</title>
  <desc id="desc">深色酒吧背景中的${escapeXml(nameZh)}酒杯、冰块与装饰。</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111214"/><stop offset=".55" stop-color="#24201e"/><stop offset="1" stop-color="#0e1012"/></linearGradient>
    <linearGradient id="drink" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${liquid}" stop-opacity=".86"/><stop offset="1" stop-color="#211a18" stop-opacity=".94"/></linearGradient>
    <radialGradient id="light" cx="0.16" cy="0.16" r="0.74"><stop stop-color="${accent}" stop-opacity=".58"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <ellipse cx="190" cy="120" rx="430" ry="350" fill="url(#light)" filter="url(#blur)"/>
  <g>${bokeh}</g>
  <path d="M0 755 Q260 685 520 748 T1200 720 V900 H0 Z" fill="#090a0b" opacity=".86"/>
  <ellipse cx="600" cy="720" rx="300" ry="28" fill="#000" opacity=".55"/>
  ${vessel}
  ${ice}
  ${garnish}
  <path d="M365 255 Q600 205 835 255" fill="none" stroke="#f7dfba" stroke-width="3" opacity=".36"/>
</svg>\n`.replace(/[ \t]+$/gm, '');
}

// Keep the community artwork local and deterministic. The tokens below are
// derived from the recipe rather than from source images: the same recipe
// always gets the same composition, while its ingredients and service notes
// change the liquid, glass, ice, foam, bubbles, rim and garnish.
function renderSvg({ slug, nameZh, recipe }) {
  const ingredientText = (recipe.ingredients ?? [])
    .map((item) => `${item._id ?? ''} ${item.name ?? ''}`)
    .join(' ')
    .toLowerCase();
  const sourceText = `${slug} ${recipe.name ?? ''} ${recipe.method ?? ''} ${recipe.glass ?? ''} ${recipe.garnish ?? ''} ${recipe.description ?? ''} ${recipe.tags ?? ''} ${ingredientText}`.toLowerCase();
  const hash = sha256(`${slug}|${ingredientText}|${recipe.method ?? ''}|${recipe.glass ?? ''}`);
  const number = (offset) => Number.parseInt(hash.slice(offset % (hash.length - 2), (offset % (hash.length - 2)) + 2), 16);
  const pick = (values, offset = 0) => values[number(offset) % values.length];
  const glassText = String(recipe.glass ?? '').toLowerCase();
  const methodText = String(recipe.method ?? '').toLowerCase();
  const garnishText = String(recipe.garnish ?? '').toLowerCase();
  const spritzLike = /\bspritz(?:er)?\b/.test(sourceText);
  const rimSourceText = `${garnishText} ${recipe.description ?? ''} ${recipe.instructions ?? ''} ${recipe.rim ?? ''}`.toLowerCase();
  const glassKind = /tiki/.test(glassText) ? 'tiki'
    : /julep/.test(glassText) ? 'julep'
      : /copper|mug/.test(glassText) ? 'mug'
        : /hurricane/.test(glassText) ? 'hurricane'
          : /shot/.test(glassText) ? 'shot'
            : /flute|champagne/.test(glassText) ? 'flute'
              : /coupe/.test(glassText) ? 'coupe'
                : /martini|cocktail|nick/.test(glassText) ? 'martini'
                  : /wine|goblet/.test(glassText) ? 'wine'
                    : /highball|fizzio|collins/.test(glassText) ? 'highball' : 'rocks';
  const servedUp = !spritzLike && /up|straight|neat|coupe|martini|cocktail|nick|flute/.test(`${glassText} ${methodText}`)
    && !/mug|julep|tiki|hurricane|highball|rocks/.test(glassText);
  const iceKind = /frozen|slush|snow|granita|frappe/.test(sourceText) || /blend/.test(methodText) ? 'frozen'
    : /crushed|pebble|swizzle|snow cone|sno-cone/.test(sourceText) ? 'crushed'
      : /large cube|king cube|big rock|single cube|one large/.test(sourceText) ? 'big'
        : spritzLike ? 'standard' : servedUp ? 'up' : 'standard';
  const foamBase = /egg\s*white|eggwhite|aquafaba|foam|froth|whipped\s+cream/.test(sourceText);
  const flipFoam = /\bflip\b/.test(sourceText) && /egg|yolk|cream|milk/.test(ingredientText);
  const fizzFoam = /\bfizz\b/.test(sourceText) && /egg\s*white|eggwhite|aquafaba|foam|froth|whipped\s+cream/.test(ingredientText);
  const foam = foamBase || flipFoam || fizzFoam;
  const bubbles = /champagne|prosecco|sparkling|tonic|soda|cola|coke|ginger\s*beer|ginger\s*ale|lemon[- ]lime\s+soda|beer|cider|fizz|bubbles/.test(sourceText);
  const explicitRim = /\brim(?:med|ming)?\b|\bedge(?:d)?\b/.test(rimSourceText);
  const garnishSalt = /\bsalt(?:ed)?\b|taj[ií]n|chili salt|chilli salt/.test(garnishText);
  const rimKind = /taj[ií]n|chili salt|chilli salt/.test(rimSourceText) && (explicitRim || garnishSalt) ? 'tajin'
    : (explicitRim && /salt|saline/.test(rimSourceText)) || garnishSalt ? 'salt'
      : /sugar rim|sugared|cinnamon sugar/.test(rimSourceText) && (explicitRim || /sugar/.test(garnishText)) ? 'sugar' : 'none';
  const garnishSignals = {
    citrus: /lemon|lime|orange|grapefruit|yuzu|citrus|peel|twist|wheel|wedge/.test(garnishText),
    cherry: /cherry|maraschino|berry|berries/.test(garnishText),
    mint: /mint|basil|rosemary|thyme|sage|herb/.test(garnishText),
    olive: /olive|pick/.test(garnishText),
    pineapple: /pineapple|frond|leaf/.test(garnishText),
    flower: /orchid|gardenia|flower|blossom|petal|violet/.test(garnishText),
    spice: /cinnamon|nutmeg|clove|cardamom|star anise|pepper|spice/.test(garnishText),
  };
  const garnishKinds = Object.entries(garnishSignals).filter(([, matches]) => matches).map(([kind]) => kind);
  const garnishKind = garnishKinds.join('+') || 'none';

  const liquidPalette = ingredientText.match(/coffee|espresso|cacao|cocoa|chocolate|cola/)
    ? ['#4b281d', '#7a4329', '#a56636']
    : ingredientText.match(/berry|berries|cherry|hibiscus|pomegranate|cranberry|grenadine/)
      ? ['#7f263b', '#b6404b', '#d26d5b']
      : ingredientText.match(/mint|basil|cucumber|celery|matcha|herb|chartreuse/)
        ? ['#497453', '#6f9a60', '#a8b86c']
        : ingredientText.match(/campari|aperol|select aperitivo|amaro|bitter|cynar|fernet|red\s+(?:bitter|vermouth|wine)|rosso/)
          ? ['#7e302d', '#a54835', '#bf6a43']
          : ingredientText.match(/pineapple|passion|mango|banana|apricot|peach|tropical|orange|lemon|lime|grapefruit|yuzu/)
            ? ['#d18d2b', '#e4b54e', '#edcf78']
            : ingredientText.match(/mezcal|smok|peat|scotch|whiskey|bourbon|rye|brandy|cognac|rum|rhum/)
              ? ['#86502c', '#b8783b', '#d39e55']
              : ['#a6b8b4', '#cbd0b0', '#e0d7b6'];
  const liquid = pick(liquidPalette, 0);
  const liquidAlt = pick(liquidPalette, 4);
  const liquidDark = pick(['#24191b', '#30231b', '#1e2521', '#272036'], 8);
  const backgroundAccent = pick(['#d79754', '#c46c58', '#9bb46b', '#709eb4', '#c59ba9'], 10);
  const isClear = /clear|dry|vodka|gin|tonic|soda|white/.test(sourceText) && !/coffee|berry|chocolate|red|cream/.test(sourceText);
  const opacity = iceKind === 'frozen' ? 0.92 : isClear ? 0.48 : bubbles ? 0.64 : 0.84;
  const spec = {
    rocks: { path: 'M420 305 L780 305 L748 620 Q600 700 452 620 Z', liquidY: 315, liquidH: 310, rim: 'M420 305 Q600 330 780 305', stem: '' },
    highball: { path: 'M455 235 L745 235 L725 710 Q600 765 475 710 Z', liquidY: 245, liquidH: 480, rim: 'M455 235 L745 235', stem: '' },
    coupe: { path: 'M390 250 Q600 340 810 250 L760 430 Q600 520 440 430 Z', liquidY: 270, liquidH: 230, rim: 'M390 250 Q600 340 810 250', stem: 'M600 430 L600 650 M480 665 Q600 640 720 665' },
    martini: { path: 'M390 250 L810 250 L600 505 Z', liquidY: 260, liquidH: 250, rim: 'M390 250 L810 250', stem: 'M600 505 L600 650 M480 665 Q600 640 720 665' },
    flute: { path: 'M510 225 L690 225 L675 635 Q600 680 525 635 Z', liquidY: 235, liquidH: 430, rim: 'M510 225 L690 225', stem: 'M600 635 L600 695 M505 710 Q600 690 695 710' },
    hurricane: { path: 'M450 270 Q600 205 750 270 L720 675 Q600 750 480 675 Z', liquidY: 280, liquidH: 410, rim: 'M450 270 Q600 205 750 270', stem: '' },
    mug: { path: 'M445 275 Q600 235 755 275 L735 640 Q600 715 465 640 Z', liquidY: 285, liquidH: 380, rim: 'M445 275 Q600 235 755 275', stem: 'M755 350 Q900 330 890 485 Q875 570 742 520' },
    julep: { path: 'M465 265 L735 265 L710 665 Q600 730 490 665 Z', liquidY: 275, liquidH: 400, rim: 'M465 265 L735 265', stem: '' },
    tiki: { path: 'M465 250 Q600 195 735 250 L720 650 Q600 735 480 650 Z', liquidY: 260, liquidH: 400, rim: 'M465 250 Q600 195 735 250', stem: '' },
    shot: { path: 'M515 385 L685 385 L670 585 Q600 615 530 585 Z', liquidY: 395, liquidH: 185, rim: 'M515 385 L685 385', stem: '' },
    wine: { path: 'M425 215 Q600 330 775 215 L742 520 Q725 625 600 650 Q475 625 458 520 Z', liquidY: 230, liquidH: 390, rim: 'M425 215 Q600 330 775 215', stem: 'M600 650 L600 745 M470 765 Q600 735 730 765' },
  }[glassKind];
  const layers = /layer|pousse|float|separate|rainbow/.test(sourceText);
  const liquidMarkup = layers
    ? `<rect x="300" y="${spec.liquidY}" width="600" height="${Math.round(spec.liquidH * 0.36)}" fill="${liquidDark}" opacity="${opacity}"/><rect x="300" y="${Math.round(spec.liquidY + spec.liquidH * 0.34)}" width="600" height="${Math.round(spec.liquidH * 0.34)}" fill="${liquidAlt}" opacity="${opacity}"/><rect x="300" y="${Math.round(spec.liquidY + spec.liquidH * 0.67)}" width="600" height="${Math.round(spec.liquidH * 0.36)}" fill="${liquid}" opacity="${opacity}"/>`
    : `<rect x="300" y="${spec.liquidY}" width="600" height="${spec.liquidH}" fill="url(#drink)" opacity="${opacity}"/>`;
  const frozenIceMarkup = `<path d="M430 ${spec.liquidY + 25} Q600 ${spec.liquidY - 8} 770 ${spec.liquidY + 25} L750 ${spec.liquidY + 75} Q600 ${spec.liquidY + 105} 450 ${spec.liquidY + 75} Z" fill="#f3e9cf" opacity=".25"/><g fill="#f8efd6" stroke="#fff6df" stroke-width="2" opacity=".46">${Array.from({ length: 28 }, (_, index) => {
    const cx = 445 + number(140 + index) % 310;
    const cy = spec.liquidY + 28 + number(180 + index) % Math.max(80, spec.liquidH - 55);
    const rx = 6 + number(220 + index) % 13;
    const ry = 5 + number(260 + index) % 10;
    return `<path d="M${cx} ${cy - ry} L${cx + rx} ${cy - 2} L${cx + Math.round(rx / 2)} ${cy + ry} L${cx - rx} ${cy + 2} Z"/>`;
  }).join('')}</g>`;
  const iceMarkup = iceKind === 'up' ? ''
    : iceKind === 'big'
      ? `<rect x="535" y="${spec.liquidY + 90}" width="135" height="120" rx="18" fill="#f5e5c7" opacity=".46" transform="rotate(-8 602 ${spec.liquidY + 150})"/>`
      : iceKind === 'crushed'
        ? `<g fill="#f5e5c7" opacity=".46">${Array.from({ length: 13 }, (_, index) => `<circle cx="${470 + number(20 + index) % 240}" cy="${spec.liquidY + 55 + number(36 + index) % Math.max(60, spec.liquidH - 70)}" r="${8 + number(52 + index) % 13}"/>`).join('')}</g>`
        : iceKind === 'frozen'
          ? frozenIceMarkup
          : `<g fill="#f5e5c7" opacity=".38"><rect x="485" y="${spec.liquidY + 42}" width="72" height="62" rx="10" transform="rotate(-12 521 ${spec.liquidY + 73})"/><rect x="598" y="${spec.liquidY + 30}" width="76" height="64" rx="10" transform="rotate(15 636 ${spec.liquidY + 62})"/><rect x="550" y="${spec.liquidY + 115}" width="78" height="60" rx="10" transform="rotate(-5 589 ${spec.liquidY + 145})"/></g>`;
  const foamMarkup = foam ? `<path d="M430 ${spec.liquidY + 8} Q600 ${spec.liquidY - 28} 770 ${spec.liquidY + 8} Q600 ${spec.liquidY + 70} 430 ${spec.liquidY + 8} Z" fill="#f5e8ce" opacity=".72"/><path d="M485 ${spec.liquidY + 8} Q600 ${spec.liquidY - 10} 715 ${spec.liquidY + 8}" fill="none" stroke="#fff6df" stroke-width="8" opacity=".45"/>` : '';
  const bubbleMarkup = bubbles ? `<g fill="#f7e9cc" opacity=".55">${Array.from({ length: 14 }, (_, index) => `<circle cx="${470 + number(66 + index) % 250}" cy="${spec.liquidY + 30 + number(82 + index) % Math.max(60, spec.liquidH - 45)}" r="${2 + number(98 + index) % 5}"/>`).join('')}</g>` : '';
  const rimMarkup = rimKind === 'none' ? ''
    : `<path d="${spec.rim}" fill="none" stroke="${rimKind === 'tajin' ? '#c96b3b' : rimKind === 'sugar' ? '#f4e5bb' : '#e9d48b'}" stroke-width="${rimKind === 'tajin' ? 15 : 11}" stroke-linecap="round" stroke-dasharray="${rimKind === 'tajin' ? '5 9' : '2 8'}" opacity=".9"/>`;
  let garnishMarkup = '';
  if (garnishSignals.citrus) {
    garnishMarkup = `<path d="M730 292 Q815 205 875 290" fill="none" stroke="#e9b64e" stroke-width="17" stroke-linecap="round"/><path d="M742 292 Q810 225 865 290" fill="none" stroke="#6f8e4f" stroke-width="4"/><circle cx="820" cy="258" r="28" fill="none" stroke="#efcc69" stroke-width="7" opacity=".78"/>`;
  }
  if (garnishSignals.cherry) {
    garnishMarkup += `<circle cx="784" cy="258" r="25" fill="#a94348"/><circle cx="830" cy="270" r="22" fill="#c65353"/><path d="M784 242 Q780 175 830 168 M830 250 Q825 204 850 185" fill="none" stroke="#729152" stroke-width="6"/>`;
  }
  if (garnishSignals.mint) {
    garnishMarkup += `<path d="M740 300 Q795 200 860 245" fill="none" stroke="#709852" stroke-width="8"/><ellipse cx="775" cy="250" rx="18" ry="37" fill="#8eb56a" transform="rotate(30 775 250)"/><ellipse cx="820" cy="228" rx="17" ry="34" fill="#6d9d58" transform="rotate(55 820 228)"/><ellipse cx="840" cy="280" rx="15" ry="31" fill="#a7c875" transform="rotate(80 840 280)"/>`;
  }
  if (garnishSignals.olive) {
    garnishMarkup += `<path d="M760 295 Q820 225 858 190" fill="none" stroke="#6f8e4f" stroke-width="5"/><circle cx="807" cy="250" r="28" fill="#72834d"/><circle cx="850" cy="207" r="25" fill="#81985a"/><circle cx="807" cy="250" r="7" fill="#d9ad63"/><circle cx="850" cy="207" r="6" fill="#d9ad63"/>`;
  }
  if (garnishSignals.pineapple) {
    garnishMarkup += `<path d="M785 298 L760 210 M800 300 L800 195 M815 300 L845 210 M795 295 L775 225 M810 295 L835 225" stroke="#82a95d" stroke-width="9" stroke-linecap="round"/><path d="M770 300 Q800 276 830 300" fill="none" stroke="#e3b74e" stroke-width="22" stroke-linecap="round"/>`;
  }
  if (garnishSignals.flower) {
    garnishMarkup += `<g transform="translate(810 235)"><circle r="17" fill="#e9b64e"/><ellipse rx="21" ry="39" fill="#d88a89" transform="rotate(0) translate(0 -31)"/><ellipse rx="21" ry="39" fill="#d9a3c0" transform="rotate(72) translate(0 -31)"/><ellipse rx="21" ry="39" fill="#d88a89" transform="rotate(144) translate(0 -31)"/><ellipse rx="21" ry="39" fill="#d9a3c0" transform="rotate(216) translate(0 -31)"/><ellipse rx="21" ry="39" fill="#d88a89" transform="rotate(288) translate(0 -31)"/></g>`;
  }
  if (garnishSignals.spice) {
    garnishMarkup += `<path d="M770 296 L840 215 M790 303 L860 222" stroke="#a8733e" stroke-width="13" stroke-linecap="round"/><path d="M835 210 Q855 190 878 211 Q855 230 835 210" fill="#b98a4f" opacity=".8"/><circle cx="812" cy="250" r="7" fill="#e1bf74"/><circle cx="832" cy="264" r="6" fill="#e1bf74"/>`;
  }
  const bokeh = Array.from({ length: 12 }, (_, index) => {
    const x = 60 + number(120 + index * 2) * 4.4;
    const y = 70 + number(121 + index * 2) * 2.1;
    const radius = 8 + number(122 + index * 2) % 34;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${backgroundAccent}" opacity="${(0.06 + (number(123 + index * 2) % 14) / 100).toFixed(2)}"/>`;
  }).join('');
  const titleId = `title-${slug}`;
  const descId = `desc-${slug}`;
  const face = glassKind === 'tiki' ? '<g fill="#241c18" opacity=".86"><path d="M532 390 L565 374 L590 397 L564 421 L535 410 Z"/><path d="M610 397 L635 374 L668 390 L665 410 L636 421 Z"/><path d="M525 462 L550 446 L575 464 L600 447 L625 464 L650 446 L675 462 L650 484 L625 470 L600 490 L575 470 L550 484 Z"/></g><path d="M548 463 L575 476 L600 461 L625 476 L652 463" fill="none" stroke="#c58b57" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-labelledby="${escapeXml(titleId)} ${escapeXml(descId)}" data-slug="${escapeXml(slug)}" data-glass="${glassKind}" data-ice="${iceKind}" data-foam="${foam}" data-bubbles="${bubbles}" data-rim="${rimKind}">
  <title id="${escapeXml(titleId)}">${escapeXml(nameZh)}程序化示意图</title>
  <desc id="${escapeXml(descId)}">深色酒吧台面光影中的${escapeXml(nameZh)}，${escapeXml(glassKind)}杯型，${escapeXml(iceKind)}冰型与${escapeXml(garnishKind)}装饰。</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b0d0f"/><stop offset=".52" stop-color="#27201d"/><stop offset="1" stop-color="#0b0c10"/></linearGradient>
    <linearGradient id="drink" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${liquid}" stop-opacity=".96"/><stop offset=".55" stop-color="${liquidAlt}" stop-opacity=".84"/><stop offset="1" stop-color="${liquidDark}" stop-opacity=".96"/></linearGradient>
    <radialGradient id="light" cx="0.16" cy="0.12" r=".78"><stop stop-color="${backgroundAccent}" stop-opacity=".62"/><stop offset="1" stop-color="${backgroundAccent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="edgeLight" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#f8dfb8" stop-opacity=".05"/><stop offset=".5" stop-color="#f8dfb8" stop-opacity=".65"/><stop offset="1" stop-color="#f8dfb8" stop-opacity=".05"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="23"/></filter>
    <clipPath id="liquid-clip"><path d="${spec.path}"/></clipPath>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <ellipse cx="165" cy="110" rx="450" ry="360" fill="url(#light)" filter="url(#blur)"/>
  <g>${bokeh}</g>
  <path d="M0 745 Q250 670 510 744 T1200 715 V900 H0 Z" fill="#08090a" opacity=".9"/>
  <path d="M80 770 Q390 730 600 760 T1120 750" fill="none" stroke="url(#edgeLight)" stroke-width="3" opacity=".6"/>
  <ellipse cx="600" cy="735" rx="315" ry="31" fill="#000" opacity=".56"/>
  <g clip-path="url(#liquid-clip)">${liquidMarkup}${iceMarkup}${bubbleMarkup}${foamMarkup}</g>
  <path d="${spec.path}" fill="none" stroke="#f5d9ae" stroke-width="6" opacity=".9"/>
  ${spec.stem ? `<path d="${spec.stem}" fill="none" stroke="#f5d9ae" stroke-width="6" opacity=".9" stroke-linecap="round"/>` : ''}
  ${glassKind === 'mug' ? '<path d="M742 350 Q905 325 895 485 Q875 575 742 520" fill="none" stroke="#f5d9ae" stroke-width="6" opacity=".9"/>' : ''}
  ${glassKind === 'tiki' ? '<path d="M490 300 Q600 325 710 300 M500 610 Q600 635 700 610" fill="none" stroke="#f5d9ae" stroke-width="4" opacity=".45"/>' : ''}
  ${face}
  ${rimMarkup}
  ${garnishMarkup}
</svg>\n`.replace(/[ \t]+$/gm, '');
}

async function loadExisting() {
  const previous = (await exists(importManifestPath)) ? JSON.parse(await readFile(importManifestPath, 'utf8')) : null;
  const previousSlugs = new Set((previous?.entries ?? []).map((entry) => entry.slug));
  const files = [];
  async function walk(dir) {
    if (!(await exists(dir))) return;
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.name.endsWith('.md')) files.push(file);
    }
  }
  await walk(contentRoot);
  const entries = [];
  for (const file of files) {
    const data = parseFrontmatter(await readFile(file, 'utf8'));
    if (data) entries.push({ file, data });
  }
  const generatedEntries = entries.filter((entry) => entry.data.category === 'Bar Assistant Community');
  for (const entry of generatedEntries) previousSlugs.add(entry.data.slug);
  return { previous, previousSlugs, entries, ibaEntries: entries.filter((entry) => !previousSlugs.has(entry.data.slug)) };
}

async function readVendor() {
  const manifest = JSON.parse(await readFile(path.join(vendorRoot, 'manifest.json'), 'utf8'));
  if (manifest.commit !== snapshotCommit) throw new Error(`Vendor commit mismatch: expected ${snapshotCommit}, found ${manifest.commit}`);
  const directories = (await readdir(vendorCocktails, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const recipes = [];
  for (const directory of directories) {
    const file = path.join(vendorCocktails, directory.name, 'data.json');
    const recipe = JSON.parse(await readFile(file, 'utf8'));
    recipes.push({ recipe, id: directory.name, sha256: sha256(await readFile(file)) });
  }
  return { manifest, recipes };
}

function chooseByName(recipes) {
  const groups = new Map();
  for (const item of recipes) {
    const key = normalizeName(item.recipe.name);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const duplicates = [];
  const selected = [];
  for (const [name, group] of groups) {
    group.sort((a, b) => {
      const sourceScore = Number(Boolean(String(b.recipe.source ?? '').trim())) - Number(Boolean(String(a.recipe.source ?? '').trim()));
      return sourceScore || String(b.recipe.description ?? '').length - String(a.recipe.description ?? '').length || a.id.localeCompare(b.id);
    });
    if (group.length > 1) duplicates.push({ normalizedName: name, selected: group[0].id, candidates: group.map((item) => item.id) });
    selected.push(group[0]);
  }
  return { selected, duplicates };
}

function mapTags(recipe) {
  const tagMap = {
    citrusy: 'citrus', herbacious: 'herbal', smokey: 'smoky', refreshing: 'refreshing', bitter: 'bitter',
    fruity: 'fruity', floral: 'floral', savory: 'savory', spicy: 'spicy', sweet: 'sweet', tart: 'sour',
    tropical: 'tropical', tiki: 'tiki', coffee: 'coffee', hot: 'hot', aperitivo: 'aperitivo', spritz: 'sparkling',
    fizz: 'fizz', mule: 'mule', smash: 'smash', julep: 'smash', punch: 'punch', wine: 'sparkling', dry: 'dry',
  };
  return unique((recipe.tags ?? []).map((tag) => tagMap[String(tag).toLowerCase()] || slugify(tag)).filter(Boolean));
}

function buildEntry(item, nameZh, labels, usedSlugs, ibaNames) {
  const recipe = item.recipe;
  const nameEn = String(recipe.name).trim();
  const normalized = normalizeName(nameEn);
  if (ibaNames.has(normalized)) return null;
  let slug = slugify(nameEn, slugify(item.id));
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${slugify(nameEn, slugify(item.id))}-${suffix++}`;
  usedSlugs.add(slug);
  const ingredients = (recipe.ingredients ?? []).slice().sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((ingredient) => {
    const ingredientZh = ingredientNameZh(ingredient.name, ingredient._id, labels);
    const aliases = unique([String(ingredient.name).trim(), ingredientZh, ...(ingredient.substitutes ?? []).map((item) => String(item._id ?? '').trim())]);
    return { nameZh: ingredientZh, nameEn: String(ingredient.name).trim(), amount: amountText(ingredient), aliases };
  });
  const baseSpirit = inferBaseSpirit(recipe);
  const flavors = inferFlavors(recipe);
  const styles = inferStyles(recipe, flavors);
  const tags = unique(['community', 'bar-assistant', baseSpirit, ...mapTags(recipe), ...flavors, ...styles]);
  const method = String(recipe.method ?? '').trim();
  const glass = String(recipe.glass ?? '').trim() || '资料未指定';
  const garnish = garnishZh(recipe.garnish);
  const sourceUrl = /^https?:\/\/\S+$/i.test(String(recipe.source ?? '').trim()) ? String(recipe.source).trim() : null;
  const snapshotUrl = snapshotFileUrl(item.id);
  const methodZh = methodLabels[method] || '调制';
  const flavorText = flavors.slice(0, 3).map((value) => flavorLabels[value] || value).join('、') || '清晰';
  const data = {
    slug,
    nameZh,
    nameEn,
    category: 'Bar Assistant Community',
    baseSpirit,
    flavors,
    styles,
    ingredients,
    tags,
    summary: `${nameZh}以${ingredients.slice(0, 3).map((item) => item.nameZh).join('、') || '配方原料'}为核心，采用${methodZh}调制，呈现${flavorText}的风味结构。`,
    background: '',
    historySources: [],
    steps: stepsZh(recipe, ingredients, glass, garnish),
    glass,
    garnish,
    image: `/images/cocktails/${slug}.svg`,
    imageAlt: `${nameZh}的程序化酒杯示意图`,
    imageCredit: {
      kind: 'generated',
      creator: 'Cocktail Atlas procedural illustration',
      source: 'local generator',
      license: 'Project generated asset',
      modified: true,
      checkedAt,
    },
    source: {
      label: `Bar Assistant v5 snapshot · ${nameEn}`,
      url: snapshotUrl,
      checkedAt,
    },
    variants: [],
  };
  data.background = backgroundText({ nameZh, ingredients, baseSpirit, method, glass, garnish, flavors });
  data.historySources = unique([sourceUrl, snapshotUrl]).map((url) => ({
    label: url === sourceUrl ? `原始来源 · ${nameEn}` : `Bar Assistant v5 snapshot · ${nameEn}`,
    url,
    checkedAt,
  }));
  return { data, source: item, sourceUrl, nameZhMapped: nameZh !== nameEn, file: `src/content/cocktails/community/${slug}.md` };
}

async function removePrevious(previous) {
  for (const entry of previous?.entries ?? []) {
    for (const file of [entry.file, entry.image ? `public${entry.image}` : null]) {
      if (!file) continue;
      const absolute = path.join(repoRoot, file);
      if (absolute.startsWith(contentRoot) || absolute.startsWith(imageRoot)) {
        await unlink(absolute).catch(() => {});
      }
    }
  }
}

function buildAliasMap(aliases) {
  const map = new Map();
  for (const item of aliases) {
    for (const alias of item.aliases) {
      const key = normalizeName(alias);
      if (!key) continue;
      const previous = map.get(key);
      if (previous && previous.targetSlug !== item.targetSlug) {
        throw new Error(`Alias collision for ${alias}: ${previous.targetSlug} and ${item.targetSlug}`);
      }
      map.set(key, { targetSlug: item.targetSlug, targetNameEn: item.targetNameEn, alias });
    }
  }
  return map;
}

async function applyAliasTags(existingEntries, aliases) {
  const bySlug = new Map(existingEntries.map((entry) => [entry.data.slug, entry]));
  const applied = [];
  for (const item of aliases) {
    const target = bySlug.get(item.targetSlug);
    if (!target) throw new Error(`Alias target slug not found in IBA content: ${item.targetSlug}`);
    const tags = unique([...(Array.isArray(target.data.tags) ? target.data.tags : []), ...item.aliases]);
    const fileText = await readFile(target.file, 'utf8');
    const nextText = fileText.replace(/^tags:\s*.*$/m, `tags: ${JSON.stringify(tags)}`);
    if (nextText === fileText && !/^tags:/m.test(fileText)) {
      throw new Error(`IBA file has no tags field: ${target.file}`);
    }
    if (nextText !== fileText) await writeFile(target.file, nextText, 'utf8');
    applied.push({ targetSlug: item.targetSlug, targetNameEn: item.targetNameEn, aliases: item.aliases });
  }
  return applied;
}

async function main() {
  const [{ manifest, recipes }, labels, namesA, namesMZ, aliases, existing] = await Promise.all([
    readVendor(),
    readIngredientLabels(),
    readNameMap(path.join(dataRoot, 'community-names-a-l.json')),
    readNameMap(path.join(dataRoot, 'community-names-m-z.json')),
    readAliases(),
    loadExisting(),
  ]);
  const nameMap = new Map([...namesA, ...namesMZ]);
  const ibaNames = new Set(existing.ibaEntries.map((entry) => normalizeName(entry.data.nameEn)));
  const aliasMap = buildAliasMap(aliases);
  const usedSlugs = new Set(existing.ibaEntries.map((entry) => entry.data.slug));
  const { selected, duplicates } = chooseByName(recipes);
  const skippedIbaNames = selected.filter((item) => ibaNames.has(normalizeName(item.recipe.name))).length;
  const skippedAliasNames = selected
    .filter((item) => !ibaNames.has(normalizeName(item.recipe.name)) && aliasMap.has(normalizeName(item.recipe.name)))
    .map((item) => ({
      nameEn: item.recipe.name,
      alias: aliasMap.get(normalizeName(item.recipe.name)).alias,
      targetSlug: aliasMap.get(normalizeName(item.recipe.name)).targetSlug,
      sourceId: item.id,
    }));
  const community = [];
  for (const item of selected) {
    const normalized = normalizeName(item.recipe.name);
    if (ibaNames.has(normalized) || aliasMap.has(normalized)) continue;
    const nameZh = nameMap.get(normalized) || item.recipe.name;
    const entry = buildEntry(item, nameZh, labels, usedSlugs, ibaNames);
    if (entry) community.push(entry);
  }
  community.sort((a, b) => a.data.nameEn.localeCompare(b.data.nameEn));
  const missingNameZh = community.filter((entry) => !entry.nameZhMapped).map((entry) => entry.data.nameEn);
  const importManifest = {
    format: 1,
    kind: 'community-import',
    generatedAt: checkedAt,
    vendor: {
      provider: manifest.provider,
      sourceUrl: manifest.sourceUrl,
      snapshotUrl: manifest.snapshotUrl || snapshotBaseUrl,
      commit: manifest.commit,
      recipeCount: manifest.recipeCount,
      manifestSha256: sha256(JSON.stringify(manifest)),
    },
    sourceRows: recipes.length,
    sourceUniqueNames: selected.length,
    duplicateGroups: duplicates,
    aliasRules: aliases,
    aliasesApplied: aliases.map((item) => ({ targetSlug: item.targetSlug, targetNameEn: item.targetNameEn, aliases: item.aliases })),
    skippedAliasNames,
    ibaCount: existing.ibaEntries.length,
    communityCount: community.length,
    combinedCount: existing.ibaEntries.length + community.length,
    missingNameZh,
    entries: community.map((entry) => ({
      slug: entry.data.slug,
      nameEn: entry.data.nameEn,
      nameZh: entry.data.nameZh,
      nameZhMapped: entry.nameZhMapped,
      sourceId: entry.source.id,
      sourceSha256: entry.source.sha256,
      sourceUrl: entry.sourceUrl,
      file: entry.file,
      image: entry.data.image,
    })),
  };
  console.log(JSON.stringify({
    vendorRoot,
    sourceRows: recipes.length,
    sourceUniqueNames: selected.length,
    duplicateGroups: duplicates.length,
    skippedIbaNames,
    skippedAliasNames: skippedAliasNames.length,
    ibaCount: existing.ibaEntries.length,
    communityCount: community.length,
    combinedCount: importManifest.combinedCount,
    missingNameZh: missingNameZh.length,
    dryRun,
  }, null, 2));
  if (dryRun) return;
  await removePrevious(existing.previous);
  await mkdir(communityRoot, { recursive: true });
  await mkdir(imageRoot, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await applyAliasTags(existing.ibaEntries, aliases);
  for (const entry of community) {
    const file = path.join(repoRoot, entry.file);
    await writeFile(file, `---\n${stringify(entry.data, { lineWidth: 0 })}---\n`, 'utf8');
    await writeFile(path.join(repoRoot, 'public', entry.data.image.replace(/^\//, '')), renderSvg({
      slug: entry.data.slug,
      nameZh: entry.data.nameZh,
      recipe: entry.source.recipe,
    }), 'utf8');
  }
  await writeFile(importManifestPath, `${JSON.stringify(importManifest, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
