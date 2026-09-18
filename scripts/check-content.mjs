// @ts-nocheck
import { readdir, readFile, stat } from 'node:fs/promises';

const root = new URL('../src/content/cocktails/', import.meta.url);
const required = ['slug', 'nameZh', 'nameEn', 'category', 'baseSpirit', 'flavors', 'styles', 'ingredients', 'tags', 'summary', 'steps', 'glass', 'garnish', 'image', 'imageAlt', 'imageCredit', 'source'];
const files = [];
const minimumCount = 30;
const slugs = new Set();
const errors = [];

async function walk(url) {
  for (const item of await readdir(url, { withFileTypes: true })) {
    const child = new URL(`${item.name}${item.isDirectory() ? '/' : ''}`, url);
    if (item.isDirectory()) await walk(child);
    else if (item.name.endsWith('.md')) files.push(child);
  }
}

try {
  await stat(root);
  await walk(root);
} catch {
  console.error('Missing src/content/cocktails; refusing to publish without the recipe collection.');
  process.exit(1);
}

if (files.length < minimumCount) {
  errors.push(`expected at least ${minimumCount} recipe files, found ${files.length}`);
}

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    errors.push(`${file.pathname}: missing frontmatter`);
    continue;
  }
  const frontmatter = match[1];
  for (const field of required) {
    if (!new RegExp(`^${field}:`, 'm').test(frontmatter)) errors.push(`${file.pathname}: missing ${field}`);
  }
  const slug = frontmatter.match(/^slug:\s*([^\n]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const expected = file.pathname.split('/').at(-1).replace(/\.md$/, '');
  if (slug && slug !== expected) errors.push(`${file.pathname}: filename and slug differ`);
  if (slug && slugs.has(slug)) errors.push(`${file.pathname}: duplicate slug ${slug}`);
  if (slug) slugs.add(slug);
  const image = frontmatter.match(/^image:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (!image?.startsWith('/images/cocktails/')) {
    errors.push(`${file.pathname}: image must point to /images/cocktails/`);
  } else {
    try {
      const imageFile = new URL(`../public${image}`, import.meta.url);
      const imageStats = await stat(imageFile);
      if (!imageStats.isFile() || imageStats.size < 1) errors.push(`${file.pathname}: image is empty ${image}`);
    } catch {
      errors.push(`${file.pathname}: missing local image ${image}`);
    }
  }
  if (/^\s*kind:\s*['"]?photo['"]?\s*$/m.test(frontmatter)) {
    if (!/^\s*sourceUrl:\s*\S+/m.test(frontmatter)) errors.push(`${file.pathname}: photo credit needs sourceUrl`);
    if (!/^\s*licenseUrl:\s*\S+/m.test(frontmatter)) errors.push(`${file.pathname}: photo credit needs licenseUrl`);
  }
  if (frontmatter.includes('story:') && !/story:[\s\S]*?source:/m.test(frontmatter)) errors.push(`${file.pathname}: story needs a source`);
  if (frontmatter.includes('variants:') && !/variants:[\s\S]*?source:/m.test(frontmatter)) errors.push(`${file.pathname}: variants need a source`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Content smoke check passed for ${files.length} recipe file(s).`);
