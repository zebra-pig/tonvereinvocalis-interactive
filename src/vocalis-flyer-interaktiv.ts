const frontUrl = Object.values(
  import.meta.glob<string>('./assets/flyer-front.*', { eager: true, query: '?url', import: 'default' }),
)[0]

const template = `
  <style>
    :host {
      display: block; position: relative; overflow: hidden; container-type: size;
      touch-action: pan-y; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
      cursor: pointer; outline: none;
    }
    :host([state="ready"]), :host([state="play"]) { touch-action: none; }
    :host(:focus-visible) { outline: 2px solid; outline-offset: -2px; }
    [hidden] { display: none !important; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .poster {
      position: absolute; inset: 0; margin: auto; object-fit: cover;
      width: min(85cqw, 85cqh * 210 / 297); height: auto; aspect-ratio: 210 / 297;
    }
    .ui { position: absolute; inset: 0; pointer-events: none; font: 1rem/1.3 "Be Vietnam Pro", system-ui, sans-serif; color: #000; }
    .ui p { margin: 0; }
    .hint, .score, .over, .back { display: none; }
    :host([state="flyer"]) .hint-fold, :host([state="ready"]) .hint-fly, :host([state="play"]) .score,
    :host([state="over"]) .over, :host([state="over"]) .back { display: block; }
    .hint { position: absolute; inset: auto 0 2.5% 0; text-align: center; font: 1.75rem/1 "Bebas Neue", sans-serif; }
    .score {
      position: absolute; inset: 5% 0 auto 0; text-align: center; font: 4rem/1 "Bebas Neue", sans-serif;
      color: #fff; -webkit-text-stroke: 6px #000; paint-order: stroke fill; /* readable on paper and obstacles */
    }
    .over {
      position: absolute; inset: 0; margin: auto; width: fit-content; height: fit-content;
      padding: 1.25rem 2rem; background: #fff; border: 2px solid #000; text-align: center;
    }
    .over .title { font: 2.5rem/1 "Bebas Neue", sans-serif; margin-bottom: 0.5rem; }
    button {
      position: absolute; bottom: 1rem; pointer-events: auto; cursor: pointer;
      padding: 0.5rem 1rem; border: 0; background: #000; color: #fff; font: 1.25rem/1 "Bebas Neue", sans-serif;
    }
    .back { left: 1rem; }
    .mute { right: 1rem; }
  </style>
  <img class="poster" alt="Konzertflyer" />
  <canvas role="img" aria-label="Konzertflyer. Tippen zum Falten, dann tippen zum Fliegen."></canvas>
  <div class="ui">
    <p class="hint hint-fold">Tippen zum Falten</p>
    <p class="hint hint-fly">Tippen zum Fliegen</p>
    <p class="score">0</p>
    <div class="over">
      <p class="title">Abgestürzt</p>
      <p>Punkte <b class="over-score">0</b> · Rekord <b class="over-best">0</b></p>
      <p>Tippen für einen neuen Flug</p>
    </div>
    <button class="back" type="button">Zurück zum Flyer</button>
    <button class="mute" type="button" aria-pressed="false" hidden>Ton aus</button>
  </div>
`

export class VocalisFlyerInteraktiv extends HTMLElement {
  #root = this.attachShadow({ mode: 'open' })
  #dispose: (() => void) | undefined
  #connected = false

  constructor() {
    super()
    this.#root.innerHTML = template
  }

  connectedCallback(): void {
    this.#connected = true
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0
    this.setAttribute('state', 'flyer')
    void this.#start()
  }

  disconnectedCallback(): void {
    this.#connected = false
    this.#dispose?.()
    this.#dispose = undefined
  }

  // Shows the flyer as a plain image right away, then swaps in the lazy-loaded 3D scene.
  async #start(): Promise<void> {
    const poster = this.#root.querySelector<HTMLImageElement>('.poster')!
    const url = frontUrl ?? (await placeholderFlyer())
    poster.src = url
    try {
      const { start } = await import('./scene.ts')
      if (!this.#connected) return
      const dispose = await start(this, this.#root, url)
      if (!this.#connected) return dispose()
      this.#dispose = dispose
    } catch (error) {
      console.warn('[vocalis-flyer-interaktiv] 3D unavailable, showing the static flyer', error)
      this.removeAttribute('state')
    }
  }
}

// Stand-in until src/assets/flyer-front.* exists.
async function placeholderFlyer(): Promise<string> {
  await document.fonts.load('100px "Bebas Neue"').catch(() => [])
  const canvas = document.createElement('canvas')
  canvas.width = 1050
  canvas.height = 1485
  const g = canvas.getContext('2d')!
  g.fillStyle = '#f6f3ec'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#111'
  g.fillRect(0, 0, canvas.width, 260)
  g.textAlign = 'center'
  g.font = '380px "Bebas Neue", sans-serif'
  g.fillText('FLYER', 525, 800)
  g.font = '80px "Bebas Neue", sans-serif'
  g.fillText('TONVEREIN VOCALIS', 525, 930)
  g.font = '36px sans-serif'
  g.fillText('Platzhalter – src/assets/flyer-front.jpg', 525, 1400)
  g.fillStyle = '#f6f3ec'
  g.font = '120px "Bebas Neue", sans-serif'
  g.fillText('KONZERT', 525, 175)
  return canvas.toDataURL('image/jpeg', 0.9)
}

// Guard: the embed may be included twice, and HMR re-runs this module.
if (!customElements.get('vocalis-flyer-interaktiv')) customElements.define('vocalis-flyer-interaktiv', VocalisFlyerInteraktiv)

declare global {
  interface HTMLElementTagNameMap {
    'vocalis-flyer-interaktiv': VocalisFlyerInteraktiv
  }
}
