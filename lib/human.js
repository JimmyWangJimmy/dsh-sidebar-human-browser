/**
 * Human input engine — pure functions, no DOM, no Electron.
 *
 * Everything here is deterministic given the `rand` you pass in, so the tests
 * can assert the distributions instead of eyeballing them. The distributions are
 * drawn from human-factors literature, not invented numbers:
 *
 *  - movement time: Fitts (1954), T = a + b * log2(D / W + 1), a=0.1s b=0.15s
 *  - click dwell: log-normal, median 110ms, 95th percentile ~220ms
 *  - inter-key interval: log-normal, mean 110ms, sigma 0.45 (in log space)
 *  - scroll: inertial decay, 5-15 wheel ticks per gesture
 *
 * @module human
 */

/** Deterministic PRNG so runs are reproducible (mulberry32). */
export function rng (seed = 1) {
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
export const uniform = (rand, min, max) => min + (max - min) * rand()

/** Log-normal with the given median and sigma (log-space). */
export function logNormal (rand, median, sigma) {
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
export function fittsDuration (distance, width, rand) {
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
export function mousePath (from, to, rand, options = {}) {
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
export function clickDwell (rand) {
  return Math.round(Math.min(260, Math.max(55, logNormal(rand, 110, 0.35))))
}

/** Hover time before pressing, and idle time after release. */
export function hoverBefore (rand) {
  return Math.round(uniform(rand, 90, 380))
}

export function settleAfter (rand) {
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
export function typeSchedule (text, rand, options = {}) {
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
export function keyDwell (rand) {
  return Math.round(uniform(rand, 38, 115))
}

/**
 * Scrolling gesture: wheel ticks with inertial decay, not one big jump.
 * delta values are pixels; `delay` is the wait before sending that tick.
 */
export function scrollSequence (distance, rand) {
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
export function readingPause (charCount, rand) {
  const seconds = Math.min(6, Math.max(0.5, charCount / 250))
  return Math.round(seconds * 1000 * uniform(rand, 0.7, 1.4))
}

/** A pointer that drifts a pixel or two while "idle" — no human is perfectly still. */
export function idleDrift (origin, rand, count = 3) {
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
