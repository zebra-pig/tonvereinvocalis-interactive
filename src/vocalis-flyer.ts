export class VocalisFlyer extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; position: relative; overflow: hidden; }
        .sheet {
          position: absolute; inset: 0; margin: auto;
          height: min(80%, calc(80vw * 297 / 210)); aspect-ratio: 210 / 297;
          display: grid; place-items: center;
          background: #fff; box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.15);
          font: 3rem/1 "Bebas Neue", sans-serif;
        }
      </style>
      <div class="sheet" part="sheet">Flyer</div>
    `
  }
}

// Guard: the embed may be included twice, and HMR re-runs this module.
if (!customElements.get('vocalis-flyer')) customElements.define('vocalis-flyer', VocalisFlyer)

declare global {
  interface HTMLElementTagNameMap {
    'vocalis-flyer': VocalisFlyer
  }
}
