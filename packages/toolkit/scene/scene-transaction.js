import {
  canonicalizeSceneDocument,
  validateSceneDocument,
  validateSceneLease,
  validateSceneTransaction,
} from './scene-document.js'

const MUTABLE_OBJECT_ROOTS = new Set([
  'components',
  'geometryId',
  'materialId',
  'transform',
  'visible',
])

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]))
}

function failure(code, errors) {
  return { ok: false, code, errors }
}

function semanticError(code, path, message) {
  return failure(code, [{ code, path, message }])
}

function replaceById(items, next) {
  const index = items.findIndex((item) => item.id === next.id)
  if (index >= 0) items[index] = cloneJson(next)
  else items.push(cloneJson(next))
}

function removeById(items, id) {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return false
  items.splice(index, 1)
  return true
}

function setObjectProperty(object, path, value) {
  const segments = path.split('.')
  if (!MUTABLE_OBJECT_ROOTS.has(segments[0])) return false
  let target = object
  for (const segment of segments.slice(0, -1)) {
    const next = target[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false
    target = next
  }
  target[segments.at(-1)] = cloneJson(value)
  return true
}

function validateTransactionIdentity(document, transaction, lease) {
  if (transaction.resourceId !== document.id) {
    return semanticError(
      'scene_transaction_resource_mismatch',
      'resourceId',
      'Scene transaction resource does not match the scene document.',
    )
  }
  if (!lease) return null
  const validation = validateSceneLease(lease)
  if (!validation.ok) return failure('scene_lease_invalid', validation.errors)
  for (const key of ['stageId', 'ownerId', 'resourceId']) {
    if (transaction[key] !== lease[key]) {
      return semanticError(
        'scene_transaction_lease_mismatch',
        key,
        `Scene transaction ${key} does not match the active lease.`,
      )
    }
  }
  return null
}

export function applySceneTransaction(documentInput, transactionInput, options = {}) {
  const documentValidation = validateSceneDocument(documentInput)
  if (!documentValidation.ok) return failure('scene_document_invalid', documentValidation.errors)
  const transactionValidation = validateSceneTransaction(transactionInput)
  if (!transactionValidation.ok) return failure('scene_transaction_invalid', transactionValidation.errors)

  const document = canonicalizeSceneDocument(documentInput)
  const transaction = cloneJson(transactionInput)
  const identityFailure = validateTransactionIdentity(document, transaction, options.lease)
  if (identityFailure) return identityFailure
  if (transaction.expectedRevision !== document.revision) {
    return semanticError(
      'scene_revision_conflict',
      'expectedRevision',
      `Expected scene revision ${transaction.expectedRevision}, current revision is ${document.revision}.`,
    )
  }

  const candidate = cloneJson(document)
  for (const [index, operation] of transaction.operations.entries()) {
    switch (operation.op) {
      case 'put_object':
        replaceById(candidate.objects, operation.object)
        break
      case 'remove_object':
        if (!removeById(candidate.objects, operation.objectId)) {
          return semanticError(
            'scene_object_missing',
            `operations.${index}.objectId`,
            'Scene transaction cannot remove an unknown object.',
          )
        }
        break
      case 'set_property': {
        const object = candidate.objects.find((entry) => entry.id === operation.objectId)
        if (!object) {
          return semanticError(
            'scene_object_missing',
            `operations.${index}.objectId`,
            'Scene transaction cannot update an unknown object.',
          )
        }
        if (!setObjectProperty(object, operation.path, operation.value)) {
          return semanticError(
            'scene_property_denied',
            `operations.${index}.path`,
            'Scene property updates are limited to mutable object fields.',
          )
        }
        break
      }
      case 'put_resource':
        replaceById(candidate.resources, operation.resource)
        break
      case 'remove_resource':
        if (!removeById(candidate.resources, operation.resourceId)) {
          return semanticError(
            'scene_resource_missing',
            `operations.${index}.resourceId`,
            'Scene transaction cannot remove an unknown resource.',
          )
        }
        break
    }
  }
  candidate.revision = document.revision + 1
  const candidateValidation = validateSceneDocument(candidate)
  if (!candidateValidation.ok) {
    return failure('scene_transaction_result_invalid', candidateValidation.errors)
  }
  return {
    ok: true,
    document: canonicalizeSceneDocument(candidate),
    previousRevision: document.revision,
    revision: candidate.revision,
    transactionId: transaction.transactionId,
  }
}
