# Cocktail Atlas

中文家庭调酒配方图鉴，使用 Astro 构建为静态 GitHub Pages 网站。网站以 [IBA 当前目录](https://iba-world.com/cocktails/all-cocktails/) 为标准配方的首要来源，收录 102 款 IBA 鸡尾酒，并加入固定版本 Bar Assistant public data 快照中的 38 款精选补充配方和 1 款手工补录的反舌鸟。目录数量由内容集合动态计算；配方页支持跨分页搜索、组合筛选和图片灯箱。IBA 图片使用本地 WebP，社区条目预留本地生成的 4:3 WebP 示意图路径。

默认发布假设是公开仓库 `xiaoyu233kao/cocktails`，项目地址为
`https://xiaoyu233kao.github.io/cocktails/`。发布前请核实账号根站的 Pages
自定义域名设置；如果实际项目地址不同，用 `BASE_PATH` 和 `SITE_URL` 覆盖默认值。

## 本地开发

需要 Node.js 20 或更高版本。

```sh
npm install
npm run dev
```

默认 Pages 子路径是 `/cocktails/`。若仓库名或正式地址不同，可通过环境变量覆盖：

```sh
BASE_PATH=/new-repo SITE_URL=https://example.github.io npm run build
```

站点首页位于项目根路径，配方目录位于 `/recipes/`（每页 60 条），详情页位于 `/recipes/<slug>/`；部署后这些路径都会自动带上 Pages base。搜索索引写入 `public/data/recipes-index.json`，筛选结果可以跨分页返回。

## 新增配方

1. 复制 `CONTENT-SCHEMA.md` 中的 frontmatter，在 `src/content/cocktails/<slug>.md` 创建文件。
2. 默认使用生成式示意图，将图片保存为 `public/images/cocktails/<slug>.webp`（建议 4:3、宽度至少 1200px），并在 `imageCredit` 标记 `kind: generated`、`creator: OpenAI image generation` 和 `source: OpenAI built-in image generation`；若未来改用授权照片，必须记录作者、来源、许可、修改权限、必要署名及对应 URL。
3. 在 `source` 保留 IBA 配方页面；故事和变体只有逐条可靠来源时才添加。步骤用原创中文表达，保留已核实的配方事实。
4. 为每条配方补充至少约 160 个中文字符的 `background`，并在 `historySources` 列出可核验的背景来源。
5. 运行 `npm run test:content`、`npm run check` 和 `npm run build`。内容校验会确认 IBA manifest 的 102 条配方和精选清单的 39 条补充配方分别唯一对应，并检查背景、来源、taxonomy 和 generated credit；社区 WebP 在补齐前会明确报告 warning。

故事字段可以省略。原料的 `aliases` 会进入搜索索引；`tags`、`flavors` 和 `styles` 是显式维护的筛选值，不要依赖模糊文本推断。

## Bar Assistant 数据归属

社区补充配方来自 Bar Assistant data 仓库的固定提交 `5a504d474614494119882eb91a8ffdc5491a483f`，快照文件保存在 `vendor/bar-assistant-data-v5/`，但发布内容由 `src/data/community-curated-allowlist.json` 明确限定为 38 条；另有 `tequila-mockingbird` 手工补录。导入清单和逐文件 SHA-256 位于 `src/data/community-import-manifest.json`。该数据集按 MIT 许可发布，许可文本保存在快照目录的 `LICENSE`；本项目只复制精选配方 JSON，不复制其源图片。社区条目的 `source` 与 `historySources` 保留固定快照地址以及原始配方来源（存在有效 URL 时）。

重新导入时运行 `node scripts/import-bar-assistant.mjs`，如需预览可使用 `--dry-run`；脚本不依赖 CI 网络，默认读取仓库内快照。

## GitHub Pages

`.github/workflows/deploy.yml` 会在推送到 `main` 时构建并上传 `dist/`，Pages 来源应在仓库设置中选择 **GitHub Actions**。部署前核实根站自定义域名和项目站真实 URL，再将 `BASE_PATH` 与 `SITE_URL` 调整为核实后的值。
