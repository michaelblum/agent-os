export const SAFETY_GATES = Object.freeze([
  'before_submit',
  'before_download',
  'before_file_upload',
  'before_payment',
  'before_external_domain',
  'before_login_secret',
  'before_destructive_action',
])

const PAYMENT_RE = /(card|\bcc\b|cvc|cvv|expir)/i
const LOGIN_SECRET_RE = /(password|passwd|pwd|otp|2fa|mfa)/i
const DESTRUCTIVE_RE = /(delete|remove|cancel subscription|close account)/i

function fieldBlob(action) {
  const fields = [
    action?.target_role,
    action?.target_name,
    action?.target_text,
    action?.input?.name,
    action?.input?.id,
    action?.input?.autocomplete,
    action?.input?.type,
    action?.element?.name,
    action?.element?.id,
    action?.element?.autocomplete,
    action?.element?.type,
    action?.element?.text,
  ]
  return fields.filter(Boolean).join(' ')
}

function urlHost(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function classifySafetyGate(action, context = {}) {
  if (!action || typeof action !== 'object') return null

  if (action.download === true || action.event === 'download') return 'before_download'
  if (action.event === 'submit' || action.form_submit === true) return 'before_submit'

  const blob = fieldBlob(action)
  if (/\bfile\b/i.test(action?.input?.type ?? action?.element?.type ?? '')) return 'before_file_upload'
  if (PAYMENT_RE.test(blob)) return 'before_payment'
  if ((action?.input?.type === 'password' || action?.element?.type === 'password') || LOGIN_SECRET_RE.test(blob)) {
    return 'before_login_secret'
  }
  if ((action.op === 'click' || action.op === 'fill') && DESTRUCTIVE_RE.test(blob)) {
    return 'before_destructive_action'
  }

  const anchorHost = context.anchor_host ?? urlHost(context.anchor_url)
  const nextHost = urlHost(action.url ?? action.href ?? action.target_url)
  if (anchorHost && nextHost && anchorHost !== nextHost) return 'before_external_domain'

  return null
}

export function evaluateSafetyGate(action, context = {}) {
  const gate = classifySafetyGate(action, context)
  if (!gate) return { status: 'pass' }
  return {
    status: 'require_human_ack',
    gate_kind: gate,
    reason: safetyGateReason(gate),
  }
}

export function safetyGateReason(gate) {
  switch (gate) {
    case 'before_submit': return 'Form submission requires human acknowledgement.'
    case 'before_download': return 'Download requires human acknowledgement.'
    case 'before_file_upload': return 'File upload requires human acknowledgement.'
    case 'before_payment': return 'Payment-like field requires human acknowledgement.'
    case 'before_external_domain': return 'Navigation leaves the session anchor host.'
    case 'before_login_secret': return 'Login-secret field requires human acknowledgement.'
    case 'before_destructive_action': return 'Destructive action requires human acknowledgement.'
    default: return 'Action requires human acknowledgement.'
  }
}
