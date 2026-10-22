/**
 * Built by scripts/build.mjs — do not edit lib/client.js by hand.
 * The human engine below is inlined from lib/human.js so the shell can load this
 * file standalone (it is fetched as /plugins/<pkg>/client.js, not as a module).
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-human-browser',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PREFIX = '/dsh-sidebar-human'
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const safe = (read, fallback) => { try { return read() } catch (error) { return fallback } }
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }

    /* ---------------- human engine (inlined) ---------------- */
/** Deterministic PRNG so runs are reproducible (mulberry32). */
function rng (seed = 1) {
  let a = seed >>> 0
  return function rand () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform in [min, max]. */
const uniform = (rand, min, max) => min + (max - min) * rand()

/** Log-normal with the given median and sigma (log-space). */
function logNormal (rand, median, sigma) {
  const u = Math.max(rand(), 1e-9)
  const v = Math.max(rand(), 1e-9)
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return median * Math.exp(sigma * z)
}

/**
 * Fitts' law movement time in ms, with a 15% jitter so repeated moves differ.
 * @param {number} distance px between start and target centre
 * @param {number} width target width in px
 * @param {() => number} rand
 */
function fittsDuration (distance, width, rand) {
  const d = Math.max(24, distance)
  const w = Math.max(8, width)
  const t = 100 + 150 * Math.log2(d / w + 1) // ms
  return Math.round(t * uniform(rand, 0.85, 1.15))
}

/**
 * Pointer path from A to B: quadratic Bezier with a perpendicular bow plus
 * per-sample noise, sampled on a 8-16ms cadence like a 60-120Hz input device.
 * Returns points with the delay to wait *before* sending each one.
 */
function mousePath (from, to, rand, options = {}) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const width = options.width ?? 40
  const total = fittsDuration(distance, width, rand)
  const steps = Math.max(6, Math.min(40, Math.round(distance / 28) + 4))

  // Perpendicular bow: humans arc their movement instead of going straight.
  const bow = uniform(rand, -0.18, 0.18) * distance
  const nx = distance === 0 ? 0 : -(to.y - from.y) / distance
  const ny = distance === 0 ? 0 : (to.x - from.x) / distance
  const control = {
    x: (from.x + to.x) / 2 + nx * bow,
    y: (from.y + to.y) / 2 + ny * bow,
  }

  const points = []
  const dt = total / steps
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y
    // Noise shrinks near the target: that is the visual "settling" humans do.
    const amp = (1 - t) * 2.2 + 0.35
    points.push({
      x: Math.round(x + uniform(rand, -amp, amp)),
      y: Math.round(y + uniform(rand, -amp, amp)),
      delay: Math.max(4, Math.round(dt * uniform(rand, 0.6, 1.4))),
    })
  }

  // 15% of moves overshoot a little and come back — a correction movement.
  if (rand() < 0.15) {
    const ox = uniform(rand, -6, 6)
    const oy = uniform(rand, -6, 6)
    points.push({ x: Math.round(to.x + ox), y: Math.round(to.y + oy), delay: Math.round(uniform(rand, 40, 90)) })
    points.push({ x: Math.round(to.x), y: Math.round(to.y), delay: Math.round(uniform(rand, 60, 130)) })
  } else {
    points.push({ x: Math.round(to.x), y: Math.round(to.y), delay: Math.round(uniform(rand, 10, 30)) })
  }
  return points
}

/** Mouse-down to mouse-up hold time in ms (log-normal, median 110ms). */
function clickDwell (rand) {
  return Math.round(Math.min(260, Math.max(55, logNormal(rand, 110, 0.35))))
}

/** Hover time before pressing, and idle time after release. */
function hoverBefore (rand) {
  return Math.round(uniform(rand, 90, 380))
}

function settleAfter (rand) {
  return Math.round(uniform(rand, 60, 260))
}

/**
 * Turn a string into a keystroke schedule.
 * Each entry: { text, gap } where gap is the wait *before* this key.
 * Word and sentence boundaries get a longer pause, and 1.5% of characters are
 * typed wrong and corrected with a backspace — humans do this constantly.
 *
 * @param {string} text
 * @param {() => number} rand
 * @param {{ typoRate?: number }} options
 */
function typeSchedule (text, rand, options = {}) {
  const typoRate = options.typoRate ?? 0.015
  const out = []
  const chars = [...text]
  let prev = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    let gap
    if (i === 0) gap = Math.round(uniform(rand, 120, 320))
    else if (prev === ' ' || prev === '\n') gap = Math.round(uniform(rand, 90, 260))
    else if (/[.?!。？！;；:,，]/.test(prev)) gap = Math.round(uniform(rand, 180, 420))
    else gap = Math.round(Math.min(420, Math.max(45, logNormal(rand, 105, 0.45))))

    // Wrong key then backspace. Never for the first character so cheap tests stay stable.
    if (i > 0 && ch !== ' ' && rand() < typoRate) {
      out.push({ text: 'x', gap, kind: 'key' })
      out.push({ text: '\b', gap: Math.round(uniform(rand, 90, 220)), kind: 'key' })
    }
    out.push({ text: ch, gap, kind: /[\u4e00-\u9fff]/.test(ch) ? 'ime' : 'key' })
    prev = ch
  }
  return out
}

/** Key hold time (down to up) in ms. */
function keyDwell (rand) {
  return Math.round(uniform(rand, 38, 115))
}

/**
 * Scrolling gesture: wheel ticks with inertial decay, not one big jump.
 * delta values are pixels; `delay` is the wait before sending that tick.
 */
function scrollSequence (distance, rand) {
  const sign = Math.sign(distance) || 1
  const total = Math.abs(distance)
  const ticks = Math.max(4, Math.min(16, Math.round(total / 90) + 3))
  const decay = 0.72 + rand() * 0.12
  const out = []
  let remaining = total
  let weight = 0
  const weights = []
  for (let i = 0; i < ticks; i++) {
    const w = decay ** i
    weights.push(w)
    weight += w
  }
  for (let i = 0; i < ticks; i++) {
    const delta = Math.max(8, Math.round((total * weights[i]) / weight))
    remaining -= delta
    out.push({
      deltaY: sign * Math.min(delta, Math.max(8, remaining + delta)),
      delay: Math.round(uniform(rand, 14, 46)),
    })
  }
  return out
}

/** How long a human looks at a page before acting (scanning ~250 chars/s). */
function readingPause (charCount, rand) {
  const seconds = Math.min(6, Math.max(0.5, charCount / 250))
  return Math.round(seconds * 1000 * uniform(rand, 0.7, 1.4))
}

/** A pointer that drifts a pixel or two while "idle" — no human is perfectly still. */
function idleDrift (origin, rand, count = 3) {
  const out = []
  let x = origin.x
  let y = origin.y
  for (let i = 0; i < count; i++) {
    x += Math.round(uniform(rand, -2.2, 2.2))
    y += Math.round(uniform(rand, -2.2, 2.2))
    out.push({ x, y, delay: Math.round(uniform(rand, 120, 420)) })
  }
  return out
}
    /* ---------------- webview plumbing ---------------- */

    const guests = () => [...document.querySelectorAll('webview[data-sidebar-browser-frame]')]
    const urlOf = guest => safe(() => guest.getURL(), '')
    const titleOf = guest => safe(() => guest.getTitle(), '')

    function pick (want) {
      const all = guests().filter(guest => /^https?:/.test(urlOf(guest)))
      if (all.length === 0) throw new Error('no browser tab is open — call human_open first')
      if (want) {
        const needle = String(want).toLowerCase()
        const hit = all.find(guest => urlOf(guest).toLowerCase().includes(needle) || titleOf(guest).toLowerCase().includes(needle))
        if (hit) return hit
      }
      return all.find(visible) ?? all[0]
    }

    const evaluate = (guest, code) => guest.executeJavaScript(code)

    /** Element registry lives in page memory (a Map), so the DOM is never tagged. */
    const SNAPSHOT_JS = `(() => {
      const map = window.__hbNodes || (window.__hbNodes = { next: 0, nodes: new Map() })
      const sel = 'a,button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[contenteditable="true"]'
      const out = []
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        if (r.bottom < -innerHeight || r.top > innerHeight * 4) continue
        let id = el.__hbId
        if (!id) { id = ++map.next; el.__hbId = id; map.nodes.set(id, el) }
        out.push({
          id,
          tag: el.tagName.toLowerCase(),
          text: String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
      return { url: location.href, title: document.title, focus: document.hasFocus(), elements: out.slice(0, 400), text: (document.body ? document.body.innerText : '').slice(0, 3000) }
    })()`

    const rectOf = (guest, id) => evaluate(guest, `(() => {
      const map = window.__hbNodes
      const el = map && map.nodes.get(${Number(id)})
      if (!el || !el.isConnected) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName.toLowerCase(), text: String(el.innerText || el.value || '').slice(0, 60) }
    })()`)

    /** Fingerprint shim: makes UA, UA-CH and a few Electron tells agree with each other. */
    function fingerprintShim (identity) {
      return `(() => {
        if (window.__hbFp) return 'already'
        window.__hbFp = true
        const UA = ${JSON.stringify(identity.userAgent)}
        const BRANDS = ${JSON.stringify(identity.brands)}
        const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }) } catch (e) {} }
        def(navigator, 'userAgent', UA)
        def(navigator, 'appVersion', UA.replace(/^Mozilla\\//, ''))
        def(navigator, 'vendor', 'Google Inc.')
        def(navigator, 'webdriver', false)
        try {
          const uad = navigator.userAgentData
          if (uad) {
            def(uad, 'brands', BRANDS)
            def(uad, 'platform', identity.platform)
            const original = uad.getHighEntropyValues && uad.getHighEntropyValues.bind(uad)
            if (original) uad.getHighEntropyValues = async hints => {
              const real = await original(hints)
              return Object.assign(real, { brands: BRANDS, platform: identity.platform, uaFullVersion: identity.version })
            }
          }
        } catch (e) {}
        return 'ok'
      })()`
    }

    /** Attach the shim to every guest page as soon as its document is ready. */
    function watchGuest (guest) {
      if (!guest || guest.__hbWatched) return
      guest.__hbWatched = true
      const inject = () => {
        const identity = (window.__hbIdentity || null)
        if (!identity) return
        guest.executeJavaScript(fingerprintShim(identity)).catch(() => {})
      }
      guest.addEventListener('dom-ready', inject)
      safe(() => guest.getURL()) && inject()
    }

    /* ---------------- operations ---------------- */

    function operations (ctx) {
      const service = () => ctx.sidebarRight
      const adopt = args => { if (args && args.identity) window.__hbIdentity = args.identity }
      return {
        async open ({ url }) {
          const known = new Map(guests().map(guest => [guest, urlOf(guest)]))
          service().openTab('browser', url ? { params: { url } } : {})
          if (!url) {
            await sleep(500)
            return { opened: null, tabs: guests().length }
          }
          for (let i = 0; i < 60; i++) {
            await sleep(200)
            const fresh = guests().find(guest => /^https?:/.test(urlOf(guest)) && known.get(guest) !== urlOf(guest))
            if (fresh) return { opened: urlOf(fresh), title: titleOf(fresh) }
          }
          throw new Error(`the tab opened but no page appeared for ${url} within 12 s`)
        },

        tabs () {
          return guests().map((guest, index) => ({ index, title: titleOf(guest), url: urlOf(guest), visible: visible(guest) }))
        },

        snapshot (args) {
          adopt(args); const { tab } = args
          const guest = pick(tab)
          watchGuest(guest)
          return evaluate(guest, SNAPSHOT_JS)
        },

        text ({ tab }) {
          const guest = pick(tab)
          return evaluate(guest, 'document.body ? document.body.innerText.slice(0, 8000) : ""')
        },

        async navigate (args) {
          adopt(args); const { url } = args
          const guest = pick()
          guest.loadURL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`)
          for (let i = 0; i < 80; i++) {
            await sleep(200)
            if (safe(() => guest.isLoading(), true) === false) break
          }
          await sleep(300)
          return { url: urlOf(guest), title: titleOf(guest) }
        },

        async click (args) {
          adopt(args); const { index, double, tab, seed } = args
          const guest = pick(tab)
          watchGuest(guest)
          if (typeof guest.focus === 'function') guest.focus()
          const rect = await rectOf(guest, index)
          if (!rect) throw new Error(`element [${index}] is gone — run human_snapshot again`)
          const rand = rng(seed || Date.now() % 100000)
          const from = { x: Math.round(uniform(rand, 20, 300)), y: Math.round(uniform(rand, 20, 200)) }
          const path = mousePath(from, { x: rect.x, y: rect.y }, rand, { width: rect.w })
          const trace = []
          for (const point of path) {
            await sleep(point.delay)
            guest.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
            trace.push(point.delay)
          }
          await sleep(hoverBefore(rand))
          const hold = clickDwell(rand)
          const clicks = double ? 2 : 1
          for (let c = 0; c < clicks; c++) {
            guest.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: c + 1 })
            await sleep(hold)
            guest.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: c + 1 })
            if (double) await sleep(Math.round(uniform(rand, 60, 130)))
          }
          await sleep(settleAfter(rand))
          return { clicked: index, tag: rect.tag, text: rect.text, holdMs: hold, pathMs: trace.reduce((a, b) => a + b, 0), points: path.length }
        },

        async type (args) {
          adopt(args); const { index, text, replace, tab, seed } = args
          const guest = pick(tab)
          watchGuest(guest)
          if (typeof guest.focus === 'function') guest.focus()
          const rand = rng(seed || Date.now() % 100000)
          if (index !== undefined) {
            const rect = await rectOf(guest, index)
            if (!rect) throw new Error(`element [${index}] is gone — run human_snapshot again`)
            const path = mousePath({ x: rect.x - 40, y: rect.y - 30 }, { x: rect.x, y: rect.y }, rand, { width: rect.w })
            for (const point of path) { await sleep(point.delay); guest.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y }) }
            guest.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
            await sleep(clickDwell(rand))
            guest.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
            await sleep(hoverBefore(rand))
          }
          if (replace) {
            guest.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['command'] })
            guest.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['command'] })
            await sleep(Math.round(uniform(rand, 60, 140)))
          }
          const schedule = typeSchedule(text, rand)
          const gaps = []
          for (const step of schedule) {
            await sleep(step.gap)
            gaps.push(step.gap)
            if (step.text === '\b') {
              guest.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
              await sleep(keyDwell(rand))
              guest.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
            } else if (step.kind === 'key') {
              const code = step.text === ' ' ? 'Space' : step.text
              guest.sendInputEvent({ type: 'keyDown', keyCode: code })
              await sleep(keyDwell(rand))
              guest.sendInputEvent({ type: 'char', keyCode: step.text })
              guest.sendInputEvent({ type: 'keyUp', keyCode: code })
            } else {
              guest.insertText(step.text)
            }
          }
          return { typed: schedule.length, chars: [...text].length, medianGap: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0 }
        },

        async scroll ({ direction, amount, tab, seed }) {
          const guest = pick(tab)
          const rand = rng(seed || Date.now() % 100000)
          const base = amount || 600
          const distance = direction === 'up' ? -base : direction === 'top' ? -20000 : direction === 'bottom' ? 20000 : base
          if (direction === 'top' || direction === 'bottom') {
            await evaluate(guest, `window.scrollTo({ top: ${direction === 'top' ? 0 : 'document.body.scrollHeight'}, behavior: 'smooth' })`)
            await sleep(Math.round(uniform(rand, 600, 1400)))
            return { scrolled: direction }
          }
          const seq = scrollSequence(Math.abs(distance), rand)
          const y = Math.round(uniform(rand, 200, 500))
          for (const tick of seq) {
            await sleep(tick.delay)
            guest.sendInputEvent({ type: 'mouseWheel', x: 300, y, deltaY: tick.deltaY, deltaX: 0, canScroll: true })
          }
          await sleep(Math.round(uniform(rand, 180, 620)))
          return { ticks: seq.length, delta: seq.reduce((s, t) => s + t.deltaY, 0) }
        },

        async eval ({ expression, tab }) {
          const guest = pick(tab)
          return evaluate(guest, `(async () => { try { return ${expression} } catch (e) { return 'ERR ' + (e && e.message) } })()`)
        },
      }
    }

    /* ---------------- bridge loop ---------------- */

    function apply (ctx) {
      let stopped = false
      const post = async (path, body) => {
        const response = await fetch(`${PREFIX}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`bridge ${path}: HTTP ${response.status}`)
        return response.json()
      }
      const serve = async () => {
        const run = operations(ctx)
        while (!stopped) {
          let command
          try { command = await post('poll', {}) } catch (error) { if (stopped) return; await sleep(1500); continue }
          if (!command || command.idle) continue
          try {
            const value = await run[command.op](command.args || {})
            await post('reply', { id: command.id, ok: true, value })
          } catch (error) {
            await post('reply', { id: command.id, ok: false, error: String((error && error.message) || error) })
          }
        }
      }
      serve()
      return () => { stopped = true }
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
