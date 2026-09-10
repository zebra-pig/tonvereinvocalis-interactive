// Performance check in headless Chrome: startup, fold, then ~30 s of play (auto-flapping, retrying after crashes).
//
//   pnpm perf                                   phone (390×844 @3x, CPU throttled 4×), production build
//   pnpm perf --device desktop                  1440×900 @2x, no throttling
//   pnpm perf --cpu 6 --seconds 60 --profile    heavier throttling, longer run, save a CPU profile of the play phase
//   pnpm perf --url http://localhost:5173/      measure a running server (dev mode is slower than production)
//
// Without --url it builds into node_modules/.perf/dist and serves that with `vite preview`. Math.random is seeded
// (--seed), so runs see the same obstacle sequence. Needs Google Chrome installed (Playwright's `chrome` channel).
// CPU throttling only slows the page's main thread, not the GPU: on real phones GPU cost is several times higher.
// "Compile hitches" are frames > 25 ms during or right after the creation of a shader pipeline (WebGPU) or program
// (WebGL 2); results and profiles land in node_modules/.perf/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

const { values: arg } = parseArgs({
  options: {
    device: { type: 'string', default: 'phone' },
    cpu: { type: 'string' },
    seconds: { type: 'string', default: '30' },
    seed: { type: 'string', default: '7' },
    url: { type: 'string' },
    profile: { type: 'boolean', default: false },
  },
})
const DEVICES = {
  phone: { context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, cpu: 4 },
  desktop: { context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, cpu: 1 },
}
const device = DEVICES[arg.device]
if (!device) throw new Error(`--device must be one of: ${Object.keys(DEVICES).join(', ')}`)
const cpu = Number(arg.cpu ?? device.cpu)
const out = new URL('../node_modules/.perf/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server
let url = arg.url
if (!url) {
  const outDir = `${out}dist`
  await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } })
  server = await preview({ logLevel: 'warn', build: { outDir } })
  url = server.resolvedUrls.local[0]
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu'] })
const context = await browser.newContext(device.context)
const page = await context.newPage()
let backend = '?'
page.on('console', (message) => {
  const match = message.text().match(/rendering with (.+)$/)
  if (match) backend = match[1]
})
await context.addInitScript((seed) => {
  let state = seed >>> 0
  Math.random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const m = (window.__perf = { recording: false, stamps: [], js: [], compiles: [], firstFrame: 0 })
  const raf = window.requestAnimationFrame.bind(window)
  // Time spent in the game's own frame callback.
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const start = performance.now()
      callback(time)
      if (m.recording) m.js.push(performance.now() - start)
    })
  const tick = (time) => {
    if (m.recording) m.stamps.push(time)
    if (!m.firstFrame && document.querySelector('vocalis-flyer-interaktiv')?.shadowRoot?.querySelector('.poster')?.hidden) {
      m.firstFrame = performance.now()
    }
    raf(tick)
  }
  raf(tick)
  const hooks = [
    [window.GPUDevice?.prototype, ['createRenderPipeline', 'createRenderPipelineAsync']],
    [window.WebGL2RenderingContext?.prototype, ['linkProgram']],
  ]
  for (const [proto, names] of hooks) {
    for (const name of names) {
      const original = proto?.[name]
      if (!original) continue
      proto[name] = function (...args) {
        m.compiles.push(performance.now())
        return original.apply(this, args)
      }
    }
  }
}, Number(arg.seed))

const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
await page.goto(url)
await page.waitForFunction(() => window.__perf.firstFrame > 0, null, { timeout: 120_000 })
const startup = await page.evaluate(async () => {
  const adapter = await navigator.gpu?.requestAdapter()
  const chunks = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
  return {
    firstFrameMs: Math.round(window.__perf.firstFrame),
    pipelines: window.__perf.compiles.length,
    scriptKB: Math.round(chunks.reduce((sum, r) => sum + r.transferSize, 0) / 1024),
    gpu: adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : 'no WebGPU adapter',
  }
})

const record = () =>
  page.evaluate(() => {
    Object.assign(window.__perf, { recording: true, stamps: [], js: [], compiles: [] })
  })
const collect = () =>
  page.evaluate(() => {
    const m = window.__perf
    m.recording = false
    return { stamps: m.stamps, js: m.js, compiles: m.compiles }
  })
const state = () => page.evaluate(() => document.querySelector('vocalis-flyer-interaktiv')?.getAttribute('state'))
const { width, height } = device.context.viewport

// Fold: click the flyer, wait until the plane is ready.
await record()
await page.mouse.click(width / 2, height / 2)
await page.waitForFunction(() => document.querySelector('vocalis-flyer-interaktiv')?.getAttribute('state') === 'ready', null, { timeout: 60_000 })
await sleep(300)
const fold = await collect()

// Play: flap every 350 ms, retry after crashes.
await record()
if (arg.profile) {
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
}
let crashes = 0
const end = Date.now() + Number(arg.seconds) * 1000
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
const profilePath = `${out}${arg.device}-cpu${cpu}-play.cpuprofile`
if (arg.profile) writeFileSync(profilePath, JSON.stringify((await cdp.send('Profiler.stop')).profile))
const play = await collect()
await browser.close()
await server?.close()

function summarize({ stamps, js, compiles }) {
  const frames = stamps.slice(1).map((t, i) => t - stamps[i])
  const sorted = [...frames].sort((a, b) => a - b)
  const at = (p) => +(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0).toFixed(1)
  const long = frames.map((ms, i) => ({ start: stamps[i], ms })).filter((f) => f.ms > 25)
  // Pipelines compile in the GPU process, so the stall can show up a few frames after the call.
  const compiling = long.filter((f) => compiles.some((t) => t >= f.start - 250 && t < f.start + f.ms))
  const total = frames.reduce((a, b) => a + b, 0)
  return {
    frames: frames.length,
    fps: +((frames.length / total) * 1000).toFixed(1),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
    droppedFrames: Math.round(frames.reduce((sum, ms) => sum + Math.max(0, Math.round(ms / (1000 / 60)) - 1), 0)),
    over25ms: long.length,
    over50ms: long.filter((f) => f.ms > 50).length,
    compileHitches: compiling.length,
    newPipelines: compiles.length,
    jsMeanMs: +(js.reduce((a, b) => a + b, 0) / (js.length || 1)).toFixed(2),
    jsMaxMs: +Math.max(0, ...js).toFixed(1),
  }
}

const result = {
  url,
  device: arg.device,
  cpuThrottling: cpu,
  seed: Number(arg.seed),
  backend,
  startup,
  fold: summarize(fold),
  play: { seconds: Number(arg.seconds), crashes, ...summarize(play) },
}
const resultPath = `${out}${arg.device}-cpu${cpu}.json`
writeFileSync(resultPath, JSON.stringify(result, null, 2))
if (result.play.frames < Number(arg.seconds) * 10) console.warn('Very few frames recorded: is requestAnimationFrame paused (hidden page)?')
console.log(`${arg.device}, CPU ${cpu}× slower, ${backend} on ${startup.gpu}`)
console.log(`startup  first 3D frame ${startup.firstFrameMs} ms, ${startup.pipelines} pipelines, ${startup.scriptKB} kB of scripts`)
console.table({ fold: result.fold, play: result.play })
console.log(`saved ${resultPath}${arg.profile ? ` and ${profilePath} (open in DevTools › Performance)` : ''}`)
