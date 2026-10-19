/**
 * A small pool of worker threads for twin fitting, so the API stays responsive during fits.
 */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { buildTwin, type TwinBuildInput, type TwinModelData } from '../../shared/twin/pipeline';

const here = dirname(fileURLToPath(import.meta.url));

function workerFile() {
  // Production bundle: build/twinWorker.mjs next to the server. Development: a bootstrap that loads tsx.
  const candidates = [resolve(here, 'twinWorker.mjs'), resolve(here, '../twinWorker.dev.mjs')];
  return candidates.find((f) => existsSync(f));
}

export class FitPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { input: TwinBuildInput; resolve: (r: TwinModelData) => void; reject: (e: Error) => void }[] = [];
  private pending = new Map<number, { resolve: (r: TwinModelData) => void; reject: (e: Error) => void; worker: Worker }>();
  private seq = 0;
  private readonly file = workerFile();

  /** `size` 0 fits inline on the calling thread (used by tests). */
  constructor(size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    if (!this.file || size === 0) return;
    for (let i = 0; i < size; i++) {
      const w = new Worker(this.file);
      w.on('message', (m: { id: number; ok: boolean; result?: TwinModelData; error?: string }) => {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        // Idle workers must not keep the process alive; busy ones must.
        w.unref();
        this.idle.push(w);
        if (p && m.ok) p.resolve(m.result!);
        else if (p) p.reject(new Error(m.error));
        this.drain();
      });
      w.on('error', (err) => {
        for (const [id, p] of this.pending) if (p.worker === w) {
          this.pending.delete(id);
          p.reject(err);
        }
      });
      w.unref();
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  build(input: TwinBuildInput): Promise<TwinModelData> {
    // No worker available (e.g. in tests): fit inline.
    if (this.workers.length === 0) return Promise.resolve().then(() => buildTwin(input));
    return new Promise((resolve, reject) => {
      this.queue.push({ input, resolve, reject });
      this.drain();
    });
  }

  private drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = ++this.seq;
      this.pending.set(id, { resolve: job.resolve, reject: job.reject, worker: w });
      w.ref();
      w.postMessage({ id, input: job.input });
    }
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
