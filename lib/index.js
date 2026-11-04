/**
 * dsh-tavily — Tavily web search, extract, crawl and map for DeepSeek Harness.
 *
 * Wraps the official `tvly` CLI (the `tavily-cli` package) and runs it on the
 * Host, so the agent's bash sandbox never needs write access to `~/.tavily`.
 * Registers four model-facing tools plus the `tavily` skill.
 *
 * Every setting is a volatile Config field, following the same shape as
 * `@deepseek-ai/dsh-web-search-deepseek`: a profile can pin them in
 * `cordis.patch.yml`, and each call reads the current value instead of the
 * one captured at boot.
 *
 * @module dsh-tavily
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable Loader identity. */
export const name = 'tavily'

/** Host services this plugin consumes. */
export const inject = ['tools', 'skills']

/** Default variable the CLI itself reads when no literal key is configured. */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Plugin configuration. All fields are volatile, so a profile edit applies to the next call. */
export const Config = z.object({
  /** Absolute path to the `tvly` executable. Omitted = probe known locations, then PATH. */
  cliPath: z.string().volatile(),
  /** Literal Tavily API key. Prefer `apiKeyEnv` so no secret enters configuration files. */
  apiKey: z.string().role('secret').volatile(),
  /** Variable name the key is read from, and the name the CLI receives it under. */
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  /**
   * Search endpoint base. Any Tavily-compatible service works — a mirror, a
   * gateway, or a self-hosted proxy. Passed to the CLI as TAVILY_API_BASE_URL.
   */
  baseURL: z.string().volatile(),
  /** Result count used when the model does not pass `max_results`. */
  defaultMaxResults: z.number().step(1).min(1).max(20).default(5).volatile(),
  /** Search depth used when the model does not pass `depth`. */
  defaultSearchDepth: z.union(['ultra-fast', 'fast', 'basic', 'advanced']).default('basic').volatile(),
  /** Wall-clock ceiling for one CLI invocation, in milliseconds. */
  timeoutMs: z.number().step(1).min(1).default(180_000).volatile(),
  /** Register `tavily_search`. Read at mount time; changing it needs a restart. */
  enableSearch: z.boolean().default(true).volatile(),
  /** Register `tavily_extract`. Read at mount time; changing it needs a restart. */
  enableExtract: z.boolean().default(true).volatile(),
  /** Register `tavily_crawl` (requires an API key). Read at mount time. */
  enableCrawl: z.boolean().default(true).volatile(),
  /** Register `tavily_map` (requires an API key). Read at mount time. */
  enableMap: z.boolean().default(true).volatile(),
})

const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_FILE = join(HERE, '..', 'skills', 'tavily', 'SKILL.md')
const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/** Canonical shape every tool returns: the parsed tvly JSON payload. */
const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

/**
 * Read one volatile field without assuming it was mounted with a getter.
 * @param field - the raw config field.
 * @param fallback - value used when the field is absent or empty.
 * @returns the current plain value.
 */
function plain(field, fallback) {
  if (field === undefined || field === null) return fallback
  const value = typeof field.get === 'function' ? field.get() : field
  return value === undefined || value === null ? fallback : value
}

/**
 * Snapshot the current configuration into plain values.
 * @param config - the mounted (volatile) config object.
 * @returns every setting with its effective default applied.
 */
function snapshot(config) {
  return {
    cliPath: plain(config?.cliPath, undefined),
    apiKey: plain(config?.apiKey, undefined),
    apiKeyEnv: plain(config?.apiKeyEnv, DEFAULT_API_KEY_ENV),
    defaultMaxResults: plain(config?.defaultMaxResults, 5),
    defaultSearchDepth: plain(config?.defaultSearchDepth, 'basic'),
    baseURL: plain(config?.baseURL, undefined),
    timeoutMs: plain(config?.timeoutMs, 180_000),
    enableSearch: plain(config?.enableSearch, true),
    enableExtract: plain(config?.enableExtract, true),
    enableCrawl: plain(config?.enableCrawl, true),
    enableMap: plain(config?.enableMap, true),
  }
}

/**
 * Order the executable candidates: explicit config, explicit environment, then
 * the install locations `pip install --user` and system package managers use.
 * @param settings - the current configuration snapshot.
 * @returns candidates in priority order.
 */
function cliCandidates(settings) {
  return [
    settings.cliPath,
    process.env.TAVILY_CLI_PATH,
    join(homedir(), '.local', 'bin', 'tvly'),
    '/usr/local/bin/tvly',
    '/usr/bin/tvly',
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
}

/**
 * Resolve the executable for this call. Not cached: `cliPath` is volatile.
 * @param settings - the current configuration snapshot.
 * @returns an existing absolute path, otherwise the bare command for PATH lookup.
 */
function resolveCli(settings) {
  for (const candidate of cliCandidates(settings)) {
    if (existsSync(candidate)) return candidate
  }
  return 'tvly'
}

/**
 * Build the child environment, mapping the configured key onto the variable the
 * CLI reads. Without a literal key the ambient environment already carries it.
 * @param settings - the current configuration snapshot.
 * @returns the environment for one CLI invocation.
 */
function cliEnvironment(settings) {
  const env = { ...process.env }
  if (typeof settings.baseURL === 'string' && settings.baseURL.length > 0) {
    env.TAVILY_API_BASE_URL = settings.baseURL
  }
  if (typeof settings.apiKey === 'string' && settings.apiKey.length > 0) {
    env[settings.apiKeyEnv] = settings.apiKey
    return env
  }
  const ambient = process.env[settings.apiKeyEnv]
  if (ambient !== undefined && ambient.length > 0 && settings.apiKeyEnv !== DEFAULT_API_KEY_ENV) {
    env[DEFAULT_API_KEY_ENV] = ambient
  }
  return env
}

/**
 * Turn a tvly stdout payload into a value the tool output schema accepts.
 * @param stdout - raw command output.
 * @returns the parsed JSON object, or a wrapper carrying the raw text.
 */
function parseOutput(stdout) {
  const text = stdout.trim()
  if (text.length === 0) return { ok: true }
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
    return { data: parsed }
  } catch {
    return { raw: text }
  }
}

/**
 * Build an actionable failure message; the model reads this, so it must name
 * the remedy rather than only the cause.
 * @param error - the rejection from `execFile`.
 * @param cli - the executable that was attempted.
 * @returns the diagnostic text.
 */
function describeFailure(error, cli) {
  if (error?.code === 'ENOENT') {
    return `tvly CLI not found (tried ${JSON.stringify(cli)}). Install it with: pip install --user tavily-cli. `
      + 'Or set the plugin\'s cliPath / TAVILY_CLI_PATH to the executable.'
  }
  if (error?.name === 'AbortError' || error?.killed === true) {
    return 'tvly was cancelled or timed out before finishing.'
  }
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
  return stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : String(error?.message ?? error)
}

/**
 * Run `tvly` with JSON output and return the parsed payload.
 * @param args - subcommand arguments, without the trailing `--json`.
 * @param signal - cancellation forwarded from the tool execution.
 * @param settings - the current configuration snapshot.
 * @returns the parsed payload.
 */
async function runTvly(args, signal, settings) {
  const cli = resolveCli(settings)
  try {
    const { stdout } = await execFileAsync(cli, [...args, '--json'], {
      timeout: settings.timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      signal,
      env: cliEnvironment(settings),
    })
    return parseOutput(stdout)
  } catch (error) {
    throw new Error(describeFailure(error, cli))
  }
}

/** Search the web through Tavily. Works keyless. */
function searchTool(config) {
  return defineTool({
    name: 'tavily_search',
    description: 'Search the web through Tavily and return ranked results with titles, URLs and content snippets. '
      + 'Works without an API key. Prefer it over a generic web search when you need citable sources. '
      + 'For a URL you already have, use tavily_extract instead.',
    parameters: {
      query: { type: 'string', required: true, description: 'The search query.' },
      max_results: { type: 'number', description: 'How many results to return, 1-20. Defaults to the configured value.' },
      depth: {
        type: 'string',
        enum: ['ultra-fast', 'fast', 'basic', 'advanced'],
        description: 'Search depth. Defaults to the configured value (basic unless changed).',
      },
      topic: { type: 'string', enum: ['general', 'news', 'finance'], description: 'Result topic. Defaults to general.' },
      time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Relative recency filter.' },
      include_domains: { type: 'string', description: 'Comma-separated domains to restrict results to.' },
      exclude_domains: { type: 'string', description: 'Comma-separated domains to remove from results.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const settings = snapshot(config)
      const argv = ['search', args.query]
      argv.push('--max-results', String(args.max_results ?? settings.defaultMaxResults))
      argv.push('--depth', args.depth ?? settings.defaultSearchDepth)
      if (args.topic !== undefined) argv.push('--topic', args.topic)
      if (args.time_range !== undefined) argv.push('--time-range', args.time_range)
      if (args.include_domains !== undefined) argv.push('--include-domains', args.include_domains)
      if (args.exclude_domains !== undefined) argv.push('--exclude-domains', args.exclude_domains)
      return runTvly(argv, exec.signal, settings)
    },
  })
}

/** Extract clean page content from known URLs. Works keyless. */
function extractTool(config) {
  return defineTool({
    name: 'tavily_extract',
    description: 'Extract clean, LLM-ready content from one or more known URLs (up to 20 per call) through Tavily. '
      + 'Works without an API key. Prefer this over fetching raw HTML when you already have the link and want readable markdown.',
    parameters: {
      urls: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'The absolute URLs to extract, at most 20.',
      },
      query: { type: 'string', description: 'Rerank extracted chunks by relevance to this query.' },
      extract_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Extraction depth. advanced handles harder pages and costs more credits.',
      },
      format: { type: 'string', enum: ['markdown', 'text'], description: 'Output format. Defaults to markdown.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const settings = snapshot(config)
      const argv = ['extract', ...args.urls]
      if (args.query !== undefined) argv.push('--query', args.query)
      if (args.extract_depth !== undefined) argv.push('--extract-depth', args.extract_depth)
      if (args.format !== undefined) argv.push('--format', args.format)
      return runTvly(argv, exec.signal, settings)
    },
  })
}

/** Crawl a site section. Requires an API key. */
function crawlTool(config) {
  return defineTool({
    name: 'tavily_crawl',
    description: 'Crawl a website starting from one URL and return full content for every discovered page. '
      + 'Requires a Tavily API key. Use it for bulk content from a docs section or a catalog; '
      + 'run tavily_map first when you only need the URL inventory.',
    parameters: {
      url: { type: 'string', required: true, description: 'The starting URL to crawl.' },
      max_depth: { type: 'number', description: 'How many levels deep to crawl, 1-5. Defaults to 1.' },
      limit: { type: 'number', description: 'Total page cap. Defaults to 50.' },
      max_breadth: { type: 'number', description: 'Links followed per page. Defaults to 20.' },
      instructions: { type: 'string', description: 'Natural-language guidance for what the crawler should collect.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const settings = snapshot(config)
      const argv = ['crawl', args.url]
      if (args.max_depth !== undefined) argv.push('--max-depth', String(args.max_depth))
      if (args.limit !== undefined) argv.push('--limit', String(args.limit))
      if (args.max_breadth !== undefined) argv.push('--max-breadth', String(args.max_breadth))
      if (args.instructions !== undefined) argv.push('--instructions', args.instructions)
      return runTvly(argv, exec.signal, settings)
    },
  })
}

/** Discover URLs on a site. Requires an API key. */
function mapTool(config) {
  return defineTool({
    name: 'tavily_map',
    description: 'Discover the URLs published under a site, without extracting content. '
      + 'Requires a Tavily API key. Run it before tavily_crawl when you want the site structure first.',
    parameters: {
      url: { type: 'string', required: true, description: 'The starting URL to map.' },
      max_depth: { type: 'number', description: 'How many levels deep to map, 1-5. Defaults to 1.' },
      limit: { type: 'number', description: 'Maximum URLs to discover. Defaults to 50.' },
      instructions: { type: 'string', description: 'Natural-language guidance for URL discovery.' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      const settings = snapshot(config)
      const argv = ['map', args.url]
      if (args.max_depth !== undefined) argv.push('--max-depth', String(args.max_depth))
      if (args.limit !== undefined) argv.push('--limit', String(args.limit))
      if (args.instructions !== undefined) argv.push('--instructions', args.instructions)
      return runTvly(argv, exec.signal, settings)
    },
  })
}

/**
 * Split a skill file into its frontmatter description and Markdown body.
 * @param raw - the full SKILL.md text.
 * @returns the routing description and the body below the fence.
 */
function parseFrontmatter(raw) {
  const fence = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fence === null) return { description: '', body: raw.trim() }
  const frontmatter = fence[1]
  const body = raw.slice(fence[0].length).trim()
  const block = frontmatter.match(/^description:\s*\|?\s*$/m)
  if (block?.index !== undefined) {
    const lines = []
    for (const line of frontmatter.slice(block.index).split('\n').slice(1)) {
      if (line.trim() !== '' && !/^\s/.test(line)) break
      lines.push(line.replace(/^ {2}/, ''))
    }
    return { description: lines.join('\n').trim(), body }
  }
  const inline = frontmatter.match(/^description:\s*(.+)$/m)
  return { description: inline?.[1]?.trim() ?? '', body }
}

/** Register the `tavily` skill from the packaged SKILL.md. */
function registerSkill(ctx) {
  if (!existsSync(SKILL_FILE)) return
  const raw = readFileSync(SKILL_FILE, 'utf8')
  const { description, body } = parseFrontmatter(raw)
  ctx.skills.register({
    name: 'tavily',
    description,
    content: body,
    source: 'bundled',
    path: SKILL_FILE,
    resourceBase: { kind: 'directory', path: dirname(SKILL_FILE) },
  })
}

/**
 * Mount the Tavily tools and skill.
 * @param ctx - the loader scope.
 * @param config - volatile plugin configuration.
 */
export function apply(ctx, config) {
  registerSkill(ctx)
  const settings = snapshot(config)
  const candidates = [
    [settings.enableSearch, searchTool],
    [settings.enableExtract, extractTool],
    [settings.enableCrawl, crawlTool],
    [settings.enableMap, mapTool],
  ]
  for (const [enabled, build] of candidates) {
    if (enabled) ctx.tools.register(build(config))
  }
}
