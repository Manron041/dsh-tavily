# dsh-tavily

English | [中文](README.zh.md)

Tavily web access for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — search, page extraction, site crawling and URL discovery, exposed as native DSH tools plus a `tavily` skill.

This is the DSH port of [opencode-tavily](https://github.com/tavily-ai/opencode-tavily), reworked so the agent never has to shell out into a sandboxed bash session: the tools run the official [`tvly` CLI](https://github.com/tavily-ai/tavily-cli) on the Host, where `~/.tavily` is writable.

## What you get

| Tool | Purpose | Key required |
|---|---|---|
| `tavily_search` | Ranked web results with titles, URLs and snippets | no — keyless works |
| `tavily_extract` | Clean markdown from up to 20 known URLs | no — keyless works |
| `tavily_crawl` | Full content from a site section | yes |
| `tavily_map` | URL inventory of a site | yes |

Plus a `tavily` skill that teaches the model which tool to reach for and how to cite results.

## Install

1. Install the CLI:

```bash
pip install --user tavily-cli
# or
uv tool install tavily-cli
```

2. Install the plugin into a profile:

```bash
# from GitHub (no npm publish required)
dsh plugin --profile web add github:Manron041/dsh-tavily

# from a local checkout
dsh plugin --profile web add file:/absolute/path/to/dsh-tavily

# from a packed tarball
dsh plugin --profile web add ./dsh-tavily-0.1.0.tgz
```

3. Restart the profile (`dsh web` or the desktop app) so the bundle layer is applied.

> The bundle copies into the profile's `node_modules`, so it must be installed
> as a package (npm / GitHub / tarball / `file:`) rather than symlinked —
> a symlink breaks resolution of `@deepseek-ai/dsh-tools`.

## Authentication

Nothing is required for `tavily_search` and `tavily_extract` — Tavily's keyless mode has an anonymous rate cap.

For `tavily_crawl` and `tavily_map`, or to lift the cap:

```bash
tvly login                  # browser flow
tvly login --api-key tvly-xxxx
# or
export TAVILY_API_KEY=tvly-xxxx
```

## Configuration

Every setting is a volatile plugin field. Edit them in the web UI — **sidebar →
Plugins → the `dsh-tavily` row → open its detail page** — or edit the profile
patch directly. Text and number fields save when you leave them (or press
Enter); toggles and selects save immediately. Values apply to the next call;
only the `enable*` switches need a restart.

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

| Field | Type | Default | Effect |
|---|---|---|---|
| `cliPath` | string | auto-detect | Absolute path to `tvly`. Probe order: this, `TAVILY_CLI_PATH`, `~/.local/bin/tvly`, `/usr/local/bin/tvly`, `/usr/bin/tvly`, then `PATH`. |
| `apiKey` | string (secret) | unset | Literal API key. Prefer `apiKeyEnv` so no secret lands in config files. |
| `apiKeyEnv` | credential-ref | `TAVILY_API_KEY` | Variable the key is read from; it is handed to the CLI under this name. |
| `baseURL` | string | official endpoint | Search endpoint base, passed to the CLI as `TAVILY_API_BASE_URL`. Point it at any Tavily-compatible service: a mirror, a gateway, or a self-hosted proxy. |
| `defaultMaxResults` | number 1-20 | `5` | Result count when the model omits `max_results`. |
| `defaultSearchDepth` | enum | `basic` | `ultra-fast` \| `fast` \| `basic` \| `advanced`. Used when the model omits `depth`. |
| `timeoutMs` | number | `180000` | Wall-clock ceiling for one CLI call. |
| `enableSearch` | boolean | `true` | Register `tavily_search`. Read at mount. |
| `enableExtract` | boolean | `true` | Register `tavily_extract`. Read at mount. |
| `enableCrawl` | boolean | `true` | Register `tavily_crawl` (needs a key). Read at mount. |
| `enableMap` | boolean | `true` | Register `tavily_map` (needs a key). Read at mount. |

The `enable*` flags decide registration at mount, so flipping one needs a
restart; every other field is read per call.

Environment variables still work as a fallback for `cliPath` (`TAVILY_CLI_PATH`)
and the key (`TAVILY_API_KEY`), which is also what the CLI reads itself.

## Why tools instead of just a skill

The upstream OpenCode plugin ships a shell skill: the agent runs `tvly` through its terminal. That breaks under a sandboxed bash that cannot write outside the workspace, because the CLI keeps its state in `~/.tavily`.

DSH runs plugin code on the Host. Registering the CLI as tools removes the sandbox dependency entirely, keeps the agent from composing shell command strings, and makes failures actionable (`tvly` not installed, missing key, rate cap) instead of surfacing a raw traceback.

## Development

```bash
# install a local checkout into a profile
dsh plugin --profile web add file:/absolute/path/to/dsh-tavily
```

Layout:

```
package.json         bundle manifest (dsh.bundle.patch)
cordis.patch.yml     inserts the `tavily` plugin row
lib/index.js         tool + skill registration
skills/tavily/SKILL.md
```

## License

MIT
