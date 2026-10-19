/** Worker thread: builds a twin off the main thread so the API stays responsive while fitting. */
import { parentPort } from 'node:worker_threads';
import { buildTwin, type TwinBuildInput } from '../shared/twin/pipeline';

parentPort?.on('message', (msg: { id: number; input: TwinBuildInput }) => {
  try {
    parentPort!.postMessage({ id: msg.id, ok: true, result: buildTwin(msg.input) });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
