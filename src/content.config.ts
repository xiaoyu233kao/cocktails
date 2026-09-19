import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const sourceSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  checkedAt: z.coerce.date(),
});

const ingredientSchema = z.object({
  nameZh: z.string().min(1),
  nameEn: z.string().min(1),
  // YAML treats bare numeric amounts as numbers; coerce while preserving the
  // source wording for display (units remain in the original string when
  // supplied).
  amount: z.coerce.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
});

const imageCreditSchema = z.object({
  kind: z.enum(['photo', 'generated']),
  creator: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  license: z.string().min(1),
  licenseUrl: z.string().url().optional(),
  modified: z.boolean(),
  attribution: z.string().nullable().default(null),
  checkedAt: z.coerce.date(),
}).superRefine((value, context) => {
  if (value.kind === 'photo' && !value.sourceUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceUrl'], message: 'photo credits require the original asset URL' });
  }
  if (value.kind === 'photo' && !value.licenseUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['licenseUrl'], message: 'photo credits require a license URL' });
  }
});

const storySchema = z.object({
  text: z.string().min(1),
  source: sourceSchema,
});

const variantSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  source: sourceSchema,
});

const cocktails = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cocktails' }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    nameZh: z.string().min(1),
    nameEn: z.string().min(1),
    category: z.string().min(1),
    baseSpirit: z.enum(['gin', 'vodka', 'rum', 'tequila', 'whiskey', 'brandy', 'pisco', 'cachaca', 'wine', 'aperitif', 'multi', 'none']),
    flavors: z.array(z.string().min(1)).min(1),
    styles: z.array(z.string().min(1)).min(1),
    ingredients: z.array(ingredientSchema).min(1),
    tags: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1),
    background: z.string().min(1).optional(),
    historySources: z.array(sourceSchema).min(1).optional(),
    steps: z.array(z.string().min(1)).min(1),
    glass: z.string().min(1),
    garnish: z.string().min(1),
    image: z.string().regex(/^\/images\/cocktails\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|avif|png|jpe?g)$/),
    imageAlt: z.string().min(1),
    imageCredit: imageCreditSchema,
    source: sourceSchema,
    story: storySchema.optional(),
    variants: z.array(variantSchema).default([]),
  }),
});

export const collections = { cocktails };
