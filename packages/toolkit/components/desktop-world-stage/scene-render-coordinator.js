import {
  deriveOrthoCamera,
  derivePerspectiveResourceCamera,
} from '../../scene/index.js'

function perspectiveConfigurationError() {
  const error = new Error(
    'Perspective resource pass is incompatible with the active DesktopWorld topology or camera profile.',
  )
  error.code = 'SCENE_RENDER_PASS_CONFIGURATION_FAILED'
  return error
}

function sortedPerspectiveResources(resources) {
  return [...resources.values()]
    .filter((mounted) => mounted.renderPass.kind === 'perspective_resource' && !mounted.suspended)
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function createDesktopWorldSceneRenderCoordinator({ THREE, renderer } = {}) {
  if (!THREE?.Scene || !THREE?.OrthographicCamera || !THREE?.PerspectiveCamera || !renderer) {
    throw new TypeError('DesktopWorld scene render coordinator dependencies are invalid.')
  }
  const overlayScene = new THREE.Scene()
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000)
  overlayCamera.position.set(0, 0, 7)
  overlayScene.add(new THREE.AmbientLight(0xffffff, 1.8))
  const overlayKeyLight = new THREE.DirectionalLight(0xd8ccff, 3)
  overlayKeyLight.position.set(3, 4, 5)
  overlayScene.add(overlayKeyLight)
  renderer.autoClear = false
  if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace
  }
  if (renderer.info) renderer.info.autoReset = false
  let segment = null
  let topology = []

  const configurePerspective = (mounted) => {
    const projection = derivePerspectiveResourceCamera(topology, segment, mounted.renderPass.camera)
    if (!projection || !mounted.rendering?.camera) return false
    const camera = mounted.rendering.camera
    camera.fov = projection.fovYDegrees
    camera.aspect = projection.aspect
    camera.near = projection.near
    camera.far = projection.far
    camera.position.set(...projection.position)
    camera.up.set(...projection.up)
    camera.lookAt(...projection.target)
    camera.setViewOffset(
      projection.viewOffset.fullWidth,
      projection.viewOffset.fullHeight,
      projection.viewOffset.offsetX,
      projection.viewOffset.offsetY,
      projection.viewOffset.width,
      projection.viewOffset.height,
    )
    camera.updateProjectionMatrix()
    mounted.rendering.cameraProjection = projection
    return true
  }

  return Object.freeze({
    attach(mounted) {
      if (mounted.rendering) throw new TypeError('Scene resource is already attached to a render pass.')
      if (mounted.renderPass.kind === 'perspective_resource') {
        const scene = new THREE.Scene()
        scene.add(mounted.projection.object)
        mounted.rendering = {
          camera: new THREE.PerspectiveCamera(),
          cameraProjection: null,
          scene,
        }
        if (!configurePerspective(mounted)) {
          scene.remove(mounted.projection.object)
          mounted.rendering = null
          throw perspectiveConfigurationError()
        }
      } else {
        overlayScene.add(mounted.projection.object)
        mounted.rendering = {
          camera: overlayCamera,
          cameraProjection: null,
          scene: overlayScene,
        }
      }
      if (mounted.projection.overlayObject) overlayScene.add(mounted.projection.overlayObject)
      return true
    },
    detach(mounted) {
      const rendering = mounted.rendering
      if (!rendering) return true
      if (mounted.projection.overlayObject) overlayScene.remove(mounted.projection.overlayObject)
      rendering.scene.remove(mounted.projection.object)
      mounted.rendering = null
      return true
    },
    overlayScene,
    render(resources) {
      renderer.info?.reset?.()
      renderer.clear(true, true, true)
      for (const mounted of sortedPerspectiveResources(resources)) {
        if (!mounted.rendering?.camera) continue
        renderer.clearDepth?.()
        renderer.render(mounted.rendering.scene, mounted.rendering.camera)
      }
      renderer.clearDepth?.()
      renderer.render(overlayScene, overlayCamera)
      return true
    },
    updateSegment(nextSegment, nextTopology = []) {
      const projection = deriveOrthoCamera(nextSegment)
      if (!projection.width || !projection.height || !Array.isArray(nextTopology) || nextTopology.length === 0) {
        return false
      }
      segment = nextSegment
      topology = [...nextTopology]
      overlayCamera.left = projection.left
      overlayCamera.right = projection.right
      overlayCamera.top = projection.top
      overlayCamera.bottom = projection.bottom
      overlayCamera.near = projection.near
      overlayCamera.far = projection.far
      overlayCamera.updateProjectionMatrix()
      return true
    },
    refresh(resources) {
      let complete = true
      for (const mounted of resources.values()) {
        if (mounted.renderPass.kind === 'perspective_resource') {
          complete = configurePerspective(mounted) && complete
        }
      }
      return complete
    },
    snapshot(resources) {
      return {
        orthographicResources: [...resources.values()]
          .filter((mounted) => mounted.renderPass.kind === 'orthographic_overlay').length,
        perspectiveResources: [...resources.values()]
          .filter((mounted) => mounted.renderPass.kind === 'perspective_resource').length,
      }
    },
  })
}
