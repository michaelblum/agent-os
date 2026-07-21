export class SceneExtensionStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SceneExtensionStoreError'
    this.code = code
  }
}

export function failSceneExtension(code, message) {
  throw new SceneExtensionStoreError(code, message)
}
