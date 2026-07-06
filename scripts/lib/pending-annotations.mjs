import {
  SCHEMA_VERSION,
} from './pending-annotations-model.mjs';

export {
  PendingAnnotationError,
  emitPendingAnnotationError,
  isPendingAnnotationError,
} from './pending-annotations-constants.mjs';

export {
  SCHEMA_VERSION,
};

export {
  createPendingAnnotation,
  listPendingAnnotations,
  readPendingAnnotation,
  consumePendingAnnotation,
  linkPendingAnnotationWorkRecord,
  deletePendingAnnotation,
} from './pending-annotations-lifecycle.mjs';

export {
  pendingAnnotationInputFromOperatorSelection,
} from './pending-annotations-surface-adapter.mjs';

export function schemaVersion() {
  return SCHEMA_VERSION;
}
