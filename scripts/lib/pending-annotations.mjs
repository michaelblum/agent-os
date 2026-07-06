export {
  PendingAnnotationError,
  emitPendingAnnotationError,
  isPendingAnnotationError,
  SCHEMA_VERSION,
} from './pending-annotations-constants.mjs';

export {
  createPendingAnnotation,
  listPendingAnnotations,
  readPendingAnnotation,
  consumePendingAnnotation,
  linkPendingAnnotationWorkRecord,
  deletePendingAnnotation,
} from './pending-annotations-lifecycle.mjs';

export function schemaVersion() {
  return 'aos.pending-annotation.v0';
}
