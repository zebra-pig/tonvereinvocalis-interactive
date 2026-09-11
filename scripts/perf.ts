// Performance evaluation: plays the game in headless Chrome on an instrumented production build and prints ranked,
// actionable insights (paste the output into a Claude session to work on them).
//
//   pnpm run perf                          phone: 390×844 @3x, main thread throttled 4×, 30 s of play
//   pnpm run perf --device desktop         1440×900 @2x, no throttling
//   pnpm run perf --cpu 6 --seconds 60     heavier throttling, longer run
//
// How: builds an unminified production bundle into node_modules/.perf/dist with a Vite plugin that wraps three/webgpu
// (node builds, GPU pipeline creation, GPU timestamps), createObstacleView (spawn cost, update cost) and step (physics).
// Nothing in src/ changes. Math.random is seeded (--seed), so runs see the same obstacles; crash timing still varies a
// little, so compare runs by their big numbers. Needs Google Chrome. CPU throttling slows only the main thread, not
// the GPU: real phone GPUs are several times slower than a desktop's.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { build, type Plugin, preview } from 'vite'

type Timed = { at: number; ms: number }
type Spawn = Timed & { kind: string }
type Compile = { at: number; ms?: number; what: string }
type ThreeStats = {
  revision: string
  builds: Compile[]
  pipelines: Compile[]
  gpuMs: number[]
  drawCalls: number
  triangles: number
  canvas?: string
  backend?: string
  initMs?: number
  compileMs?: number
  compilePipelines?: number
}
type Run = { stamps: number[]; js: [start: number, ms: number][]; spawns: Spawn[]; updateMs: number; physicsMs: number; three?: ThreeStats }
type PerfState = Run & { recording: boolean; firstFrame: number }
type CpuProfile = {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]
  samples?: number[]
  timeDeltas?: number[]
}
type Frame = { start: number; ms: number; jsMs?: number }
type Cause = 'compile' | 'spawn' | 'script' | 'idle'

declare global {
  interface Window {
    __perf: PerfState
  }
}

const { values: arg } = parseArgs({
  options: {
    device: { type: 'string', default: 'phone' },
    cpu: { type: 'string' },
    seconds: { type: 'string', default: '30' },
    seed: { type: 'string', default: '7' },
    webgl: { type: 'boolean', default: false }, // force the WebGL 2 backend
    swiftshader: { type: 'boolean', default: false }, // only a software WebGPU adapter, like machines without GPU support
  },
})
const DEVICES: Record<string, { width: number; height: number; scale: number; mobile: boolean; cpu: number }> = {
  phone: { width: 390, height: 844, scale: 3, mobile: true, cpu: 4 },
  desktop: { width: 1440, height: 900, scale: 2, mobile: false, cpu: 1 },
}
const device = DEVICES[arg.device]
if (!device) throw new Error(`--device must be one of: ${Object.keys(DEVICES).join(', ')}`)
const { width, height } = device
const cpu = Number(arg.cpu ?? device.cpu)
const seconds = Number(arg.seconds)
const FRAME = 1000 / 60
const LONG = 25 // ms: a frame this long is a visible stutter
const root = fileURLToPath(new URL('..', import.meta.url))
const out = `${root}node_modules/.perf/`
const name = `${arg.device}-cpu${cpu}${arg.webgl ? '-webgl' : ''}${arg.swiftshader ? '-swiftshader' : ''}`
mkdirSync(out, { recursive: true })

// Instrumentation, as virtual modules swapped in at build time (plain JS, it runs in the bundle).
const THREE = fileURLToPath(import.meta.resolve('three/webgpu'))
const VIEWS = `${root}src/obstacles/index.ts`
const GAME = `${root}src/game.ts`
const j = JSON.stringify
const modules: Record<string, string> = {
  '\0perf:three': `
import * as T from ${j(THREE)}
export * from ${j(THREE)}
const p = (window.__perf.three = { revision: T.REVISION, builds: [], pipelines: [], gpuMs: [], drawCalls: 0, triangles: 0 })
// "top drums: InstancedMesh (MeshStandardNodeMaterial)"; parts are tagged by the createObstacleView wrapper.
const describe = (ro) => {
  let part = 'plane/other'
  for (let o = ro.object; o; o = o.parent) if (o.userData.perfPart) { part = o.userData.perfPart; break }
  const m = ro.material
  return part + ': ' + (ro.object.isInstancedMesh ? 'InstancedMesh' : ro.object.type) + ' (' + m.type + (m.transparent ? ', transparent' : '') + ')'
}
export class WebGPURenderer extends T.WebGPURenderer {
  constructor(parameters) {
    super({ ...parameters, trackTimestamp: true${arg.webgl ? ', forceWebGL: true' : ''} })
    this.perfFrames = 0
  }
  async init() {
    if (this.perfHooked) return super.init()
    this.perfHooked = true
    const t = performance.now()
    await super.init()
    p.initMs = performance.now() - t
    const nodes = this._nodes
    const getForRender = nodes.getForRender.bind(nodes)
    nodes.getForRender = (ro, useAsync) => {
      const size = nodes.nodeBuilderCache.size
      const t = performance.now()
      const result = getForRender(ro, useAsync)
      if (nodes.nodeBuilderCache.size > size) p.builds.push({ at: t, ms: performance.now() - t, what: describe(ro) })
      return result
    }
    const backend = this.backend
    const createRenderPipeline = backend.createRenderPipeline.bind(backend)
    backend.createRenderPipeline = (ro, promises) => {
      p.pipelines.push({ at: performance.now(), what: describe(ro) })
      return createRenderPipeline(ro, promises)
    }
  }
  async compileAsync(scene, camera) {
    const t = performance.now()
    await super.compileAsync(scene, camera)
    p.compileMs = performance.now() - t
    p.compilePipelines = p.pipelines.length
  }
  render(scene, camera) {
    const result = super.render(scene, camera)
    p.drawCalls = Math.max(p.drawCalls, this.info.render.drawCalls)
    p.triangles = Math.max(p.triangles, this.info.render.triangles)
    p.canvas = this.domElement.width + '×' + this.domElement.height
    p.backend = this.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
    if (++this.perfFrames % 8 === 0 && this.backend.isWebGPUBackend) {
      this.resolveTimestampsAsync(T.TimestampQuery.RENDER).then((ms) => ms > 0 && ms < 1000 && p.gpuMs.push(ms), () => {})
    }
    return result
  }
}`,
  '\0perf:views': `
import { createObstacleView as create } from ${j(VIEWS)}
export * from ${j(VIEWS)}
export function createObstacleView(o) {
  const t = performance.now()
  const view = create(o)
  const ms = performance.now() - t
  window.__perf.spawns.push({ at: t, ms, kind: [o.top && 'top ' + o.top, o.bottom && 'bottom ' + o.bottom, o.wind && 'leaves'].filter(Boolean).join(' + ') })
  for (const [part, kind] of [['top', o.top], ['bottom', o.bottom], ['wind', 'leaves']]) {
    const group = view.group.getObjectByName(part)
    if (group) group.userData.perfPart = part === 'wind' ? 'leaves' : part + ' ' + kind
  }
  const update = view.update
  view.update = (seconds) => {
    const t = performance.now()
    update(seconds)
    window.__perf.updateMs += performance.now() - t
  }
  return view
}`,
  '\0perf:game': `
import { step as original } from ${j(GAME)}
export * from ${j(GAME)}
export function step(game) {
  const t = performance.now()
  const result = original(game)
  window.__perf.physicsMs += performance.now() - t
  return result
}`,
}
const instrument: Plugin = {
  name: 'perf-instrument',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer || importer.startsWith('\0perf:')) return null
    if (source === 'three/webgpu') return '\0perf:three'
    if (!source.startsWith('.')) return null
    const resolved = await this.resolve(source, importer, { skipSelf: true })
    return resolved?.id === VIEWS ? '\0perf:views' : resolved?.id === GAME ? '\0perf:game' : null
  },
  load: (id) => modules[id],
}

const outDir = `${out}dist`
// The deploy build skips the test site (vite.config.ts); this measurement build needs it to have a page to open.
const input = { index: 'index.html', 'vocalis-flyer-interaktiv': 'src/vocalis-flyer-interaktiv.ts' }
await build({ root, logLevel: 'warn', plugins: [instrument], build: { outDir, emptyOutDir: true, minify: false, rolldownOptions: { input } } })
const server = await preview({ root, logLevel: 'warn', build: { outDir } })

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--enable-unsafe-webgpu', ...(arg.swiftshader ? ['--use-webgpu-adapter=swiftshader'] : [])],
})
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: device.scale,
  isMobile: device.mobile,
  hasTouch: device.mobile,
})
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => void errors.push(error.message))
await context.addInitScript((seed: number) => {
  let state = seed >>> 0
  Math.random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const perf: PerfState = (window.__perf = { recording: false, firstFrame: 0, stamps: [], js: [], spawns: [], updateMs: 0, physicsMs: 0 })
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const start = performance.now()
      callback(time)
      if (perf.recording) perf.js.push([start, performance.now() - start])
    })
  const tick = (time: number) => {
    if (perf.recording) perf.stamps.push(time)
    if (!perf.firstFrame && document.querySelector('vocalis-flyer-interaktiv')?.shadowRoot?.querySelector<HTMLElement>('.poster')?.hidden) {
      perf.firstFrame = performance.now()
    }
    raf(tick)
  }
  raf(tick)
}, Number(arg.seed))

const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
await cdp.send('Profiler.enable')
await page.goto(server.resolvedUrls!.local[0])
await page.waitForFunction(() => window.__perf.firstFrame > 0, null, { timeout: 120_000 })
const startup = await page.evaluate(async () => {
  const adapter = await navigator.gpu?.requestAdapter()
  const three = window.__perf.three
  return {
    firstFrameMs: window.__perf.firstFrame,
    initMs: three?.initMs,
    compileMs: three?.compileMs,
    compilePipelines: three?.compilePipelines,
    gpu: adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : 'no WebGPU adapter',
  }
})

const state = () => page.evaluate(() => document.querySelector('vocalis-flyer-interaktiv')?.getAttribute('state'))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function measure(phase: string, act: () => Promise<void>) {
  await cdp.send('Profiler.start')
  await sleep(500) // starting the profiler stalls the page for a few hundred ms: keep that out of the measurement
  await page.evaluate(() => {
    const p = window.__perf
    Object.assign(p, { recording: true, stamps: [], js: [], spawns: [], updateMs: 0, physicsMs: 0 })
    if (p.three) Object.assign(p.three, { builds: [], pipelines: [], gpuMs: [] })
  })
  await act()
  const { profile } = await cdp.send('Profiler.stop')
  writeFileSync(`${out}${name}-${phase}.cpuprofile`, JSON.stringify(profile))
  const run = await page.evaluate((): Run => {
    const p = window.__perf
    p.recording = false
    return { stamps: p.stamps, js: p.js, spawns: p.spawns, updateMs: p.updateMs, physicsMs: p.physicsMs, three: p.three }
  })
  return { ...run, profile: hotFunctions(profile) }
}

const fold = await measure('fold', async () => {
  await page.mouse.click(width / 2, height / 2)
  await page.waitForFunction(() => document.querySelector('vocalis-flyer-interaktiv')?.getAttribute('state') === 'ready', null, { timeout: 60_000 })
  await sleep(300)
})
let crashes = 0
const play = await measure('play', async () => {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    if ((await state()) === 'over') {
      crashes++
      await sleep(600) // the game ignores retries for 500 ms
      await page.mouse.click(width / 2, height / 2)
    }
    await page.mouse.down()
    await page.mouse.up()
    await sleep(350)
  }
})
await browser.close()
await server.close()

// Analysis
function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
function round(value: number | undefined, digits = 1): number {
  return +(value ?? 0).toFixed(digits)
}
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}
function counts(items: string[]): string[] {
  const tally = new Map<string, number>()
  for (const item of items) tally.set(item, (tally.get(item) ?? 0) + 1)
  return [...tally].sort((a, b) => b[1] - a[1]).map(([item, n]) => `${n}× ${item}`)
}
// Ranking weight: visible stutters first, then how long they were in total.
function jank(frames: Frame[]): number {
  return frames.length * 1000 + round(sum(frames.map((f) => f.ms - FRAME)), 0)
}
function worst(frames: Frame[]): number {
  return Math.max(0, ...frames.map((f) => f.ms))
}

function hotFunctions(profile: CpuProfile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map<string, number>()
  let busy = 0
  let gc = 0
  ;(profile.samples ?? []).forEach((id, i) => {
    const ms = (profile.timeDeltas?.[i] ?? 0) / 1000
    const { functionName, url, lineNumber } = nodes.get(id)!.callFrame
    if (functionName === '(idle)') return
    busy += ms
    if (functionName === '(garbage collector)') gc += ms
    if (functionName.startsWith('(')) return
    const key = `${functionName || '(anonymous)'} (${url.split('/').pop()}:${lineNumber + 1})`
    self.set(key, (self.get(key) ?? 0) + ms)
  })
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 6)
  return { busyMs: round(busy, 0), gcPercent: round((gc / busy) * 100), top: top.map(([key, ms]) => `${key} ${round(ms, 0)} ms`) }
}

// Frame stats, and a cause for every long frame: a shader compile (pipeline or node build during it or up to 250 ms
// before, as the GPU process compiles asynchronously), a slow obstacle spawn, other script, or nothing on the main
// thread (GPU/compositor).
function analyze(run: Run) {
  const frames: Frame[] = run.stamps.slice(1).map((t, i) => ({ start: run.stamps[i], ms: round(t - run.stamps[i]) }))
  const ms = frames.map((f) => f.ms)
  const js = run.js.map(([, d]) => d)
  const compiles = [...(run.three?.pipelines ?? []), ...(run.three?.builds ?? [])]
  const causes: Record<Cause, Frame[]> = { compile: [], spawn: [], script: [], idle: [] }
  for (const f of frames.filter((f) => f.ms > LONG)) {
    const within = (t: number, before = 0) => t >= f.start - before && t < f.start + f.ms
    const jsMs = round(sum(run.js.filter(([t]) => within(t)).map(([, d]) => d)))
    const cause: Cause = compiles.some((e) => within(e.at, 250))
      ? 'compile'
      : run.spawns.some((s) => within(s.at) && s.ms > FRAME / 2)
        ? 'spawn'
        : jsMs > FRAME / 2
          ? 'script'
          : 'idle'
    causes[cause].push({ ...f, jsMs })
  }
  return {
    frames: frames.length,
    fps: round((frames.length / sum(ms)) * 1000),
    p50: percentile(ms, 0.5),
    p95: percentile(ms, 0.95),
    worst: percentile(ms, 1),
    over25: ms.filter((d) => d > LONG).length,
    over50: ms.filter((d) => d > 50).length,
    dropped: Math.round(sum(ms.map((d) => Math.max(0, Math.round(d / FRAME) - 1)))),
    jsMean: round(sum(js) / (js.length || 1), 2),
    jsP95: percentile(js, 0.95),
    causes,
  }
}

const f = analyze(fold)
const p = analyze(play)
const three: Partial<ThreeStats> = play.three ?? {}
const pipelines = three.pipelines ?? []
const builds = three.builds ?? []
const gpu = three.gpuMs ?? []
const problems: { impact: number; text: string }[] = []
const fine: string[] = []
const problem = (impact: number, text: string) => void problems.push({ impact, text })

if (!three.revision) {
  problem(Infinity, 'Instrumentation did not apply (src/scene.ts no longer imports three/webgpu, ./obstacles/index.ts or ./game.ts as before): update scripts/perf.ts.')
}

// 1. Shader compiles during play
if (pipelines.length || builds.length) {
  const instanced = pipelines.filter((x) => x.what.includes('InstancedMesh')).length
  const c = p.causes.compile
  problem(
    jank(c),
    `Shader compiles during play: ${pipelines.length} new GPU pipelines and ${builds.length} node builds ` +
      `(${round(sum(builds.map((b) => b.ms ?? 0)), 0)} ms of main thread, up to ${round(Math.max(0, ...builds.map((b) => b.ms ?? 0)))} ms each) in ${seconds} s; ` +
      `${c.length} of ${p.over25} long frames (worst ${worst(c)} ms) happened during or right after one.\n` +
      `   Pipelines were created for: ${counts(pipelines.map((x) => x.what)).slice(0, 8).join('; ')}.\n` +
      (instanced > pipelines.length / 2
        ? `   Why: each spawned obstacle creates new InstancedMesh objects, and three r${three.revision} keys every InstancedMesh's render object by its uuid ` +
          `(RenderObject.getMaterialCacheKey), so neither the compileAsync warm-up in src/scene.ts nor earlier obstacles are reused (${instanced} of ${pipelines.length} pipelines are InstancedMesh).\n`
        : '') +
      '   Fix: create the obstacle meshes once and reuse them instead of new objects per spawn (e.g. a pool per model: InstancedMesh with ' +
      'spare capacity, rewrite matrices/colours and .count on spawn, hide instead of dispose) in src/scene.ts and src/obstacles/*.',
  )
}

// 2. Slow spawns
const byKind = new Map<string, number[]>()
for (const s of play.spawns) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s.ms])
const kinds = [...byKind].map(([kind, list]) => ({ kind, n: list.length, mean: round(sum(list) / list.length), max: round(Math.max(...list)) }))
const slowKinds = kinds.filter((k) => k.max > FRAME / 2).sort((a, b) => b.max - a.max)
if (slowKinds.length) {
  const slowSpawnIn = (frame: Frame) => play.spawns.some((s) => s.ms > FRAME / 2 && s.at >= frame.start && s.at < frame.start + frame.ms)
  const spawnFrames = Object.values(p.causes).flat().filter(slowSpawnIn).length
  problem(
    jank(p.causes.spawn) + sum(slowKinds.map((k) => k.n * Math.max(0, k.mean - FRAME / 2))),
    'Slow obstacle spawns: building a view blocks the frame it scrolls in. ' +
      slowKinds.slice(0, 5).map((k) => `"${k.kind}" ${k.mean} ms avg / ${k.max} ms max (${k.n}×)`).join('; ') +
      `. ${spawnFrames} of ${p.over25} long frames coincided with a slow spawn.\n` +
      '   Fix: take model generation off the spawn path (precompute geometry variants at start-up, or reuse pooled views); ' +
      'see createObstacleView in src/obstacles/index.ts and the builder of the slowest kind.',
  )
} else if (kinds.length) {
  fine.push(`Obstacle spawns: at most ${Math.max(...kinds.map((k) => k.max))} ms each.`)
}

// 3. Fold
if (f.over25) {
  const causes = Object.entries(f.causes).filter(([, list]) => list.length)
  problem(
    jank(Object.values(f.causes).flat()),
    `Fold stutters: ${f.over25} frames > ${LONG} ms (worst ${f.worst} ms; causes: ${causes.map(([cause, list]) => `${list.length} ${cause}`).join(', ')}). ` +
      `Hottest main-thread functions during the fold: ${fold.profile.top.slice(0, 4).join('; ')}.`,
  )
}

// 4. Script-heavy and idle long frames during play
if (p.causes.script.length) {
  problem(
    jank(p.causes.script),
    `${p.causes.script.length} long frames were spent in script without a compile or spawn (worst ${worst(p.causes.script)} ms). ` +
      `Hottest functions during play: ${play.profile.top.join('; ')}.`,
  )
}
if (p.causes.idle.length) {
  problem(
    jank(p.causes.idle),
    `${p.causes.idle.length} long frames had no main-thread work (worst ${worst(p.causes.idle)} ms): GPU or compositor stalls. ` +
      'If they follow crashes/retries or cluster after compiles, fixing the compiles usually removes them; otherwise check GPU cost below.',
  )
}

// 5. Per-frame costs
const renders = p.frames || 1
const perFrame =
  `main thread per frame ${p.jsMean} ms avg, ${p.jsP95} ms p95 (physics ${round(play.physicsMs / renders, 2)} ms, ` +
  `obstacle updates ${round(play.updateMs / renders, 2)} ms), GC ${play.profile.gcPercent}% of busy time`
if (p.jsP95 > FRAME / 2 || play.profile.gcPercent > 5) {
  problem(p.frames * Math.max(0, p.jsMean - 4), `Steady per-frame cost is high: ${perFrame}. Hottest functions: ${play.profile.top.join('; ')}.`)
} else {
  fine.push(`Steady state: ${perFrame}.`)
}
if (gpu.length) {
  const line = `GPU ${percentile(gpu, 0.5)} ms p50 / ${percentile(gpu, 0.95)} ms p95 per frame on ${startup.gpu} at ${three.canvas} px, up to ${three.drawCalls} draw calls and ${three.triangles} triangles`
  if (percentile(gpu, 0.95) > 4) {
    problem(
      0,
      `GPU cost may be too high for phones: ${line}; phone GPUs are several times slower. Options: cap the pixel ratio lower ` +
        '(renderer.setPixelRatio in src/scene.ts), simplify the fire shader (src/obstacles/fire.ts), fewer transparent beam cones (src/obstacles/lights.ts).',
    )
  } else {
    fine.push(`${line} (phone GPUs are several times slower).`)
  }
}

// 6. Start-up
const startLine =
  `first 3D frame after ${round(startup.firstFrameMs, 0)} ms (renderer.init ${round(startup.initMs, 0)} ms, ` +
  `compileAsync ${round(startup.compileMs, 0)} ms for ${startup.compilePipelines} pipelines)`
if (startup.firstFrameMs > 2500) problem(0, `Slow start-up: ${startLine}. The flyer image shows meanwhile, but the fold can't start.`)
else fine.push(`Start-up: ${startLine}. A cold GPU shader cache (first visit) can add several seconds.`)
if (errors.length) problem(Infinity, `Page errors: ${[...new Set(errors)].join('; ')}`)

problems.sort((a, b) => b.impact - a.impact)
const report = [
  `Performance insights: ${arg.device} ${width}×${height} @${device.scale}x, CPU ${cpu}× throttled, ${three.backend ?? '?'} on ${startup.gpu}, ` +
    `${seconds} s of play (seed ${arg.seed}, ${crashes} crashes)`,
  `Play: ${p.fps} fps, p95 ${p.p95} ms, ${p.over25} frames > ${LONG} ms (${p.over50} > 50 ms, worst ${p.worst} ms), ~${p.dropped} dropped frames`,
  `Fold: ${f.fps} fps, ${f.over25} frames > ${LONG} ms (worst ${f.worst} ms)`,
  '',
  problems.length ? 'Problems, biggest impact first:' : 'No problems found.',
  ...problems.map((x, i) => `${i + 1}. ${x.text}`),
  '',
  'Looks fine:',
  ...fine.map((x) => `- ${x}`),
  '',
  `Raw data: ${out}${name}.json; CPU profiles: ${out}${name}-fold.cpuprofile, ${out}${name}-play.cpuprofile (DevTools › Performance › Load profile)`,
].join('\n')
const data = { startup, fold: { ...f, profile: fold.profile }, play: { ...p, crashes, profile: play.profile, spawns: kinds, pipelines, builds, gpuMs: gpu } }
writeFileSync(`${out}${name}.json`, JSON.stringify(data, null, 2))
console.log(report)
