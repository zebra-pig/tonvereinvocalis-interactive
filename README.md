# tonvereinvocalis-interactive

`<vocalis-flyer-interaktiv>` — an interactive concert "flyer" for [tonvereinvocalis.ch](https://tonvereinvocalis.ch): an A4 flyer that folds into a paper plane, which you then fly through a Flappy Bird–style obstacle course. Shipped as a web component, embedded in Webstudio, hosted as an assets-only Cloudflare Worker.

> Status: playable. Placeholder flyer, no sounds yet.

## Concept

Every concert page (`/konzerte/elements`, `/konzerte/un-clouded`, `/konzerte/im-bann-der-nacht`) has a unique full-bleed themed hero, the "flyer". The logo and menu sit on top of it. Below it are shared Webstudio blocks: description, "Über den Chor", Konzerte/Adresse, footer. Site typography: **Bebas Neue** (headings), **Be Vietnam Pro** (body).

For the next concert the hero is a game:

1. The **A4 flyer** is shown (static artwork).
2. **Tap** on it, and the sheet **folds** into the [world-record paper plane](https://einfach-basteln.com/weltrekord/) (a Suzanne-style glider).
3. The plane becomes the main character in a Flappy Bird–style game, in the spirit of [aaarafat/JS-Flappy-Bird](https://github.com/aaarafat/JS-Flappy-Bird).
4. **Game over**: tap to retry, or press "Zurück zum Flyer" to unfold back to the A4 flyer.

Obstacles are objects related to the concert program (TBD).

**Only the game lives in this repo.** Everything else on the page (text, dates, address, background) is built in Webstudio.

## Architecture decisions

| Topic | Decision | Why |
|---|---|---|
| Packaging | Native Custom Element `<vocalis-flyer-interaktiv>` with shadow DOM | Works in any site via one `<script>` tag. Styles are isolated. |
| UI framework | **No Svelte** | The HTML UI is only a hint, a score, a game-over panel and two buttons. Three.js does the real work. |
| Rendering | `three` via `three/webgpu` (`WebGPURenderer`) | WebGPU, with automatic WebGL2 fallback |
| Background | Transparent canvas | Each concert page's Webstudio background shows through |
| First paint | Front artwork is shown as `<img>` right away. The Three.js scene is lazy-loaded with `import()`. | Fast hero. The `<img>` stays as the fallback if the renderer can't start. |
| Artwork | Our own. No original Flappy Bird sprites. | The reference repo has no license, and its sprites are copyrighted |
| High score | `localStorage` (wrapped in try/catch) | Keeps the Worker assets-only |
| Language | German in-game text | Matches the site |
| Language | TypeScript, `strict: true` | Vite only strips types and never type-checks, so `pnpm run build` runs `tsc --noEmit` first. A type error fails the build, and with it the Cloudflare deploy. |
| Dev / build | Vite | Dev server + multi-entry build |
| Hosting | Cloudflare Worker, static assets only, git-connected Workers Builds | Builds run on Cloudflare |

## Planned file layout

```
package.json          scripts: dev, typecheck, build, preview, deploy
                      deps: three · devDeps: typescript, @types/three, vite, wrangler
tsconfig.json         strict, noEmit, allowImportingTsExtensions, erasableSyntaxOnly,
                      moduleResolution bundler, types: ["vite/client"]
vite.config.ts        inputs: index.html (preview site) + src/vocalis-flyer-interaktiv.ts (embed entry)
                      output entry name stable (vocalis-flyer-interaktiv.js); chunks/assets hashed under assets/
wrangler.jsonc        assets.directory ./dist, preview_urls true, no `main` (assets only)
.node-version         24
public/_headers       CORS + cache headers (see Deployment)
index.html            preview site mimicking a /konzerte/* page (overlaid header, hero, text blocks)
src/vocalis-flyer-interaktiv.ts  Custom Element: shadow DOM, <img> poster, overlay UI, lazy import('./scene.ts')
src/scene.ts          renderer, camera, paper plane, state machine, input, render loop
src/audio.ts          sound effects (Web Audio) and mute
src/debug.ts          dev server only: lil-gui "Debug" pane (top right), e.g. "Show hitboxes"; never in builds
src/storage.ts        localStorage wrapper (best score, mute)
src/fold.ts           origami data + foldAt(t)
src/game.ts           pure game logic (no Three.js): physics, spawning, hitboxes, wind, scoring
src/obstacles/        one file per obstacle kind: drums, matterhorn, fire, wind, lights, controllers, phones, tires;
                      index.ts builds the view for an obstacle, geometry.ts holds shared model helpers
src/**/*.test.ts      Vitest tests next to the code they cover (`pnpm test`)
src/assets/           flyer-front.*, flyer-back.* (optional), sfx/*
scripts/perf.ts       `pnpm run perf [--device phone|desktop] [--cpu 4] [--seconds 30]`: plays the game in headless
                      Chrome on an instrumented production build and prints ranked, actionable performance insights
```

## Component behaviour

- **States:** `flyer → folding → ready → play → over`
  - From `over`: tap retries (→ `ready`).
  - "Zurück zum Flyer" runs the fold in reverse (→ `flyer`).
- **Sizing:** the host is `display:block`, and Webstudio sets its size. A `ResizeObserver` updates the renderer, with device pixel ratio capped at 2.
  - The game world has a fixed height; its visible width follows the aspect ratio, so wide screens see further ahead.
  - The A4 sheet is fitted into the box with padding.
- **Input:**
  - In `flyer` state: `click`, not pointerdown, so scrolling past on touch never triggers a fold. `touch-action: pan-y`.
  - In `ready`/`play`: `pointerdown`, plus Space, ArrowUp or W while the element has focus. `touch-action: none`.
- **Pausing:** the render loop stops when the element is off-screen (`IntersectionObserver`) or the tab is hidden.
- **Game logic:** ports the reference physics, scaled to world units.
  - Reference values: gravity 0.125, thrust 3.6, scroll speed 2, gap 85 on a 288×512 canvas at 50 Hz.
  - Runs a fixed 50 Hz step with an accumulator, so speed doesn't depend on screen refresh rate.
  - Plane pitch follows vertical speed.
  - Collision: circle vs. obstacle boxes. Score goes up once per passed obstacle.
- **Obstacles:** stylized low-poly models built in code (`src/obstacles.ts`), no model files. Hitboxes in `game.ts` use the same numbers, and `obstacles.test.ts` checks that every model stays inside its hitbox.
  - **Top:** Basler Trommeln hanging on straps, each strap looped around the drum above and clipped to the hoop of the one below. Drums vary in shell finish, emblem, hoop pattern, size and tilt, all from one instanced geometry with palette lookups (4 draw calls per column); stage lights on a truss drop (PAR cans and a moving head that pans and tilts; soft beams are decorative, not part of the hitbox); or game controllers from different eras dangling from their cables.
  - **Bottom:** stacked Trommeln; the Matterhorn (triangular hitbox along its slopes); a plain fire column with a realistic but slightly stylised TSL shader (turbulent fractal noise, soft colour bands, crisp outline, glow blending that stays luminous on a light page) and rising embers; a pile of phones from brick phone to smartphone; or stacked car tyres.
  - **Wind:** autumn leaves blow up through an updraft that lifts the plane. It only appears where nothing rises from below: as a free column (being blown off the top ends the flight) or under a hanging part.
  - They slide in with the plane's flight into position: top parts from above, bottom parts from below, left to right as a wave. They slide back out when unfolding, and new ones slide in after a retry.
- **Overlay UI** (HTML in shadow DOM):
  - "Tippen zum Falten" hint
  - score at top centre (the site logo sits top-left and the menu top-right)
  - game-over panel with score and best
  - mute button and "Zurück zum Flyer" as real `<button>`s with German `aria-label`s
- **Audio:** recorded samples in `src/assets/sfx/`, named by event: `fold`, `flap`, `score`, `hit`, `unfold`.
  - Found with `import.meta.glob`, so missing files are simply silent.
  - Web Audio `AudioContext` is started on the first user gesture (the fold tap).
  - Mute state is saved in `localStorage`.
- **Accessibility:** `prefers-reduced-motion` makes the fold instant. The canvas has an `aria-label`.
- **Placeholder artwork:** until `flyer-front.*` exists, a generated A4 texture with a "FLYER" title is used.

## Fold (`src/fold.ts`)

- The A4 sheet (210×297) is pre-split into flat polygon faces along every crease. UVs are the flat coordinates, so the flyer artwork stays on the paper through every fold. The back side uses `flyer-back.*` or plain paper.
- Steps follow the [tutorial](https://einfach-basteln.com/weltrekord/), skipping the crease-and-unfold steps:
  1. Side edges to the diagonal creases.
  2. Tip down to the marked line.
  3. Top edges to the centre.
  4. Fold in half.
  5. Wings down.
  6. Wings out flat, which gives the glider shape.
- Each step lists its creases (`a → b`, angle) and a start time. The sheet is split along every crease, and whatever lies left of a crease turns with it.
- Folds overlap slightly and ease in and out, so the motion flows instead of stopping after every fold. Mirrored folds overlap more; the second lands after the first.
- `foldAt(t)` rebuilds every polygon's transform from the flat sheet on each frame, so unfolding is the same function run backwards.
- Stacked layers are ordered only where polygons actually overlap, and each is lifted 0.1 mm. The plane reads as one piece, without z-fighting.
- The final fold state *is* the plane. It then turns nose-right, rolls its wings up and flies in a small arc to its start position, with no mesh swap.

## Deployment (Cloudflare Workers Builds)

Assets-only Worker, deployed from Git. Builds run on Cloudflare.

**Dashboard setup** (Workers & Pages → Create → Import a repository):

| Setting | Value |
|---|---|
| Build command | `pnpm run build` |
| Deploy command | `pnpm exec wrangler deploy` |
| Non-production branch deploy command | `pnpm exec wrangler versions upload` (gives a preview URL per branch) |
| Root directory | `/` |
| Node | 24 (Workers Builds default, pinned via `.node-version`) |

`public/_headers`, which gets copied into `dist/`:

```
/*
  Access-Control-Allow-Origin: *

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/vocalis-flyer-interaktiv.js
  Cache-Control: public, max-age=300
```

CORS is required: the component is loaded as a cross-origin module script, and it then fetches textures, the lazy chunk and audio from the Worker's origin.

Optional later: custom domain (e.g. `interactive.tonvereinvocalis.ch`) if DNS is on Cloudflare.

## Embedding in Webstudio

Add an **HTML Embed**, check **Client Only**, and paste:

```html
<script type="module" src="https://tonvereinvocalis-interactive.<subdomain>.workers.dev/vocalis-flyer-interaktiv.js"></script>
<vocalis-flyer-interaktiv style="display:block;width:100%;height:100svh"></vocalis-flyer-interaktiv>
```

## Development (planned)

```sh
pnpm install
pnpm run dev          # Vite dev server with the preview site (types stripped, not checked)
pnpm run typecheck    # tsc --noEmit (add --watch while developing)
pnpm run build        # tsc --noEmit && vite build → dist/: index.html, vocalis-flyer-interaktiv.js, assets/, _headers
pnpm run preview      # build + wrangler dev (serves dist with _headers like production)
pnpm test             # Vitest: game rules, hitboxes, wind, fold geometry
```

Type errors never reach production: Workers Builds runs `pnpm run build`, which stops at `tsc`.

**Manual checks:**
- Fold, fly, crash, retry and unfold.
- On touch, scrolling past the flyer doesn't fold it.
- Mobile (390×844) and desktop sizes.
- The console shows which backend is active (WebGPU or WebGL2).
- Cross-origin embed: a plain HTML page served from another port loads the script from `wrangler dev` with no CORS errors.

## Open questions

- **Flyer artwork:** front (and optional back) as high-res image files.
- **Sound samples:** recordings for `fold`, `flap`, `score`, `hit`, `unfold`.
- **Custom domain** vs. `workers.dev`.
- **Not planned:** global leaderboard. It would need a Worker script plus KV/D1, so the Worker would no longer be assets-only.
