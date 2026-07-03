const ACTIVE_CHAT_SEND_CODE = 'AOS_HOST_CHAT_SEND_ACTIVE';

export class ActiveStreamRegistry {
  private active = new Map<string, AbortController>();

  begin(sessionId: string): AbortController {
    if (this.active.has(sessionId)) {
      throw Object.assign(
        new Error(`chat.send already active for session: ${sessionId}`),
        { code: ACTIVE_CHAT_SEND_CODE },
      );
    }
    const controller = new AbortController();
    this.active.set(sessionId, controller);
    return controller;
  }

  finish(sessionId: string, controller: AbortController): void {
    if (this.active.get(sessionId) === controller) {
      this.active.delete(sessionId);
    }
  }

  stop(sessionId: string): boolean {
    const controller = this.active.get(sessionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  abortAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
  }

  get size(): number {
    return this.active.size;
  }
}

