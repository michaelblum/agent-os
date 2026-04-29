function defaultClock() {
  return new Date().toISOString()
}

export function createTimeline(options = {}) {
  const clock = options.clock ?? defaultClock
  const records = []
  let nextSequence = Number.isInteger(options.startSequence) ? options.startSequence : 1

  return {
    append(event, source = 'unknown') {
      if (!event || typeof event !== 'object') throw new Error('timeline event must be an object')
      if (typeof event.type !== 'string' || event.type.length === 0) {
        throw new Error('timeline event requires a type')
      }

      const record = {
        sequence: nextSequence++,
        source,
        appended_at: clock(),
        event: structuredCloneCompat(event),
      }
      records.push(record)
      return structuredCloneCompat(record)
    },
    records() {
      return structuredCloneCompat(records)
    },
    events() {
      return records.map((record) => structuredCloneCompat(record.event))
    },
    length() {
      return records.length
    },
  }
}

function structuredCloneCompat(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}
