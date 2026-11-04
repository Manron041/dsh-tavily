# dsh-tavily

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 Tavily 网页能力：搜索、正文提取、站点爬取和 URL 发现，以原生 DSH 工具的形式挂载，并附带一个 `tavily` skill。

这是 [opencode-tavily](https://github.com/tavily-ai/opencode-tavily) 的 DSH 移植版，但做了关键改造：工具在 **Host 侧**调用官方 [`tvly` CLI](https://github.com/tavily-ai/tavily-cli)，因此不需要 agent 进入被沙箱限制的 bash 会话去写 `~/.tavily`。

## 提供什么

| 工具 | 用途 | 需要 API key |
|---|---|---|
| `tavily_search` | 返回带标题、URL 和摘要的排序结果 | 否，keyless 模式可用 |
| `tavily_extract` | 从最多 20 个已知 URL 提取干净的 markdown | 否，keyless 模式可用 |
| `tavily_crawl` | 抓取整个站点区块的全部正文 | 是 |
| `tavily_map` | 列出一个站点发布的所有 URL | 是 |

此外还注册一个 `tavily` skill，教模型什么时候该用哪个工具、如何标注来源。

## 安装

1. 先装 CLI：

```bash
pip install --user tavily-cli
# 或者
uv tool install tavily-cli
```

2. 把插件装进 profile：

```bash
# 从 GitHub 装（不需要发布到 npm）
dsh plugin --profile web add github:Manron041/dsh-tavily

# 从本地目录装
dsh plugin --profile web add file:/绝对路径/dsh-tavily

# 从打包好的 tgz 装
dsh plugin --profile web add ./dsh-tavily-0.1.0.tgz
```

3. 重启 profile（`dsh web` 或桌面端），让 bundle 层生效。

> bundle 必须被**复制**进 profile 的 `node_modules`。用 npm / GitHub / tarball / `file:`
> 都没问题，但不能用符号链接安装——符号链接会让插件无法解析 `@deepseek-ai/dsh-tools`。

## 认证

`tavily_search` 和 `tavily_extract` 不需要任何 key，Tavily 的 keyless 模式有匿名速率上限。

要用 `tavily_crawl`、`tavily_map`，或想解除速率上限：

```bash
tvly login                    # 浏览器登录
tvly login --api-key tvly-xxxx
# 或者
export TAVILY_API_KEY=tvly-xxxx
```

## 配置

所有配置项都是 volatile 字段。可以在网页界面里改——**侧栏 → 插件 → `dsh-tavily` 那一行 → 打开行详情页**——也可以直接改 profile patch。文本和数字框离开焦点或按回车才保存，开关和下拉立即保存。数值改动下一次调用就生效，只有 `enable*` 开关需要重启。

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: tavily
  name: dsh-tavily
  config:
    cliPath: /root/.local/bin/tvly
    apiKeyEnv: TAVILY_API_KEY
    defaultMaxResults: 10
    defaultSearchDepth: basic
    timeoutMs: 180000
    enableSearch: true
    enableExtract: true
    enableCrawl: false
    enableMap: false
```

| 字段 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `cliPath` | string | 自动探测 | `tvly` 可执行文件的绝对路径。探测顺序：本字段 → `TAVILY_CLI_PATH` → `~/.local/bin/tvly` → `/usr/local/bin/tvly` → `/usr/bin/tvly` → `PATH`。 |
| `apiKey` | string (secret) | 未设置 | 直接写 key。推荐用 `apiKeyEnv`，避免密钥落到配置文件里。 |
| `apiKeyEnv` | credential-ref | `TAVILY_API_KEY` | 从哪个环境变量读 key；同一个名字会传给 CLI。 |
| `baseURL` | string | 官方端点 | 搜索服务地址，以 `TAVILY_API_BASE_URL` 传给 CLI。可以指向任意 Tavily 兼容服务：镜像、网关或自建代理。 |
| `defaultMaxResults` | number 1-20 | `5` | 模型没传 `max_results` 时返回几条结果。 |
| `defaultSearchDepth` | enum | `basic` | `ultra-fast` / `fast` / `basic` / `advanced`。模型没传 `depth` 时使用。 |
| `timeoutMs` | number | `180000` | 单次 CLI 调用的实际耗时上限（毫秒）。 |
| `enableSearch` | boolean | `true` | 是否注册 `tavily_search`。挂载时读取。 |
| `enableExtract` | boolean | `true` | 是否注册 `tavily_extract`。挂载时读取。 |
| `enableCrawl` | boolean | `true` | 是否注册 `tavily_crawl`（需要 key）。挂载时读取。 |
| `enableMap` | boolean | `true` | 是否注册 `tavily_map`（需要 key）。挂载时读取。 |

`enable*` 系列决定挂载时注册哪些工具，改它需要重启；其余字段每次调用现读。

环境变量仍然可以作为兜底：`cliPath`（`TAVILY_CLI_PATH`）和 key（`TAVILY_API_KEY`），后者也是 CLI 自己读取的变量。

## 为什么做成工具，而不是只给一个 skill

上游 OpenCode 插件是纯 skill 方案：让 agent 在终端里执行 `tvly`。在 DSH 里这条路会断——bash 沙箱不允许写工作区之外的文件，而 CLI 的状态就存在 `~/.tavily`。

DSH 的插件代码跑在 Host 上。把 CLI 包成工具后：不再依赖 bash 沙箱；agent 不需要自己拼 shell 命令字符串；失败信息变得可操作（`tvly` 没装、缺 key、触发速率上限），而不是抛一段原始 traceback。

## 开发

```bash
# 把本地目录装进 profile 调试
dsh plugin --profile web add file:/绝对路径/dsh-tavily
```

目录结构：

```
package.json         bundle 清单（dsh.bundle.patch）
cordis.patch.yml     插入 `tavily` 插件行
lib/index.js         工具与 skill 注册
skills/tavily/SKILL.md
```

## 许可证

MIT
