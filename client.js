/**
 * Browser half of the dsh-tavily bundle.
 *
 * Hand-written `__ModuleLoader__` package shell. The client module loader
 * provides a `require` resolving platform singletons (`react`); this factory
 * implements a cordis client plugin in CommonJS form.
 *
 * It registers one `plugins.row.config` page keyed `<package>#<row id>`; the
 * plugin manager supplies `{ view, form }`. `form.state` carries the
 * Host-accepted values and `form.mutate()` writes them back with a revision
 * fence, so this file never talks to the settings transport directly.
 *
 * Input model: text and number fields keep a local draft and commit on blur or
 * Enter, so typing does not fire one Host write per keystroke. Toggles and
 * selects commit immediately. A short status marker reports the outcome.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tavily',
  factory: (require) => {
    'use strict';

    const module = { exports: {} };
    const exports = module.exports;

    const React = require('react');
    const { useState, useEffect, useRef, useMemo } = React;
    const h = React.createElement;

    const ACCENT = '#4d6bfe';

    const TEXT = {
      zh: {
        summary: 'Tavily 搜索、正文提取、爬取与 URL 发现',
        noForm: '页面没有提供配置表单',
        loading: '正在读取配置…',
        saved: '已保存',
        saving: '保存中…',
        failed: '保存失败',
        groups: { connection: '连接与凭据', behavior: '默认行为', tools: '工具开关' },
        hints: {
          cliPath: '留空则自动探测：~/.local/bin/tvly → /usr/local/bin/tvly → PATH',
          apiKey: '直接填写会明文写入配置文件。推荐改用下面的环境变量。已配置时此处保持空白。',
          apiKeyEnv: '从哪个环境变量读取 Key；同一个名字会传给 CLI',
          baseURL: '留空使用官方端点。可填任意 Tavily 兼容的镜像、网关或自建代理',
          defaultMaxResults: '模型没指定结果数时使用，范围 1–20',
          defaultSearchDepth: '模型没指定深度时使用',
          timeoutMs: '单次 CLI 调用的实际耗时上限',
          enableSearch: '注册 tavily_search（无需 Key）',
          enableExtract: '注册 tavily_extract（无需 Key）',
          enableCrawl: '注册 tavily_crawl（需要 Key）',
          enableMap: '注册 tavily_map（需要 Key）',
        },
        enableHint: '开关在挂载时生效，改动后需要重启 dsh web；其余字段保存即生效。',
        showKey: '显示',
        hideKey: '隐藏',
      },
      en: {
        summary: 'Tavily search, extraction, crawling and URL discovery',
        noForm: 'The page did not provide a configuration form',
        loading: 'Reading configuration…',
        saved: 'Saved',
        saving: 'Saving…',
        failed: 'Save failed',
        groups: { connection: 'Connection and credentials', behavior: 'Defaults', tools: 'Tools' },
        hints: {
          cliPath: 'Blank = auto-detect: ~/.local/bin/tvly → /usr/local/bin/tvly → PATH',
          apiKey: 'A literal key is stored in the profile patch in plain text. Prefer the environment variable below. Left blank when a key is already configured.',
          apiKeyEnv: 'Variable the key is read from; the same name reaches the CLI',
          baseURL: 'Blank = official endpoint. Any Tavily-compatible mirror, gateway, or self-hosted proxy works',
          defaultMaxResults: 'Used when the model omits a count, 1-20',
          defaultSearchDepth: 'Used when the model omits a depth',
          timeoutMs: 'Wall-clock ceiling for one CLI call',
          enableSearch: 'Register tavily_search (no key needed)',
          enableExtract: 'Register tavily_extract (no key needed)',
          enableCrawl: 'Register tavily_crawl (needs a key)',
          enableMap: 'Register tavily_map (needs a key)',
        },
        enableHint: 'These switches apply at mount, so changing one needs a dsh web restart. Every other field applies as soon as it is saved.',
        showKey: 'Show',
        hideKey: 'Hide',
      },
    };

    const GROUPS = [
      { id: 'connection', fields: ['cliPath', 'apiKey', 'apiKeyEnv', 'baseURL'] },
      { id: 'behavior', fields: ['defaultMaxResults', 'defaultSearchDepth', 'timeoutMs'] },
      { id: 'tools', fields: ['enableSearch', 'enableExtract', 'enableCrawl', 'enableMap'] },
    ];

    const FIELDS = {
      cliPath: { kind: 'text', zh: 'tvly 可执行文件路径', en: 'tvly executable path', placeholder: 'auto' },
      apiKey: { kind: 'secret', zh: 'API Key', en: 'API key', placeholder: '(configured)' },
      apiKeyEnv: { kind: 'text', zh: 'Key 环境变量名', en: 'Key environment variable', fallback: 'TAVILY_API_KEY' },
      baseURL: { kind: 'text', zh: '搜索服务地址', en: 'Search endpoint base', placeholder: 'https://api.tavily.com' },
      defaultMaxResults: { kind: 'number', zh: '默认结果数', en: 'Default result count', min: 1, max: 20, fallback: 5 },
      defaultSearchDepth: {
        kind: 'select',
        zh: '默认搜索深度',
        en: 'Default search depth',
        options: ['ultra-fast', 'fast', 'basic', 'advanced'],
        fallback: 'basic',
      },
      timeoutMs: { kind: 'number', zh: '单次调用超时（毫秒）', en: 'Call timeout (ms)', min: 1000, fallback: 180000 },
      enableSearch: { kind: 'boolean', zh: '启用 tavily_search', en: 'Enable tavily_search', fallback: true },
      enableExtract: { kind: 'boolean', zh: '启用 tavily_extract', en: 'Enable tavily_extract', fallback: true },
      enableCrawl: { kind: 'boolean', zh: '启用 tavily_crawl', en: 'Enable tavily_crawl', fallback: true },
      enableMap: { kind: 'boolean', zh: '启用 tavily_map', en: 'Enable tavily_map', fallback: true },
    };

    /** Pick the dictionary from the document language. */
    function dictionary() {
      const lang = typeof document !== 'undefined' && document.documentElement.lang;
      return lang && lang.toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en;
    }

    const S = {
      group: {
        border: '1px solid rgba(127,127,127,0.18)',
        borderRadius: '12px',
        padding: '16px 18px',
        marginBottom: '14px',
      },
      groupTitle: {
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        opacity: 0.55,
        margin: '0 0 12px',
      },
      row: {
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 220px) minmax(0, 1fr)',
        alignItems: 'start',
        columnGap: '16px',
        padding: '7px 0',
      },
      label: { fontSize: '13px', lineHeight: '32px', opacity: 0.92 },
      hint: { fontSize: '11px', lineHeight: 1.5, opacity: 0.5, marginTop: '4px' },
      control: {
        width: '100%',
        maxWidth: '440px',
        height: '32px',
        boxSizing: 'border-box',
        padding: '0 10px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.28)',
        background: 'rgba(127,127,127,0.06)',
        color: 'inherit',
        fontSize: '13px',
        outline: 'none',
      },
      toggleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '7px 0',
      },
      checkbox: { width: '16px', height: '16px', accentColor: ACCENT, cursor: 'pointer' },
      status: { fontSize: '11px', opacity: 0.55 },
    };

    /** One labelled field row with an optional hint. */
    function Row({ label, children, hint }) {
      return h(
        'div',
        { style: S.row },
        h('label', { style: S.label }, label),
        h('div', null, children, hint ? h('div', { style: S.hint }, hint) : null),
      );
    }

    /** A plain text or secret input that commits on blur or Enter. */
    function TextInput({ value, fallback, placeholder, secret, commit, text }) {
      const external = value === undefined || value === null ? '' : String(value);
      const [draft, setDraft] = useState(external);
      const [reveal, setReveal] = useState(false);
      useEffect(() => { setDraft(external); }, [external]);

      const fire = () => {
        const next = draft.trim();
        if (next === external) return;
        commit(next === '' ? undefined : next);
      };

      const input = h('input', {
        type: secret && !reveal ? 'password' : 'text',
        style: S.control,
        value: draft,
        placeholder: placeholder ?? (fallback === undefined ? '' : String(fallback)),
        spellCheck: false,
        onChange: (event) => { setDraft(event.target.value); },
        onBlur: fire,
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            fire();
          }
        },
      });

      if (!secret) return input;
      return h(
        'div',
        { style: { display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '440px' } },
        input,
        h('button', {
          type: 'button',
          onClick: () => { setReveal((v) => !v); },
          style: {
            ...S.control,
            width: 'auto',
            maxWidth: 'none',
            cursor: 'pointer',
            padding: '0 12px',
            flex: '0 0 auto',
          },
        }, reveal ? text.hideKey : text.showKey),
      );
    }

    /** A number input that commits on blur or Enter. */
    function NumberInput({ value, fallback, min, max, commit }) {
      const external = value === undefined || value === null ? '' : String(value);
      const [draft, setDraft] = useState(external);
      useEffect(() => { setDraft(external); }, [external]);

      return h('input', {
        type: 'number',
        min,
        max,
        style: S.control,
        value: draft,
        placeholder: fallback === undefined ? '' : String(fallback),
        onChange: (event) => { setDraft(event.target.value); },
        onBlur: () => {
          if (draft === external) return;
          if (draft.trim() === '') { commit(undefined); return; }
          const parsed = Number(draft);
          if (Number.isFinite(parsed)) commit(parsed);
          else setDraft(external);
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
          }
        },
      });
    }

    /** The bundle's configuration page. */
    function TavilySettings(props) {
      const text = dictionary();
      const view = props && props.view;
      const form = props && props.form;
      const [status, setStatus] = useState(null);
      const timer = useRef(null);

      useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

      const writable = form !== undefined && form !== null && (form.state || {}).writable !== false;

      const commitFor = useMemo(() => (key, value) => {
        if (!writable) return;
        const ops = value === undefined
          ? [{ op: 'unset', path: [key] }]
          : [{ op: 'set', path: [key], value }];
        setStatus('saving');
        Promise.resolve(form.mutate(ops, form.state.revision))
          .then((accepted) => { setStatus(accepted === false ? 'failed' : 'saved'); })
          .catch(() => { setStatus('failed'); })
          .finally(() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => { setStatus(null); }, 1800);
          });
      }, [form, writable]);

      if (view === 'summary') return h('span', null, text.summary);
      if (form === undefined || form === null) {
        return h('p', { style: { opacity: 0.7, fontSize: '13px' } }, text.noForm);
      }

      const state = form.state || {};
      const values = state.value || {};

      if (state.status === 'loading') {
        return h('p', { style: { opacity: 0.7, fontSize: '13px' } }, text.loading);
      }

      const renderField = (key) => {
        const spec = FIELDS[key];
        const label = text === TEXT.zh ? spec.zh : spec.en;
        const hint = text.hints[key];
        const value = values[key];
        const commit = (next) => { commitFor(key, next); };

        if (spec.kind === 'boolean') {
          return h(
            'div',
            { key, style: S.toggleRow },
            h('div', null,
              h('div', { style: { fontSize: '13px' } }, label),
              hint ? h('div', { style: S.hint }, hint) : null),
            h('input', {
              type: 'checkbox',
              style: S.checkbox,
              checked: value === undefined ? spec.fallback : value !== false,
              disabled: !writable,
              onChange: (event) => { commit(event.target.checked); },
            }),
          );
        }

        if (spec.kind === 'select') {
          return h(
            Row,
            { key, label, hint },
            h('select', {
              style: { ...S.control, cursor: 'pointer' },
              value: typeof value === 'string' ? value : spec.fallback,
              disabled: !writable,
              onChange: (event) => { commit(event.target.value); },
            }, spec.options.map((option) => h('option', { key: option, value: option }, option))),
          );
        }

        if (spec.kind === 'number') {
          return h(
            Row,
            { key, label, hint },
            h(NumberInput, {
              value, fallback: spec.fallback, min: spec.min, max: spec.max, commit,
            }),
          );
        }

        return h(
          Row,
          { key, label, hint },
          h(TextInput, {
            value, fallback: spec.fallback, placeholder: spec.placeholder,
            secret: spec.kind === 'secret', commit, text,
          }),
        );
      };

      const statusText = status === null ? null
        : status === 'saving' ? text.saving
          : status === 'failed' ? text.failed : text.saved;

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', paddingTop: '6px' } },
        GROUPS.map((group) => h(
          'section',
          { key: group.id, style: S.group },
          h('h4', { style: S.groupTitle }, text.groups[group.id]),
          group.fields.map((key) => h(React.Fragment, { key }, renderField(key))),
          group.id === 'tools' ? h('p', { style: { ...S.hint, marginTop: '10px' } }, text.enableHint) : null,
        )),
        statusText === null ? null : h(
          'div',
          {
            style: {
              ...S.status,
              marginTop: '2px',
              color: status === 'failed' ? '#e5534b' : undefined,
            },
          },
          statusText,
        ),
      );
    }

    /** Register the configuration page for this bundle's row. */
    function apply(ctx) {
      ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: 'dsh-tavily#tavily',
        label: () => 'Tavily',
      }, TavilySettings));
    }

    exports.apply = apply;
    exports.inject = ['slots'];

    return module.exports;
  },
});
