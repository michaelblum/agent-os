const DEFAULT_MAX_QUEUED_BYTES = 512 * 1024
const DEFAULT_MAX_QUEUED_MESSAGES = 64

function overflowError() {
  const error = new Error('status item stdout queue exceeded its bound')
  error.code = 'STATUS_ITEM_OUTPUT_BUFFER_EXCEEDED'
  return error
}

export function createStatusItemOutputWriter({
  output = process.stdout,
  maxQueuedBytes = DEFAULT_MAX_QUEUED_BYTES,
  maxQueuedMessages = DEFAULT_MAX_QUEUED_MESSAGES,
} = {}) {
  let source = null
  let sourcePaused = false
  let blocked = false
  let queuedBytes = 0
  let drainHandler = null
  const queue = []

  const pauseSource = () => {
    if (source && !source.destroyed && !sourcePaused) {
      source.pause()
      sourcePaused = true
    }
  }

  const resumeSource = () => {
    if (source && !source.destroyed && sourcePaused) {
      source.resume()
      sourcePaused = false
    }
  }

  const enqueue = (line) => {
    const bytes = Buffer.byteLength(line)
    if (queue.length >= maxQueuedMessages || queuedBytes + bytes > maxQueuedBytes) throw overflowError()
    queue.push({ line, bytes })
    queuedBytes += bytes
  }

  const waitForDrain = () => {
    if (drainHandler) return
    drainHandler = () => {
      drainHandler = null
      blocked = false
      flush()
    }
    output.once('drain', drainHandler)
  }

  const flush = () => {
    while (!blocked && queue.length > 0) {
      const entry = queue.shift()
      queuedBytes -= entry.bytes
      if (!output.write(entry.line)) {
        blocked = true
        pauseSource()
        waitForDrain()
      }
    }
    if (!blocked && queue.length === 0) resumeSource()
  }

  return {
    attachSource(nextSource) {
      if (source !== nextSource) {
        source = nextSource
        sourcePaused = false
      }
      if (blocked || queue.length > 0) pauseSource()
    },
    write(line) {
      if (typeof line !== 'string') throw new TypeError('status item output writer requires a string')
      if (blocked || queue.length > 0) {
        enqueue(line)
        pauseSource()
        return false
      }
      if (!output.write(line)) {
        blocked = true
        pauseSource()
        waitForDrain()
        return false
      }
      return true
    },
    snapshot() {
      return { blocked, queued_bytes: queuedBytes, queued_messages: queue.length }
    },
  }
}
