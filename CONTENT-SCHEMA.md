# Cocktail content contract

This repository treats each recipe as one Markdown file under
`src/content/cocktails/`. Content agents can add or edit entries independently
as long as they keep this frontmatter shape. The collection schema in
`src/content.config.ts` is the build-time source of truth.

## File name and slug

Use a lowercase ASCII slug for both the filename and the `slug` field:

```text
src/content/cocktails/negroni.md
slug: negroni
```

Do not put spaces, punctuation, locale suffixes, or version numbers in the
filename. The slug is the stable detail URL segment.

## Frontmatter

```yaml
slug: negroni
nameZh: 尼格罗尼
nameEn: Negroni
category: The Unforgettables
baseSpirit: gin
flavors:
  - bitter
  - citrus
styles:
  - stirred
  - aperitivo
ingredients:
  - nameZh: 金酒
    nameEn: Gin
    amount: 30 ml
    aliases: [gin, London dry gin]
  - nameZh: 金巴利
    nameEn: Campari
    amount: 30 ml
    aliases: [campari, bitter aperitif]
tags:
  - gin
  - bitter
  - aperitivo
summary: 三等分结构带来草本、苦甜与柑橘香气。
steps:
  - 将所有原料加入装有冰块的搅拌杯。
  - 搅拌至充分冰镇后滤入杯中。
glass: Old fashioned glass
garnish: 橙皮
image: /images/cocktails/negroni.webp
imageAlt: 装饰着橙皮的尼格罗尼
imageCredit:
  kind: generated
  creator: OpenAI image generation
  source: OpenAI built-in image generation
  license: AI 生成示意图
  modified: true
  checkedAt: 2026-09-18
source:
  label: IBA Negroni
  url: https://iba-world.com/iba-cocktail/negroni/
  checkedAt: 2026-09-18
variants:
  - name: Boulevardier
    description: 以威士忌替代金酒，风味更厚重。
    source:
      label: IBA Boulevardier
      url: https://iba-world.com/iba-cocktail/boulevardier/
      checkedAt: 2026-09-18
```

Required fields are `slug`, `nameZh`, `nameEn`, `category`, `baseSpirit`,
`flavors`, `styles`, `ingredients`, `tags`, `summary`, `steps`, `glass`,
`garnish`, `image`, `imageAlt`, `imageCredit`, and `source`. `story` is optional: omit it
when its history cannot be sourced. `variants` is optional and every listed
variant must carry its own source.

Use one canonical `baseSpirit` value so the filter stays stable: `gin`,
`vodka`, `rum`, `tequila`, `whiskey`, `brandy`, `pisco`, `cachaca`, `wine`,
`aperitif`, `multi`, or `none`. Keep precise spirit descriptions in the
ingredient names and amounts (for example, “white Cuban rum” remains an
ingredient detail while `baseSpirit` is `rum`).

Ingredient `aliases` are indexed for search. Keep aliases in both English and
Chinese when a common spelling or translation exists. `amount` preserves the
source wording and units; do not silently convert it. `tags` are the explicit
intersection/filter vocabulary and should include the base spirit, flavor, and
style terms used by the entry.

Stories use this shape when a reliable source exists:

```yaml
story:
  text: 这段简短的中文背景说明。
  source:
    label: Reliable source title
    url: https://example.com/source
    checkedAt: 2026-09-18
```

## Asset naming

Store one primary local image per recipe at
`public/images/cocktails/<slug>.webp`. Use lowercase ASCII slugs and the same
basename as the Markdown file. Prefer a 4:3 image with a minimum width of
1200px; the card uses `object-fit: cover`, while the lightbox shows the full
asset. A `.avif` sibling is welcome for optimization, but the `.webp` path
must remain available as the fallback referenced by frontmatter.

当前首批 30 款图片全部是统一风格的 AI 生成示意图，默认使用
`OpenAI image generation` 的 built-in source。新增配方也应生成同系列图片，并在
`imageCredit` 使用上面的 `generated` 记录。若未来采用授权照片，才将 `kind` 改为
`photo`，并记录作者、来源、`sourceUrl`、许可、`licenseUrl`、修改权限、必要署名和核对日期。
不要热链图片。使用 `imageAlt` 描述可见饮品，而不是文件名。

Content agents should reserve disjoint slugs and asset basenames. If a recipe
is missing its final image, keep its frontmatter path stable and add a
placeholder image or let the UI fallback render; do not rename the slug later.
