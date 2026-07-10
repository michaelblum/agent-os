import validateInputEventV2 from './input-event-validator.generated.js'

export function parseCanonicalInputEvent(event) {
  if (!validateInputEventV2(event)) {
    const failure = validateInputEventV2.errors?.[0]
    const detail = failure ? `${failure.instancePath || '$'} ${failure.message}` : 'unknown validation failure'
    throw new Error(`canonical input payload is not schema-valid: ${detail}`)
  }
  return event
}
