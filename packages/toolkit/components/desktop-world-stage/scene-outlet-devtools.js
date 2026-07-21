export function createSceneOutletDevToolsSnapshot(
  resources,
  { stageFault = null, stageSuspended = false } = {},
) {
  const mountedResources = []
  const nodes = []
  const routes = []
  const orderedResources = [...resources.values()]
    .sort((left, right) => left.resource.localeCompare(right.resource))
  for (const mounted of orderedResources) {
    const implementationIds = new Set()
    const resourceById = new Map(mounted.document.resources.map((entry) => [entry.id, entry]))
    for (const descriptor of mounted.document.resources) implementationIds.add(descriptor.implementation)
    for (const object of mounted.document.objects) {
      for (const component of object.components ?? []) implementationIds.add(component.implementation)
      const geometry = object.geometryId ? resourceById.get(object.geometryId) : null
      const material = object.materialId ? resourceById.get(object.materialId) : null
      nodes.push({
        id: object.id,
        implementation: geometry?.implementation ?? material?.implementation ?? null,
        kind: object.kind,
        parentId: object.parentId,
        position: mounted.projection.objectPosition(object.id) ?? object.transform.position,
        resourceId: mounted.resource,
        visible: object.visible !== false && !mounted.suspended && !stageSuspended && !stageFault,
      })
    }
    const visualSnapshot = mounted.interactionVisuals?.snapshot()
    if (visualSnapshot?.route?.objectId) {
      routes.push({
        active: visualSnapshot.route.active,
        destination: visualSnapshot.route.destination,
        kind: visualSnapshot.route.kind,
        origin: visualSnapshot.route.origin,
        progress: visualSnapshot.route.progress,
        resourceId: mounted.resource,
      })
    }
    mountedResources.push({
      allocations: {
        geometries: mounted.document.resources.filter((entry) => entry.kind === 'geometry').length,
        materials: mounted.document.resources.filter((entry) => entry.kind === 'material').length,
        programs: 0,
        textures: mounted.document.resources.filter((entry) => entry.kind === 'texture').length,
      },
      animationCount: mounted.animations.snapshot().bindings.length,
      descriptorCount: mounted.document.resources.length,
      extension: mounted.extensionReference
        ? {
          digest: mounted.extensionReference.digest,
          id: mounted.extensionReference.id,
          ownerId: mounted.extensionReference.ownerId,
        }
        : null,
      id: mounted.resource,
      implementations: [...implementationIds].sort(),
      interactionCount: 0,
      lifecycle: stageFault ? 'faulted' : (mounted.suspended || stageSuspended ? 'suspended' : 'active'),
      objectCount: mounted.document.objects.length,
      owner: mounted.owner,
      revision: mounted.document.revision,
      sceneId: mounted.document.id,
      signalCount: mounted.signals.snapshot().bindings.length,
      suspended: mounted.suspended,
    })
  }
  nodes.sort((left, right) => (
    left.resourceId.localeCompare(right.resourceId) || left.id.localeCompare(right.id)
  ))
  routes.sort((left, right) => left.resourceId.localeCompare(right.resourceId))
  return { nodes, resources: mountedResources, routes }
}
