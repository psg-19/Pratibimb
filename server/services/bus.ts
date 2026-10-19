/** In-process event bus feeding the Server-Sent Events stream. */
import { EventEmitter } from 'node:events';

import type { LiveEventDTO } from '../../shared/live';

export type LiveEvent = Exclude<LiveEventDTO, { type: 'hello' } | { type: 'ping' }>;

export class Bus extends EventEmitter {
  publish(e: LiveEvent) {
    this.emit('event', e);
  }
  subscribe(fn: (e: LiveEvent) => void) {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}
