/** Events pushed to the browser over /api/stream. */
export type LiveEventDTO =
  | { type: 'hello' }
  | { type: 'ping' }
  | { type: 'clock' }
  | { type: 'reading'; patientId: string; t: number; mgdl: number }
  | { type: 'alert'; patientId: string; alertId: number }
  | { type: 'twin'; patientId: string; fittedAt: number }
  | { type: 'events'; patientId: string }
  | { type: 'review'; patientId: string }
  | { type: 'message'; patientId: string };
