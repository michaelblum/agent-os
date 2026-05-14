const SUPPORTED_FIELD_KINDS = new Set([
  'boolean',
  'exclusive_choice',
  'multi_choice',
  'text',
  'number',
]);

export class GateReceptor {
  constructor({ onResolve = null, onReject = null } = {}) {
    this.onResolve = onResolve;
    this.onReject = onReject;
  }

  async receive(gateRequest) {
    return this.present(gateRequest);
  }

  async present(_gateRequest) {
    throw new Error(`${this.constructor.name}.present() must be implemented`);
  }

  async dismiss(_handle) {
  }

  supports(kind) {
    return SUPPORTED_FIELD_KINDS.has(kind);
  }

  resolve(id, values) {
    if (!id) throw new Error('GateReceptor.resolve requires an id');
    this.onResolve?.(id, values);
  }

  reject(id, reason) {
    if (!id) throw new Error('GateReceptor.reject requires an id');
    this.onReject?.(id, reason);
  }
}

export { SUPPORTED_FIELD_KINDS };
