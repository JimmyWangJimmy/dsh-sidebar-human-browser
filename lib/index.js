/**
 * dsh-sidebar-human-browser — host half.
 *
 * Adds a set of `human_*` tools that drive DSH Desktop's built-in sidebar
 * browser with human-shaped input: Fitts-law pointer paths, press dwell,
 * per-character typing with corrections, inertial scrolling and reading pauses.
 *
 * Transport: the app window (the sidebar `<webview>` element's own methods).
 * No debug port, no CDP, no external network.
 *
 * @module dsh-sidebar-human-browser
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'

const name = 'sidebar-human-browser'
const inject = ['tools']

const Config = z.object({
  /** Browser identity reported to pages. Keep the three fields consistent. */
  userAgent: z.string().default('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'),
  platform: z.string().default('macOS'),
  version: z.string().default('152.0.7977.130'),
  /** Fingerprint shim on dom-ready. Off = pages see the raw Electron identity. */
  fingerprint: z.boolean().default(true),
})

const BRIDGE_PREFIX = '/dsh-sidebar-human'

/** Same long-poll bridge the sidebar browser uses: one command at a time. */
function createBridge () {
  const queue = []
  const parked = []
  const inflight = new Map()
  let lastSeen = 0

  const pump = () => {
    while (queue.length > 0 && parked.length > 0) {
      const waiter = parked.shift()
      if (!waiter.gone) waiter.hand(queue.shift())
    }
  }

  return {
    alive: () => parked.some(waiter => !waiter.gone) || Date.now() - lastSeen < 30000,

    request (op, args = {}, timeoutMs = 60000) {
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          inflight.delete(id)
          const at = queue.findIndex(command => command.id === id)
          if (at >= 0) queue.splice(at, 1)
          reject(new Error('the DSH window did not answer in time — is it open and focused?'))
        }, timeoutMs)
        inflight.set(id, { resolve, reject, timer })
        queue.push({ id, op, args })
        pump()
      })
    },

    poll (waitMs = 20000) {
      lastSeen = Date.now()
      let waiter
      const promise = new Promise(resolve => {
        const timer = setTimeout(() => { waiter.gone = true; resolve(null) }, waitMs)
        waiter = { gone: false, hand: command => { clearTimeout(timer); waiter.gone = true; resolve(command) } }
        parked.push(waiter)
      })
      pump()
      return { promise, cancel: () => { waiter.gone = true } }
    },

    reply ({ id, ok, value, error }) {
      lastSeen = Date.now()
      const slot = inflight.get(id)
      if (!slot) return false
      inflight.delete(id)
      clearTimeout(slot.timer)
      if (ok) slot.resolve(value)
      else slot.reject(new Error(error || 'the window bridge reported a failure'))
      return true
    },
  }
}

const readJson = (req, limit = 2 * 1024 * 1024) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  req.on('data', chunk => {
    size += chunk.length
    if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
    chunks.push(chunk)
  })
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
  })
  req.on('error', reject)
})

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function mountBridge (ctx, bridge) {
  const guard = (req, res) => {
    if (req.method === 'POST' && String(req.headers['content-type'] ?? '').startsWith('application/json')) return true
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return false
  }
  const routes = {
    poll: async (req, res) => {
      if (!guard(req, res)) return
      await readJson(req)
      const { promise, cancel } = bridge.poll()
      res.on('close', cancel)
      const command = await promise
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, command ?? { idle: true })
    },
    reply: async (req, res) => {
      if (!guard(req, res)) return
      sendJson(res, 200, { ok: bridge.reply(await readJson(req)) })
    },
  }
  for (const [key, handler] of Object.entries(routes)) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: `${BRIDGE_PREFIX}/${key}`, handler }),
      `dsh-sidebar-human-browser: ${key} route`,
    )
  }
}

const textOutput = { render: (_args, value) => [{ type: 'text', text: value }] }
const NOTE = 'Drives the built-in Browser tab of DSH Desktop with human-shaped input (pointer path, press dwell, per-key timing). Requires the sidebar Browser tab to be open — human_open creates one.'

function renderSnapshot (snap) {
  const head = `${snap.title || '(untitled)'}\n${snap.url}\nfocus=${snap.focus}  elements=${snap.elements.length}`
  const rows = snap.elements.slice(0, 80).map(el => `  [${el.id}] <${el.tag}> ${el.text || '(no text)'}  @${el.x},${el.y} ${el.w}x${el.h}`)
  return [head, ...rows].join('\n')
}

function apply (ctx, config) {
  const bridge = createBridge()
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], web => mountBridge(web, bridge))

  const identity = {
    userAgent: config.userAgent,
    platform: config.platform,
    version: config.version,
    brands: [
      { brand: 'Not A(Brand', version: '8' },
      { brand: 'Chromium', version: config.version.split('.')[0] },
      { brand: 'Google Chrome', version: config.version.split('.')[0] },
    ],
  }

  /** Identity travels with every page-touching command so the client can inject it. */
  const ask = (op, args = {}) => {
    if (!bridge.alive()) throw new Error('the DSH window is not connected — open the app window and try again')
    return bridge.request(op, { ...args, identity: config.fingerprint ? identity : null })
  }

  ctx.tools.register(defineTool({
    name: 'human_open',
    description: `Open a Browser tab in the DSH sidebar and load a URL. ${NOTE}`,
    parameters: { url: { type: 'string', description: 'Address to load, absolute or bare host.' } },
    output: textOutput,
    execute: async args => {
      await ask('open', { url: args.url })
      return `window identity: ${identity.userAgent}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_tabs',
    description: `List the sidebar browser tabs this plugin can drive. ${NOTE}`,
    parameters: {},
    output: textOutput,
    execute: async () => {
      const tabs = await ask('tabs')
      if (tabs.length === 0) throw new Error('no browser tab is open — call human_open first')
      return tabs.map(t => `  [${t.index}]${t.visible ? '*' : ' '} ${(t.title || '').slice(0, 50)}  ${t.url.slice(0, 90)}`).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_snapshot',
    description: `Read the page and number its interactive elements. The numbers come from a page-memory registry, so the DOM is never tagged with attributes. ${NOTE}`,
    parameters: { tab: { type: 'string', description: 'URL or title fragment; omit for the active tab.' } },
    output: textOutput,
    execute: async args => renderSnapshot(await ask('snapshot', { tab: args.tab })),
  }))

  ctx.tools.register(defineTool({
    name: 'human_text',
    description: `Visible text of the page. ${NOTE}`,
    parameters: { tab: { type: 'string' } },
    output: textOutput,
    execute: async args => ask('text', { tab: args.tab }),
  }))

  ctx.tools.register(defineTool({
    name: 'human_navigate',
    description: `Navigate the sidebar browser to a URL and wait for the load. ${NOTE}`,
    parameters: { url: { type: 'string', required: true } },
    output: textOutput,
    execute: async args => {
      const r = await ask('navigate', { url: args.url })
      return `${r.url}\n${r.title}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_click',
    description: `Click an element the way a person would: bezier pointer path with jitter, hover pause, 60-220ms press dwell, optional overshoot correction. Returns the measured timings. ${NOTE}`,
    parameters: {
      index: { type: 'integer', required: true, description: 'Element number from human_snapshot.' },
      double: { type: 'boolean', description: 'Double click.' },
      tab: { type: 'string' },
      seed: { type: 'integer', description: 'Fix the random seed to reproduce a path.' },
    },
    output: textOutput,
    execute: async args => {
      const r = await ask('click', args, 90000)
      return `clicked [${r.clicked}] <${r.tag}> "${r.text}"  hold=${r.holdMs}ms path=${r.pathMs}ms (${r.points} pts)`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_type',
    description: `Type like a person: one key at a time with 38-115ms dwell, log-normal gaps, word/sentence pauses, occasional typo + backspace. ${NOTE}`,
    parameters: {
      text: { type: 'string', required: true },
      index: { type: 'integer', description: 'Focus this element first (number from human_snapshot).' },
      replace: { type: 'boolean', description: 'Select all before typing.' },
      tab: { type: 'string' },
      seed: { type: 'integer' },
    },
    output: textOutput,
    execute: async args => {
      const r = await ask('type', args, 180000)
      return `typed ${r.chars} chars (${r.typed} key events), median gap ${r.medianGap}ms`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_scroll',
    description: `Scroll with an inertial wheel gesture (4-16 decaying ticks) instead of one jump. ${NOTE}`,
    parameters: {
      direction: { type: 'string', required: true, description: 'up, down, top or bottom.' },
      amount: { type: 'integer', description: 'Pixels for up/down; default 600.' },
      tab: { type: 'string' },
      seed: { type: 'integer' },
    },
    output: textOutput,
    execute: async args => {
      const r = await ask('scroll', args)
      return r.ticks ? `scrolled ${r.delta}px in ${r.ticks} wheel ticks` : `scrolled to ${r.scrolled}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'human_eval',
    description: `Evaluate JS in the page. This is a script injection and is the least human-looking tool here — prefer snapshot/text. ${NOTE}`,
    parameters: { expression: { type: 'string', required: true }, tab: { type: 'string' } },
    output: textOutput,
    execute: async args => {
      const value = await ask('eval', { expression: args.expression, tab: args.tab })
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    },
  }))
}

export { Config, apply, inject, name }
