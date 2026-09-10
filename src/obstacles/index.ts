// One view per obstacle: builds its models and animates them. The hitboxes live in game.ts and use the same numbers.
import * as THREE from 'three/webgpu'
import { drumStack, hangingDrums } from './drums.ts'
import { GAP, type Obstacle, WORLD_H } from '../game.ts'
import { type Disposable, FAR, seeded } from './geometry.ts'
import { controllers } from './controllers.ts'
import { fire } from './fire.ts'
import { stageLights } from './lights.ts'
import { matterhorn } from './matterhorn.ts'
import { phonePile } from './phones.ts'
import { tireStack } from './tires.ts'
import { leafZone } from './wind.ts'

export type ObstacleView = {
  group: THREE.Group
  /** 0 = out of view (top parts above, bottom parts below the screen), 1 = in place. */
  slide(k: number): void
  update(seconds: number): void
  dispose(): void
}

export function createObstacleView(o: Obstacle): ObstacleView {
  const random = seeded(o.seed)
  const group = new THREE.Group()
  const top = new THREE.Group()
  const bottom = new THREE.Group()
  const wind = new THREE.Group()
  top.name = 'top'
  bottom.name = 'bottom'
  wind.name = 'wind'
  group.add(top, bottom, wind)
  const disposables: Disposable[] = []
  const updates: ((seconds: number) => void)[] = []
  const gapTop = o.gapY + GAP / 2
  const gapBottom = o.gapY - GAP / 2

  if (o.top === 'drums') top.add(hangingDrums(gapTop, random, disposables))
  if (o.top === 'lights') {
    const rig = stageLights(gapTop, random, disposables)
    top.add(rig.group)
    updates.push(rig.update)
  }
  if (o.top === 'controllers') {
    const dangling = controllers(gapTop, random, disposables)
    top.add(dangling.group)
    updates.push(dangling.update)
  }
  if (o.bottom === 'drums') bottom.add(drumStack(gapBottom, random, disposables))
  if (o.bottom === 'matterhorn') bottom.add(matterhorn(o, gapBottom))
  if (o.bottom === 'fire') {
    const flames = fire(gapBottom, random, disposables)
    bottom.add(flames.group)
    updates.push(flames.update)
  }
  if (o.bottom === 'phones') bottom.add(phonePile(gapBottom, random, disposables))
  if (o.bottom === 'tires') bottom.add(tireStack(gapBottom, random, disposables))

  if (o.wind) {
    const zone = leafZone(-FAR, o.top ? gapTop : FAR, random) // wind columns never have a bottom part
    wind.add(zone.mesh)
    disposables.push(zone.mesh)
    updates.push(zone.update)
  }

  return {
    group,
    slide(k) {
      top.position.y = (1 - k) * WORLD_H
      bottom.position.y = -(1 - k) * WORLD_H
      wind.position.y = bottom.position.y // leaves blow in from below
      group.visible = k > 0
    },
    update(seconds) {
      for (const update of updates) update(seconds)
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
