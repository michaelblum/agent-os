// src/tools/coordination.ts
import type { CoordinationDB } from '../db.js';

export function registerCoordinationTools(db: CoordinationDB) {
  return {
    register_session: (args: any) =>
      db.registerSession(args.name, args.role, args.harness, args.capabilities),

    set_state: (args: any) =>
      db.setState(args.key, args.value, {
        mode: args.mode, expectedVersion: args.expected_version,
        owner: args.owner, ttl: args.ttl,
      }),

    get_state: (args: any) =>
      db.getState(args.key),

    post_message: (args: any) =>
      ({ id: db.postMessage(args.channel, args.payload, args.from) }),

    read_stream: (args: any) =>
      db.readStream(args.channel, { since: args.since, limit: args.limit }),
  };
}
