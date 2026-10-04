// Dev server only (`pnpm dev` → /preview.html): the flyer artwork on the folded plane, to turn and inspect.
// Never built: vite.config.ts only builds the embed. Update the artwork with `pnpm run flyer`.
import GUI from 'lil-gui'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import { createPaper } from './fold.ts'

const [frontUrl] = Object.values(import.meta.glob<string>('./assets/flyer-front.*', { eager: true, query: '?url', import: 'default' }))
const [backUrl] = Object.values(import.meta.glob<string>('./assets/flyer-back.*', { eager: true, query: '?url', import: 'default' }))

const renderer = new THREE.WebGPURenderer({ antialias: true })
await renderer.init()
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setClearColor(0xd9dde2)
document.body.append(renderer.domElement)

const load = async (url: string | undefined, mirror = false) => {
  if (!url) return null
  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (mirror) {
    // The back is seen from behind: without this the artwork would read mirrored.
    texture.wrapS = THREE.RepeatWrapping
    texture.repeat.x = -1
  }
  return texture
}
const [front, back] = await Promise.all([load(frontUrl), load(backUrl, true)])

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, 1, 10, 5000)
camera.position.set(-300, 220, 420)
const sun = new THREE.DirectionalLight(0xffffff, 1.6)
sun.position.set(2, 5, 10)
scene.add(new THREE.HemisphereLight(0xffffff, 0x999999, 1.6), sun)

const paper = createPaper()
const positions = new THREE.BufferAttribute(paper.positions, 3)
const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', positions)
geometry.setAttribute('uv', new THREE.BufferAttribute(paper.uvs, 2))
// Mirrored in z and turned over, like in scene.ts: the sheet folds on its back, the front ends up outside.
const sheet = new THREE.Group()
sheet.scale.z = -1
sheet.rotation.y = Math.PI
const materials = [
  new THREE.MeshStandardMaterial({ map: front, color: front ? 0xffffff : 0xf3f0e8, roughness: 0.9, side: THREE.BackSide }),
  new THREE.MeshStandardMaterial({ map: back, color: back ? 0xffffff : 0xf3f0e8, roughness: 0.9 }),
]
for (const material of materials) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  sheet.add(mesh)
}
// Nose towards the camera, wings level, keel down: the fold leaves the plane standing on its tail.
const plane = new THREE.Group()
plane.rotation.x = Math.PI / 2
plane.add(sheet)
scene.add(plane)

const settings = { fold: 1 }
function fold(): void {
  paper.foldAt(settings.fold)
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  const centre = geometry.boundingBox!.getCenter(new THREE.Vector3())
  sheet.position.set(centre.x, -centre.y, -centre.z) // orbit around the middle (x and z flipped by the mirror and turn)
}
fold()
new GUI({ title: 'Flyer' }).add(settings, 'fold', 0, 1, 0.001).name('Falten').onChange(fold)

// New export (vite.config.ts sends this): swap the artwork in place, keeping the view and the fold.
import.meta.hot?.on('flyer', async () => {
  const fresh = await Promise.all([frontUrl, backUrl].map((url, i) => load(url && `${url}?t=${Date.now()}`, i === 1)))
  materials.forEach((material, i) => {
    if (!fresh[i]) return
    material.map?.dispose()
    material.map = fresh[i]
  })
})

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

function resize(): void {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

void renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})
