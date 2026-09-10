// Recorded sound effects in src/assets/sfx/, named by event: fold, flap, score, hit, unfold. Missing files stay silent.
import { storage } from './storage.ts'

const sounds = import.meta.glob<string>('./assets/sfx/*.{mp3,ogg,wav,m4a}', { eager: true, query: '?url', import: 'default' })

export function createAudio() {
  let context: AudioContext | undefined
  let muted = storage.get('muted') === '1'
  const buffers = new Map<string, AudioBuffer>()

  return {
    available: Object.keys(sounds).length > 0,
    get muted(): boolean {
      return muted
    },
    toggleMute(): void {
      muted = !muted
      storage.set('muted', muted ? '1' : '0')
    },
    /** Browsers only allow audio after a user gesture, so call this on taps. Loads the samples the first time. */
    unlock(): void {
      if (context) return void context.resume()
      const created = (context = new AudioContext())
      for (const [path, url] of Object.entries(sounds)) {
        const name = path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.'))
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((data) => created.decodeAudioData(data))
          .then((buffer) => buffers.set(name, buffer))
          .catch((error: unknown) => console.warn(`[vocalis-flyer-interaktiv] sound "${name}" failed`, error))
      }
    },
    play(name: string): void {
      const buffer = buffers.get(name)
      if (!context || muted || !buffer) return
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start()
    },
    dispose(): void {
      void context?.close()
    },
  }
}
