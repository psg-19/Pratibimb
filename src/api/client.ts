/** Typed client for the Pratibimb API (same-origin; the session cookie carries auth). */
import type {
  AlertDTO,
  CarePatientDTO,
  ExtractedRecords,
  ForecastDTO,
  Health,
  Me,
  MealEstimate,
  MessageDTO,
  PlannedDinner,
  RecordDTO,
  ReviewStatus,
  SavedScenarioDTO,
  SourceId,
  SourceStateDTO,
  TwinDashboardDTO,
  WhatIfDTO,
  WhatIfRequest,
  ChatStreamEvent,
  ConsentId,
  Lang,
} from '../../shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init).catch(() => { throw new Error('Could not reach the server. Check the connection and try again.'); });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new ApiError(res.status, 'invalid_response', 'The server returned an unreadable response. Please try again.'); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status}).`);
  return data as T;
}

const get = <T>(u: string) => request<T>('GET', u);
const post = <T>(u: string, b?: unknown) => request<T>('POST', u, b ?? {});
const p = (id: string) => `/api/patients/${encodeURIComponent(id)}`;

export const api = {
  health: () => get<Health>('/api/health'),
  me: () => get<Me | null>('/api/me'),
  login: (email: string, password: string) => post<Me>('/api/auth/login', { email, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  signup: (body: Record<string, unknown>) => post<Me>('/api/auth/signup', body),
  clock: (body: { speed?: number; paused?: boolean; reset?: boolean }) => post<Health['clock']>('/api/clock', body),
  resetDemo: () => post<{ ok: true }>('/api/demo/reset'),

  dashboard: (id: string) => get<TwinDashboardDTO>(`${p(id)}/dashboard`),
  forecast: (id: string, horizon: number) => get<ForecastDTO>(`${p(id)}/forecast?horizon=${horizon}`),
  alertAction: (id: string, alertId: number, action: 'snack' | 'team' | 'dismiss' | 'undo') => post<AlertDTO>(`${p(id)}/alerts/${alertId}`, { action }),

  logEvent: (id: string, body: Record<string, unknown>) => post<{ id: number }>(`${p(id)}/events`, body),
  confirmEvent: (id: string, eventId: number) => request<{ ok: true }>('PATCH', `${p(id)}/events/${eventId}`, { confirm: true }),
  deleteEvent: (id: string, eventId: number) => request<{ ok: true }>('DELETE', `${p(id)}/events/${eventId}`),

  whatIf: (id: string, body: WhatIfRequest) => post<WhatIfDTO>(`${p(id)}/whatif`, body),
  scenarios: (id: string) => get<SavedScenarioDTO[]>(`${p(id)}/scenarios`),
  saveScenario: (id: string, body: WhatIfRequest) => post<{ ok: true }>(`${p(id)}/scenarios`, body),
  sendPlan: (id: string, text: string) => post<{ ok: true; sentAt: number }>(`${p(id)}/plan`, { text }),

  messages: (id: string) => get<MessageDTO[]>(`${p(id)}/messages`),
  sendMessage: (id: string, body: string, language: Lang) => post<{ id: number }>(`${p(id)}/messages`, { body, language }),
  markRead: (id: string) => post<{ ok: true }>(`${p(id)}/messages/read`),

  records: (id: string) => get<RecordDTO[]>(`${p(id)}/records`),
  saveRecords: (id: string, records: Omit<RecordDTO, 'id' | 'source'>[], source: string) => post<{ ok: true; count: number }>(`${p(id)}/records`, { records, source }),

  sources: (id: string) => get<SourceStateDTO>(`${p(id)}/sources`),
  setSource: (id: string, source: SourceId, connected: boolean) => post<SourceStateDTO>(`${p(id)}/sources/${source}`, { connected }),
  setConsents: (id: string, consents: Partial<Record<ConsentId, boolean>>) => request<SourceStateDTO>('PUT', `${p(id)}/consents`, consents),
  build: (id: string) => post<{ ok: true; fitted: boolean }>(`${p(id)}/build`),
  importCgm: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<{ ok: true; format: string; count: number; skipped: number; days: number; lastReading: string; state: SourceStateDTO }>(`${p(id)}/import`, fd);
  },

  care: () => get<CarePatientDTO[]>('/api/care'),
  review: (id: string, status: ReviewStatus) => post<CarePatientDTO>(`/api/care/${encodeURIComponent(id)}/review`, { status }),

  // AI
  mealText: (id: string, text: string) => post<MealEstimate>(`${p(id)}/ai/meal-text`, { text }),
  mealPhoto: (id: string, file: File, note: string) => {
    const fd = new FormData();
    fd.append('note', note);
    fd.append('file', file);
    return post<MealEstimate>(`${p(id)}/ai/meal-photo`, fd);
  },
  extractRecords: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return post<ExtractedRecords>(`${p(id)}/ai/records`, fd);
  },
  plan: (id: string, preferences: string) => post<{ options: PlannedDinner[]; by: 'ai' | 'offline' }>(`${p(id)}/ai/plan`, { preferences }),
  explain: (id: string, lang: Lang) => get<{ text: string; by: 'ai' | 'offline' }>(`${p(id)}/ai/explain?lang=${lang}`),
  brief: (id: string) => get<{ text: string; by: 'ai' | 'offline' }>(`${p(id)}/ai/brief`),
  draft: (id: string, intent: string, language: Lang, note: string) => post<{ message: string; english: string; by: 'ai' | 'offline' }>(`${p(id)}/ai/draft`, { intent, language, note }),
  chatHistory: (id: string) => get<{ enabled: boolean; messages: { id: number; role: 'user' | 'assistant'; text: string }[] }>(`${p(id)}/chat`),
  clearChat: (id: string) => request<{ ok: true }>('DELETE', `${p(id)}/chat`),

  /** Streams a chat answer; resolves when the stream ends. */
  async chat(id: string, message: string, onEvent: (e: ChatStreamEvent) => void) {
    const res = await fetch(`${p(id)}/chat`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'The twin could not answer.');
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
      }
    }
  },
};
