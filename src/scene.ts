import * as THREE from 'three/webgpu'
import { createPaper, SHEET_H, SHEET_W } from './fold.ts'
import { createGame, DT, flap, type Obstacle, pitch, resize, step, WORLD_H } from './game.ts'
import { createObstacleView, type ObstacleView } from './obstacles.ts'

type State = 'flyer' | 'folding' | 'ready' | 'play' | 'over' | 'unfolding'

// Named by event: fold, flap, score, hit, unfold. Missing files simply stay silent.
const sounds = import.meta.glob<string>('./assets/sfx/*.{mp3,ogg,wav,m4a}', { eager: true, query: '?url', import: 'default' })
const backUrl = Object.values(
  import.meta.glob<string>('./assets/flyer-back.*', { eager: true, query: '?url', import: 'default' }),
)[0]

const FOLD_SECONDS = 1.5
const FLIGHT_SECONDS = 0.8 // folded sheet → plane at its start position
const FLIGHT_ARC = 0.6 // world units the plane rises mid-flight
const ENTER_SECONDS = 0.6 // obstacles sliding in after a retry (otherwise they follow the flight)
const STAGGER = 0.4 // obstacles further right arrive later, as a wave
const LEAN = 0.35 // radians the sheet leans back while folding, so the folds read in depth
const PLANE_SCALE = 0.005 // mm → world units, the plane ends up ~1 unit long
const PLANE_TILT = 0.8 // roll towards the camera so the wings read from the side
const FOV = 30
const RETRY_DELAY = 500 // ms, so frantic tapping right after a crash doesn't restart

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)
const bob = (now: number) => Math.sin(now / 400) * 0.15

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`vocalis-flyer-interaktiv:${key}`)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`vocalis-flyer-interaktiv:${key}`, value)
    } catch {
      // storage blocked: the best score just isn't remembered
    }
  },
}

/** Mounts the 3D flyer into the element's shadow root. Resolves to a dispose function. */
export async function start(host: HTMLElement, root: ShadowRoot, frontUrl: string): Promise<() => void> {
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!

  const renderer = new THREE.WebGPURenderer({ canvas: $<HTMLCanvasElement>('canvas'), antialias: true, alpha: true })
  await renderer.init()
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  console.info(`[vocalis-flyer-interaktiv] rendering with ${'isWebGLBackend' in renderer.backend ? 'WebGL 2' : 'WebGPU'}`)

  const loader = new THREE.TextureLoader()
  const load = async (url: string) => {
    const texture = await loader.loadAsync(url)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
  }
  const front = await load(frontUrl)
  const back = backUrl ? await load(backUrl) : null

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 60)
  camera.position.z = WORLD_H / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) // WORLD_H visible at z = 0
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(2, 5, 10)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x999999, 1.6), sun)

  // Paper
  const paper = createPaper()
  const positions = new THREE.BufferAttribute(paper.positions, 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', positions)
  geometry.setAttribute('uv', new THREE.BufferAttribute(paper.uvs, 2))
  const sheet = new THREE.Group()
  for (const material of [
    new THREE.MeshStandardMaterial({ map: front, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: back, color: back ? 0xffffff : 0xf3f0e8, roughness: 0.9, side: THREE.BackSide }),
  ]) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    sheet.add(mesh)
  }
  const plane = new THREE.Group()
  plane.add(sheet)
  scene.add(plane)

  // The plane group turns around the folded plane's centre, so the flight follows a clean path.
  paper.foldAt(1)
  geometry.computeBoundingBox()
  const planeCentre = geometry.boundingBox!.getCenter(new THREE.Vector3())
  sheet.position.copy(planeCentre).negate()
  const flyerOffset = planeCentre.clone().sub(new THREE.Vector3(SHEET_W / 2, SHEET_H / 2, 0)) // keeps the sheet centred
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const xAxis = new THREE.Vector3(1, 0, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)

  // Obstacles: one view per obstacle, created when it spawns and disposed when it's gone.
  const views = new Map<Obstacle, ObstacleView>()
  // Compile every obstacle's shaders up front, so the first fire doesn't stutter mid-flight.
  const samples = (['drums', 'matterhorn', 'fire'] as const).map((bottom, i): Obstacle => {
    return { x: (i - 1) * 3, gapY: 0, top: 'drums', bottom, wind: true, seed: 0.5, passed: false }
  })
  const warmups = samples.map((sample) => {
    const view = createObstacleView(sample)
    view.group.position.x = sample.x
    scene.add(view.group)
    return view
  })
  await renderer.compileAsync(scene, camera)
  for (const view of warmups) {
    scene.remove(view.group)
    view.dispose()
  }

  // State
  let state: State = 'flyer'
  let worldW = WORLD_H
  let flyerScale = 1
  let game = createGame(worldW)
  let t = 0 // seconds into fold + flight: 0 = flat flyer, FOLD_SECONDS + FLIGHT_SECONDS = plane at start position
  let shownFold = -1
  let acc = 0
  let last = performance.now()
  let diedAt = 0
  let gameStartedAt = 0
  let best = Number(storage.get('best')) || 0
  let dirty = true // the static flyer only re-renders when something changed
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const scoreText = $('.score')
  const poster = $<HTMLImageElement>('.poster')
  const setState = (next: State) => {
    state = next
    host.setAttribute('state', next)
  }

  // Audio
  let audio: AudioContext | undefined
  let muted = storage.get('muted') === '1'
  const buffers = new Map<string, AudioBuffer>()
  const muteButton = $<HTMLButtonElement>('.mute')
  const renderMute = () => {
    muteButton.textContent = muted ? 'Ton an' : 'Ton aus'
    muteButton.setAttribute('aria-pressed', String(muted))
  }
  muteButton.hidden = Object.keys(sounds).length === 0
  renderMute()

  // Browsers only allow audio after a user gesture, so this runs on the first tap.
  function unlockAudio(): void {
    if (audio) return void audio.resume()
    const context = (audio = new AudioContext())
    for (const [path, url] of Object.entries(sounds)) {
      const name = path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.'))
      fetch(url)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch((error: unknown) => console.warn(`[vocalis-flyer-interaktiv] sound "${name}" failed`, error))
    }
  }

  function play(name: string): void {
    const buffer = buffers.get(name)
    if (!audio || muted || !buffer) return
    const source = audio.createBufferSource()
    source.buffer = buffer
    source.connect(audio.destination)
    source.start()
  }

  // Actions
  function newGame(): void {
    game = createGame(worldW)
    gameStartedAt = performance.now()
    acc = 0
    scoreText.textContent = '0'
  }

  function fold(): void {
    unlockAudio()
    play('fold')
    newGame() // before the flight, so the plane flies to where the new game starts
    setState('folding')
  }

  function tap(): void {
    unlockAudio()
    if (state === 'ready') setState('play')
    if (state === 'play' && flap(game)) play('flap')
  }

  function retry(): void {
    if (performance.now() - diedAt < RETRY_DELAY) return
    newGame()
    setState('ready')
  }

  function gameOver(): void {
    diedAt = performance.now()
    best = Math.max(best, game.score)
    storage.set('best', String(best))
    $('.over-score').textContent = String(game.score)
    $('.over-best').textContent = String(best)
    play('hit')
    setState('over')
  }

  // Input. Flyer and game-over react to click, so scrolling past on touch never triggers anything;
  // flying reacts to pointerdown for responsiveness.
  const abort = new AbortController()
  const { signal } = abort
  host.addEventListener(
    'click',
    () => {
      if (state === 'flyer') fold()
      else if (state === 'over') retry()
    },
    { signal },
  )
  host.addEventListener('pointerdown', (event) => event.button === 0 && tap(), { signal })
  host.addEventListener(
    'keydown',
    (event) => {
      if (event.repeat || !['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(event.code)) return
      if (event.composedPath()[0] instanceof HTMLButtonElement) return
      event.preventDefault()
      if (state === 'flyer') fold()
      else if (state === 'over') retry()
      else tap()
    },
    { signal },
  )
  const backButton = $<HTMLButtonElement>('.back')
  for (const button of [backButton, muteButton]) {
    for (const type of ['pointerdown', 'click']) button.addEventListener(type, (event) => event.stopPropagation(), { signal })
  }
  backButton.addEventListener(
    'click',
    () => {
      play('unfold')
      setState('unfolding')
    },
    { signal },
  )
  muteButton.addEventListener(
    'click',
    () => {
      muted = !muted
      storage.set('muted', muted ? '1' : '0')
      renderMute()
    },
    { signal },
  )

  // Loop
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    if (state === 'folding' || state === 'unfolding') {
      const end = FOLD_SECONDS + FLIGHT_SECONDS
      const speed = reducedMotion ? 50 : 1
      t = Math.min(Math.max(t + (state === 'folding' ? dt : -dt) * speed, 0), end)
      if (state === 'folding') game.y = bob(now)
      if (t === end) setState('ready')
      else if (t === 0) setState('flyer')
    } else if (state === 'ready') {
      game.y = bob(now)
    } else if (state === 'play' || state === 'over') {
      for (acc += dt; acc >= DT; acc -= DT) {
        const { scored, hit } = step(game)
        if (scored) {
          scoreText.textContent = String(game.score)
          play('score')
        }
        if (hit) gameOver()
      }
    } else if (!dirty) {
      return
    }
    dirty = false
    draw(now)
  }

  function draw(now: number): void {
    const folded = Math.min(t / FOLD_SECONDS, 1)
    if (folded !== shownFold) {
      shownFold = folded
      paper.foldAt(folded)
      positions.needsUpdate = true
      geometry.computeVertexNormals()
    }

    // Flight: from the centred flyer to the game position in a small arc, shrinking, turning nose-right
    // and rolling the wings up. At f = 0 this is exactly the flyer pose, at f = 1 exactly the game pose.
    const f = smooth(clamp01((t - FOLD_SECONDS) / FLIGHT_SECONDS))
    from.copy(flyerOffset).multiplyScalar(flyerScale)
    plane.position.lerpVectors(from, to.set(game.planeX, game.y, 0), f)
    plane.position.y += Math.sin(Math.PI * f) * FLIGHT_ARC
    plane.scale.setScalar(THREE.MathUtils.lerp(flyerScale, PLANE_SCALE, f))
    plane.quaternion
      .setFromAxisAngle(zAxis, pitch(game) * f)
      .multiply(turn.setFromAxisAngle(xAxis, (Math.PI / 2 + PLANE_TILT) * f))
      .multiply(turn.setFromAxisAngle(zAxis, (-Math.PI / 2) * f))
      .multiply(turn.setFromAxisAngle(xAxis, -LEAN * Math.sin(Math.PI * folded)))

    // Obstacles slide in with the flight (top ones from above, bottom ones from below) and back out when
    // unfolding. After a retry the new ones slide in on their own timer.
    const appear = Math.min(f, clamp01((now - gameStartedAt) / (ENTER_SECONDS * 1000)))
    const current = new Set(game.obstacles)
    for (const [o, view] of views) {
      if (current.has(o)) continue
      scene.remove(view.group)
      view.dispose()
      views.delete(o)
    }
    for (const o of game.obstacles) {
      let view = views.get(o)
      if (!view) {
        view = createObstacleView(o)
        views.set(o, view)
        scene.add(view.group)
      }
      view.group.position.x = o.x
      view.slide(smooth(clamp01(appear * (1 + STAGGER) - STAGGER * clamp01(o.x / worldW + 0.5))))
      view.update(now / 1000)
    }

    renderer.render(scene, camera)
    poster.hidden = true // only now, so a background tab keeps showing the flyer image until the first frame
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    worldW = WORLD_H * camera.aspect
    flyerScale = 0.85 * Math.min(WORLD_H / SHEET_H, worldW / SHEET_W) // matches the poster's CSS size
    resize(game, worldW)
    dirty = true
  })
  resizeObserver.observe(host)

  // Only animate while on screen and the tab is visible.
  let inView = true
  const run = () => {
    last = performance.now()
    void renderer.setAnimationLoop(inView && !document.hidden ? frame : null)
  }
  const intersection = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting
    run()
  })
  intersection.observe(host)
  document.addEventListener('visibilitychange', run, { signal })
  run()

  return () => {
    abort.abort()
    resizeObserver.disconnect()
    intersection.disconnect()
    void renderer.setAnimationLoop(null)
    renderer.dispose()
    void audio?.close()
  }
}
