export function copyTextToClipboard(text = '', {
    document = globalThis.document,
    asyncWrite = null,
} = {}) {
    if (typeof text !== 'string') {
        throw new Error('INVALID_PAYLOAD: copyTextToClipboard requires plain text')
    }

    function copyViaSelection() {
        if (!document?.body || typeof document.createElement !== 'function' || typeof document.execCommand !== 'function') {
            return false
        }
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.top = '0'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus?.()
        textarea.select?.()
        try {
            return document.execCommand('copy')
        } finally {
            textarea.remove?.()
        }
    }

    if (copyViaSelection()) {
        return Promise.resolve(true)
    }
    if (typeof asyncWrite !== 'function') {
        return Promise.resolve(false)
    }
    return Promise.resolve(asyncWrite(text)).then(() => true)
}
