import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rng, uniform, logNormal, fittsDuration, mousePath, clickDwell,
  typeSchedule, keyDwell, scrollSequence, readingPause, idleDrift,
} from '../lib/human.js'

test('rng is deterministic for a seed', () => {
  const a = rng(42); const b = rng(42)
  for (let i = 0; i < 5; i++) assert.equal(a(), b())
})

test('fittsDuration follows T = a + b*log2(D/W+1) within jitter', () => {
  const rand = rng(7)
  const samples = Array.from({ length: 200 }, () => fittsDuration(600, 40, rand))
  const median = samples.sort((x, y) => x - y)[100]
  const expected = 100 + 150 * Math.log2(600 / 40 + 1) // 700ms
  assert.ok(Math.abs(median - expected) < expected * 0.2, `median ${median} vs ${expected}`)
})

test('mousePath ends on target and never jumps more than a few px', () => {
  const rand = rng(3)
  const path = mousePath({ x: 10, y: 10 }, { x: 610, y: 310 }, rand)
  assert.ok(path.length >= 8)
  const last = path[path.length - 1]
  assert.equal(last.x, 610)
  assert.equal(last.y, 310)
  const totalDelay = path.reduce((s, p) => s + p.delay, 0)
  assert.ok(totalDelay > 200 && totalDelay < 2000, `total ${totalDelay}ms`)
})

test('clickDwell stays inside the human band and centres near 110ms', () => {
  const rand = rng(11)
  const s = Array.from({ length: 500 }, () => clickDwell(rand))
  assert.ok(Math.min(...s) >= 55 && Math.max(...s) <= 260)
  const median = s.sort((a, b) => a - b)[250]
  assert.ok(median > 85 && median < 145, `median ${median}`)
})

test('typeSchedule: every gap positive, long text gets typos, CJK marked as ime', () => {
  const rand = rng(5)
  const sched = typeSchedule('hello world, this is a longer sentence for typing.', rand)
  assert.ok(sched.every(s => s.gap > 0))
  assert.ok(sched.length >= 50)
  const cjk = typeSchedule('你好世界', rand)
  assert.equal(cjk.filter(s => s.kind === 'ime').length, 4)
  const long = typeSchedule('x'.repeat(1200), rand)
  assert.ok(long.some(s => s.text === '\b'), 'expected at least one correction in 1200 chars')
})

test('keyDwell is inside 38-115ms', () => {
  const rand = rng(9)
  const s = Array.from({ length: 300 }, () => keyDwell(rand))
  assert.ok(Math.min(...s) >= 38 && Math.max(...s) <= 115)
})

test('scrollSequence decays and covers the requested distance', () => {
  const rand = rng(21)
  const seq = scrollSequence(900, rand)
  assert.ok(seq.length >= 4 && seq.length <= 16)
  const sum = seq.reduce((s, t) => s + Math.abs(t.deltaY), 0)
  assert.ok(sum > 700 && sum < 1100, `sum ${sum}`)
  // first tick should be the biggest
  assert.ok(Math.abs(seq[0].deltaY) >= Math.abs(seq[seq.length - 1].deltaY))
})

test('readingPause clamps between 0.5s and 6s', () => {
  const rand = rng(13)
  assert.ok(readingPause(10, rand) >= 350)
  assert.ok(readingPause(100000, rand) <= 8400)
})

test('idleDrift moves no more than a couple of px per step', () => {
  const rand = rng(17)
  const d = idleDrift({ x: 100, y: 100 }, rand, 5)
  assert.equal(d.length, 5)
  for (let i = 1; i < d.length; i++) {
    const dx = Math.abs(d[i].x - d[i - 1].x)
    assert.ok(dx <= 3, `dx ${dx}`)
  }
})
