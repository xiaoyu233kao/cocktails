# Cocktail Atlas

中文家庭调酒配方图鉴，使用 Astro 构建为静态 GitHub Pages 网站。网站以 IBA 当前目录为标准配方的首要来源，约收录 30 款常见鸡尾酒，并为搜索、组合筛选和图片灯箱提供渐进增强。

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

站点首页位于项目根路径，配方目录位于 `/recipes/`，详情页位于 `/recipes/<slug>/`；部署后这些路径都会自动带上 Pages base。

## 新增配方

1. 复制 `CONTENT-SCHEMA.md` 中的 frontmatter，在 `src/content/cocktails/<slug>.md` 创建文件。
2. 将图片保存为 `public/images/cocktails/<slug>.webp`（建议 4:3、宽度至少 1200px），并在 `imageCredit` 记录来源、许可、修改权限和核对日期。
3. 在 `source` 保留 IBA 配方页面；故事和变体只有逐条可靠来源时才添加。步骤用原创中文表达，保留已核实的配方事实。
4. 运行 `npm run test:content`、`npm run check` 和 `npm run build`。内容校验会确认至少保留 30 条配方、slug 唯一，并检查每个 frontmatter 图片路径对应非空本地文件。

故事字段可以省略。原料的 `aliases` 会进入搜索索引；`tags`、`flavors` 和 `styles` 是显式维护的筛选值，不要依赖模糊文本推断。

## GitHub Pages

`.github/workflows/deploy.yml` 会在推送到 `main` 时构建并上传 `dist/`，Pages 来源应在仓库设置中选择 **GitHub Actions**。部署前核实根站自定义域名和项目站真实 URL，再将 `BASE_PATH` 与 `SITE_URL` 调整为核实后的值。
