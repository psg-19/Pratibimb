/* eslint-disable @typescript-eslint/no-explicit-any -- the mock API records untyped JSON request bodies */
/**
 * AI features against a local mock of the Gemini API (generateContent and
 * streamGenerateContent): checks the requests the SDK really sends (model, key header,
 * thinking level, JSON schema, inline files, tools), the fallbacks when Gemini is busy, and runs
 * the "Ask your twin" agent's function-calling loop end to end with our twin answering.
 */
import { GoogleGenAI } from '@google/genai';
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, multipart } from './helpers';

interface Recorded {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, any>;
}
const requests: Recorded[] = [];
let server: Server;
let t: Awaited<ReturnType<typeof createTestApp>>;
let suresh: string;
let doctor: string;

const answer = (parts: unknown[], finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  modelVersion: 'gemini-3.8-flash',
});

function sse(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\r\n\r\n`);
  res.end();
}

/** Canned structured outputs, picked by the system instruction the app sent. */
function structured(system: string) {
  if (system.includes('estimate carbohydrate')) {
    return {
      is_food: true,
      items: [
        { name: 'Ragi rotti', quantity: '2 medium', carbs_g: 50, absorption: 'slow' },
        { name: 'Buttermilk', quantity: '1 glass', carbs_g: 5, absorption: 'medium' },
      ],
      confidence: 'medium',
      notes: 'Assumed medium rotti.',
    };
  }
  if (system.includes('extract structured data')) {
    return { is_medical_document: true, report_date: '2026-10-01', labs: [{ name: 'HbA1c', value: 7.6, unit: '%', date: '2026-10-01' }], medications: [{ name: 'Metformin', dose: '500 mg', frequency: 'twice daily' }], notes: '' };
  }
  if (system.includes('suggest dinners')) {
    return {
      options: [
        { name: 'Big rice plate', items: '2 cups rice', carbs_g: 110, absorption: 'fast', why: 'Familiar.' },
        { name: 'Millet khichdi', items: '1½ cups', carbs_g: 45, absorption: 'slow', why: 'Slow rise.' },
        { name: 'Chapati and dal', items: '2 chapati, dal', carbs_g: 50, absorption: 'medium', why: 'Balanced.' },
      ],
    };
  }
  if (system.includes('draft short messages')) {
    return { message: 'ಸುರೇಶ್ ಅವರೇ, ಮಲಗುವ ಮೊದಲು ಒಂದು ಲೋಟ ಹಾಲು ಕುಡಿಯಿರಿ.', english: 'Suresh, please have a glass of milk before bed.' };
  }
  return {};
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ url: req.url ?? '', headers: req.headers, body });
      const system = JSON.stringify(body.systemInstruction ?? '');
      const prompt = JSON.stringify(body.contents);
      if (prompt.includes('BUSY_ME')) {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }));
      }
      if (prompt.includes('REFUSE_ME')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
      }
      if (req.url?.includes(':streamGenerateContent')) {
        // "Ask your twin": the first turn calls get_forecast; once the result is back, it answers.
        if (!prompt.includes('functionResponse')) {
          return sse(res, [
            answer([{ text: 'Thinking about the forecast…', thought: true }], undefined as unknown as string),
            answer([{ functionCall: { id: 'call_1', name: 'get_forecast', args: { hours: 5 } }, thoughtSignature: 'c2lnLTE=' }]),
          ]);
        }
        return sse(res, [answer([{ text: 'Your twin expects ' }], undefined as unknown as string), answer([{ text: 'a low tonight.' }])]);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (body.generationConfig?.responseMimeType === 'application/json') return res.end(JSON.stringify(answer([{ text: JSON.stringify(structured(system)) }])));
      res.end(JSON.stringify(answer([{ text: 'S: Low likely overnight.\nB: 54-year-old.\nA: Walk after dinner.\nR: Suggest a snack.' }])));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const client = new GoogleGenAI({ apiKey: 'test-key', httpOptions: { baseUrl: `http://127.0.0.1:${port}` } });
  t = await createTestApp({ ai: client, only: ['suresh'] });
  suresh = (await t.login('suresh@pratibimb.demo')).cookie;
  doctor = (await t.login('doctor@pratibimb.demo')).cookie;
}, 120_000);

afterAll(() => {
  server?.close();
});

const post = (url: string, payload: object, cookie: string) => t.app.inject({ method: 'POST', url, payload, headers: { cookie } });
const last = () => requests[requests.length - 1];

describe('requests the app sends to Gemini', () => {
  it('meal parsing: Gemini 3.8 Flash, key header, low thinking, JSON schema', async () => {
    const res = await post('/api/patients/suresh/ai/meal-text', { text: '2 ragi rotti, buttermilk' }, suresh);
    expect(res.statusCode).toBe(200);
    const r = last();
    expect(r.url).toBe('/v1beta/models/gemini-3.8-flash:generateContent');
    expect(r.headers['x-goog-api-key']).toBe('test-key');
    expect(r.body.systemInstruction.parts[0].text).toMatch(/estimate carbohydrate/);
    expect(r.body.generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(r.body.generationConfig.responseMimeType).toBe('application/json');
    const schema = r.body.generationConfig.responseJsonSchema;
    expect(schema.properties.items.items.properties.absorption.enum).toEqual(['fast', 'medium', 'slow']);
    expect(schema.$schema).toBeUndefined();
    expect(r.body.generationConfig.temperature).toBeUndefined();
    const meal = res.json();
    expect(meal).toMatchObject({ by: 'ai', totalCarbs: 55, confidence: 'medium' });
    expect(meal.items[0].speed).toBe(0.8);
  });

  it('a blocked prompt surfaces as 422, not as a fake answer', async () => {
    const res = await post('/api/patients/suresh/ai/meal-text', { text: 'REFUSE_ME' }, suresh);
    expect(res.statusCode).toBe(422);
  });

  it('when Gemini is rate-limited, meal text falls back to the food table and says so', async () => {
    const res = await post('/api/patients/suresh/ai/meal-text', { text: 'BUSY_ME 2 chapati and dal' }, suresh);
    expect(res.statusCode).toBe(200);
    expect(res.json().by).toBe('offline');
    expect(res.json().totalCarbs).toBeGreaterThan(0);
    expect(res.json().notes).toMatch(/Gemini is busy/);
  });

  it('when rate-limited, the planner and drafts fall back too, and are labelled offline', async () => {
    const plan = await post('/api/patients/suresh/ai/plan', { preferences: 'BUSY_ME' }, suresh);
    expect(plan.statusCode).toBe(200);
    expect(plan.json().by).toBe('offline');
    expect(plan.json().options.length).toBeGreaterThan(0);
    const d = await post('/api/patients/suresh/ai/draft', { intent: 'snack', language: 'en', note: 'BUSY_ME' }, doctor);
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ by: 'offline' });
    expect(d.json().message).toMatch(/Suresh/);
  });

  it('features without an offline version report "busy" as 503', async () => {
    const { body, headers } = multipart('file', 'meal.jpg', 'image/jpeg', Buffer.from('fake-jpeg'), { note: 'BUSY_ME' });
    const res = await t.app.inject({ method: 'POST', url: '/api/patients/suresh/ai/meal-photo', payload: body, headers: { ...headers, cookie: suresh } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_busy');
  });

  it('record extraction sends the document inline and returns structured labs', async () => {
    const { body, headers } = multipart('file', 'report.pdf', 'application/pdf', Buffer.from('%PDF-1.4 fake'));
    const res = await t.app.inject({ method: 'POST', url: '/api/patients/suresh/ai/records', payload: body, headers: { ...headers, cookie: suresh } });
    expect(res.statusCode).toBe(200);
    const part = last().body.contents[0].parts[0];
    expect(part.inlineData.mimeType).toBe('application/pdf');
    expect(Buffer.from(part.inlineData.data, 'base64').toString()).toBe('%PDF-1.4 fake');
    expect(res.json().labs[0]).toMatchObject({ name: 'HbA1c', value: 7.6 });
  });

  it('the dinner planner lets the twin, not the model, rank the ideas', async () => {
    const res = await post('/api/patients/suresh/ai/plan', { preferences: 'vegetarian' }, suresh);
    const opts = res.json().options as { name: string; aboveMin: number; peak: number }[];
    expect(res.json().by).toBe('ai');
    expect(opts.at(-1)!.name).toBe('Big rice plate');
    expect(opts.map((o) => o.aboveMin)).toEqual([...opts.map((o) => o.aboveMin)].sort((a, b) => a - b));
  });

  it('drafts and briefs are grounded in the twin’s numbers', async () => {
    const d = await post('/api/patients/suresh/ai/draft', { intent: 'snack', language: 'kn' }, doctor);
    expect(d.json()).toMatchObject({ by: 'ai' });
    expect(d.json().english).toMatch(/milk/);
    const prompt = JSON.stringify(last().body.contents);
    expect(prompt).toContain('Driver: A 45-minute walk straight after dinner');
    expect(prompt).toContain('Kannada');
    const b = await t.app.inject({ method: 'GET', url: '/api/patients/suresh/ai/brief', headers: { cookie: doctor } });
    expect(b.json()).toMatchObject({ by: 'ai' });
    expect(b.json().text).toMatch(/^S: /);
    expect(last().body.systemInstruction.parts[0].text).toMatch(/SBAR/);
  });
});

describe('Ask your twin (agent with tools)', () => {
  it('streams tool activity and the answer, after running the twin’s forecast tool', async () => {
    const before = requests.length;
    const res = await post('/api/patients/suresh/chat', { message: 'Will I go low tonight?' }, suresh);
    expect(res.statusCode).toBe(200);
    const events = res.body
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    expect(events).toContainEqual({ type: 'tool', tool: 'get_forecast', label: 'Running the forecast' });
    // Thoughts are never shown to the patient.
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Your twin expects a low tonight.');
    expect(events.at(-1)).toEqual({ type: 'done' });

    const turns = requests.slice(before);
    expect(turns).toHaveLength(2);
    expect(turns[0].url).toBe('/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    const first = turns[0].body;
    expect(first.tools[0].functionDeclarations.map((x: { name: string }) => x.name)).toEqual(['get_status', 'get_forecast', 'simulate_dinner', 'get_learned_physiology', 'lookup_food']);
    expect(first.tools[0].functionDeclarations[2].parametersJsonSchema.properties.absorption.enum).toEqual(['fast', 'medium', 'slow']);
    expect(first.systemInstruction.parts[0].text).toMatch(/Never recommend starting, stopping or changing the dose/);
    expect(first.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: 'Will I go low tonight?' }] });

    // The model turn goes back as received (thought signature included), then our twin's answer.
    const second = turns[1].body.contents;
    const modelTurn = second.at(-2);
    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts.some((p: any) => p.functionCall?.name === 'get_forecast' && p.thoughtSignature === 'c2lnLTE=')).toBe(true);
    const response = second.at(-1).parts[0].functionResponse;
    expect(response).toMatchObject({ id: 'call_1', name: 'get_forecast' });
    // 5 hours snaps to the 6-hour forecast, which carries the drivers.
    expect(response.response.output.horizon_hours).toBe(6);
    expect(response.response.output).toHaveProperty('chance_of_low_pct');
    expect(JSON.stringify(response)).toContain('A 45-minute walk straight after dinner');
  });

  it('keeps the conversation, and sends it back as user/model turns', async () => {
    const h = (await t.app.inject({ method: 'GET', url: '/api/patients/suresh/chat', headers: { cookie: suresh } })).json();
    expect(h.enabled).toBe(true);
    expect(h.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);

    const before = requests.length;
    await post('/api/patients/suresh/chat', { message: 'And tomorrow?' }, suresh);
    const roles = requests[before].body.contents.map((c: { role: string }) => c.role);
    expect(roles).toEqual(['user', 'model', 'user']);
  });

  it('a question whose answer failed does not break the user/model turn order', async () => {
    t.db.prepare("INSERT INTO chat (patient_id, role, content, created_at_ms) VALUES ('suresh', 'user', 'A question that got no answer', ?)").run(Date.now());
    const before = requests.length;
    await post('/api/patients/suresh/chat', { message: 'Shall I walk tonight?' }, suresh);
    const contents = requests[before].body.contents as { role: string; parts: { text: string }[] }[];
    const roles = contents.map((c) => c.role);
    expect(roles.every((r, i) => i === 0 || r !== roles[i - 1])).toBe(true);
    expect(contents.at(-1)!.parts.map((p) => p.text)).toEqual(['A question that got no answer', 'Shall I walk tonight?']);
  });
});
