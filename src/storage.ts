// localStorage can throw (private mode, blocked storage). Then nothing is remembered, which is fine.
const PREFIX = 'vocalis-flyer-interaktiv:'

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(PREFIX + key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(PREFIX + key, value)
    } catch {
      // not remembered
    }
  },
}
