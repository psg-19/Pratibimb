/**
 * AI features on Google Gemini (`@google/genai`). Every request:
 *  - uses one model (config.aiModel, default gemini-3.8-flash);
 *  - checks for blocked prompts and safety stops before reading the answer;
 *  - is grounded: numbers come from the twin (tool results or data passed in), never from the model;
 *  - never touches medicine doses (see prompts.ts).
 * On the free tier, rate limits are tight: features with an offline equivalent fall back to it
 * when Gemini is busy or unreachable, so the demo keeps working.
 */
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type GenerateContentConfig, type GenerateContentResponse, type Part } from '@google/genai';
import * as z from 'zod/v4';
import type { ChatStreamEvent, ExtractedRecords, Lang, MealEstimate, PlannedDinner } from '../../shared/api';
import { FOODS, matchFood } from '../../shared/physio/foods';
import { clockIST } from '../../shared/time';
import { verdict } from '../../shared/twin/whatif';
import { config } from '../config';
import type { TwinService } from '../services/twin';
import { draftOffline, parseMealOffline, PLANNER_CANDIDATES, type DraftIntent } from './offline';
import { BRIEF_SYSTEM, chatSystem, DRAFT_SYSTEM, EXPLAIN_SYSTEM, MEAL_SYSTEM, PLANNER_SYSTEM, RECORDS_SYSTEM } from './prompts';

export class AiUnavailable extends Error {
  constructor() {
    super('AI features are off. Set GEMINI_API_KEY on the server to enable them.');
  }
}
/** The model (or Google's safety filters) declined the request. */
export class AiRefused extends Error {}
/** Gemini answered, but not in the shape we asked for. */
export class AiBadOutput extends Error {}

/** Busy, rate-limited or unreachable: worth falling back to the offline version. */
export function isTransient(err: unknown) {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || /fetch failed|ECONNREFUSED|ETIMEDOUT/i.test(err.message));
}

const SPEED = { fast: 1.35, medium: 1.0, slow: 0.8 } as const;
const LANG_NAME: Record<Lang, string> = { en: 'English', hi: 'Hindi (Devanagari script)', kn: 'Kannada (Kannada script)' };
const BLOCKED = new Set<string>([FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION]);

const MealSchema = z.object({
  is_food: z.boolean(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.string(),
      carbs_g: z.number(),
      absorption: z.enum(['fast', 'medium', 'slow']),
    }),
  ),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.string(),
});

const RecordsSchema = z.object({
  is_medical_document: z.boolean(),
  report_date: z.string().nullable(),
  labs: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string(), date: z.string().nullable() })),
  medications: z.array(z.object({ name: z.string(), dose: z.string(), frequency: z.string() })),
  notes: z.string(),
});

const PlannerSchema = z.object({
  options: z.array(
    z.object({
      name: z.string(),
      items: z.string(),
      carbs_g: z.number(),
      absorption: z.enum(['fast', 'medium', 'slow']),
      why: z.string(),
    }),
  ),
});

const DraftSchema = z.object({ message: z.string(), english: z.string() });

/** JSON Schema for Gemini's `responseJsonSchema` / `parametersJsonSchema` (no `$schema` key). */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void _drop;
  return rest;
}

/** Stops the response was cut or filtered for; throws instead of returning a partial answer. */
function assertUsable(res: GenerateContentResponse) {
  if (res.promptFeedback?.blockReason) throw new AiRefused('Gemini blocked this request.');
  const reason = res.candidates?.[0]?.finishReason;
  if (reason && BLOCKED.has(reason)) throw new AiRefused('Gemini declined this request.');
  if (reason === FinishReason.MAX_TOKENS) throw new AiBadOutput('The answer was cut off.');
}

export class AiService {
  readonly enabled: boolean;
  private client: GoogleGenAI | null;

  /** `client` can be injected (tests point one at a local mock of the API). */
  constructor(
    private twins: TwinService,
    client?: GoogleGenAI | null,
  ) {
    this.client =
      client !== undefined
        ? client
        : config.aiEnabled
          ? // Free-tier friendly: one quick retry and a timeout instead of minutes of back-off.
            new GoogleGenAI({ apiKey: config.aiKey, httpOptions: { timeout: 60_000, retryOptions: { attempts: 2 } } })
          : null;
    this.enabled = !!this.client;
  }

  private get api() {
    if (!this.client) throw new AiUnavailable();
    return this.client;
  }

  /** Lower thinking for quick extraction; Gemini 3.x takes a level, older models keep their default. */
  private thinking(level: 'low' | 'default'): Pick<GenerateContentConfig, 'thinkingConfig'> {
    if (level === 'default' || !/^gemini-3/.test(config.aiModel)) return {};
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  }

  private async json<S extends z.ZodType>(schema: S, system: string, parts: Part[]): Promise<z.infer<S>> {
    const res = await this.api.models.generateContent({
      model: config.aiModel,
      contents: [{ role: 'user', parts }],
      config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: jsonSchema(schema), ...this.thinking('low') },
    });
    assertUsable(res);
    try {
      return schema.parse(JSON.parse(res.text ?? '')) as z.infer<S>;
    } catch {
      throw new AiBadOutput('Gemini returned an unexpected format.');
    }
  }

  private async text(system: string, prompt: string): Promise<string> {
    const res = await this.api.models.generateContent({
      model: config.aiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: system, ...this.thinking('low') },
    });
    assertUsable(res);
    const text = (res.text ?? '').trim();
    if (!text) throw new AiBadOutput('Gemini returned an empty answer.');
    return text;
  }

  /** Runs the AI version, or the offline one when AI is off or Gemini is busy. */
  private async orOffline<T, U>(ai: () => Promise<T>, offline: () => U): Promise<T | U> {
    if (!this.enabled) return offline();
    try {
      return await ai();
    } catch (err) {
      if (!isTransient(err)) throw err;
      // Say why in the server log: a silent fallback hides rate limits and timeouts.
      console.warn(`AI busy or unreachable, using the offline version: ${err instanceof ApiError ? `${err.status} ${err.message.slice(0, 200)}` : err instanceof Error ? err.message : String(err)}`);
      return offline();
    }
  }

  /* ---------------- meals ---------------- */

  async mealFromText(text: string, lang: Lang): Promise<MealEstimate> {
    return this.orOffline(
      async () => toMeal(await this.json(MealSchema, MEAL_SYSTEM, [{ text: `Meal description (patient's language: ${LANG_NAME[lang]}):\n${text}` }])),
      () => {
        const r = parseMealOffline(text);
        return this.enabled ? { ...r, notes: `Gemini is busy, so this used the built-in food table. ${r.notes}` } : r;
      },
    );
  }

  async mealFromPhoto(data: string, mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', note: string): Promise<MealEstimate> {
    const out = await this.json(MealSchema, MEAL_SYSTEM, [
      { inlineData: { mimeType, data } },
      { text: `Estimate the carbohydrate in this meal photo.${note ? ` The patient adds: ${note}` : ''}` },
    ]);
    return toMeal(out);
  }

  /* ---------------- records ---------------- */

  async extractRecords(data: string, mimeType: string): Promise<ExtractedRecords> {
    const out = await this.json(RecordsSchema, RECORDS_SYSTEM, [{ inlineData: { mimeType, data } }, { text: 'Extract the lab results and current medicines from this document.' }]);
    if (!out.is_medical_document) return { reportDate: null, labs: [], medications: [], notes: 'This does not look like a lab report or prescription.', by: 'ai' };
    // Fit what was read to what the records API accepts, so the reviewed rows can be saved as shown.
    return {
      reportDate: isoDate(out.report_date),
      labs: out.labs
        .filter((l) => Number.isFinite(l.value) && l.name.trim())
        .map((l) => ({ name: l.name.trim().slice(0, 80), value: l.value, unit: l.unit.trim().slice(0, 20), date: isoDate(l.date) })),
      medications: out.medications
        .filter((m) => m.name.trim())
        .map((m) => ({ name: m.name.trim().slice(0, 80), dose: m.dose.trim().slice(0, 90), frequency: m.frequency.trim().slice(0, 90) })),
      notes: out.notes,
      by: 'ai',
    };
  }

  /* ---------------- dinner planner ---------------- */

  async planDinners(patientId: string, preferences: string): Promise<{ options: PlannedDinner[]; by: 'ai' | 'offline' }> {
    const p = this.twins.patient(patientId);
    const tw = this.twins.twin(patientId);
    if (!p || !tw) throw new Error('No twin yet.');
    const usual = tw.routine.meals.find((m) => m.slot === 'dinner');
    type Idea = { name: string; items: string; carbs: number; speed: number; why: string };
    const ideas: { by: 'ai' | 'offline'; options: Idea[] } = await this.orOffline(
      async () => {
        const out = await this.json(PlannerSchema, PLANNER_SYSTEM, [
          {
            text: `Suggest 4 dinners for ${p.name.split(' ')[0]}, ${p.age ?? ''} years old, from ${p.city ?? 'India'}, who prefers ${LANG_NAME[p.language]} food names.\nTheir usual dinner is about ${usual?.carbs ?? 80} g carbohydrate.\nPreferences: ${preferences || 'none given'}.`,
          },
        ]);
        return { by: 'ai' as const, options: out.options.slice(0, 5).map((o) => ({ name: o.name, items: o.items, carbs: Math.round(o.carbs_g), speed: SPEED[o.absorption], why: o.why })) };
      },
      () => ({ by: 'offline' as const, options: PLANNER_CANDIDATES }),
    );
    // Every suggestion is tried on the twin; the twin, not the model, ranks them.
    const options = ideas.options
      .map((o) => {
        const r = this.twins.whatIf(patientId, { meal: { carbs: o.carbs, speed: o.speed }, portion: 1, walk: 20, sleep: 7, med: 'taken' })!.result;
        return { ...o, peak: Math.round(r.peak), aboveMin: r.aboveMin, overnightLow: Math.round(r.overnightLow), pLowOvernight: r.pLowOvernight };
      })
      .sort((a, b) => a.aboveMin - b.aboveMin || a.peak - b.peak);
    return { options, by: ideas.by };
  }

  /* ---------------- explanations & drafting ---------------- */

  /** Facts about tonight, all from the twin, for prompts and templates. */
  private facts(patientId: string) {
    const rd = this.twins.riskAndDrivers(patientId);
    const latest = this.twins.latest(patientId);
    const p = this.twins.patient(patientId)!;
    if (!rd) return null;
    const { risk, drivers, forecast: fc } = rd;
    return {
      name: p.name.split(' ')[0],
      lines: [
        `Now: ${latest ? `${latest.mgdl} mg/dL, ${latest.note}` : 'no recent reading'} at ${clockIST(this.twins.clock.now())}.`,
        `Twin risk for the next 6 hours: ${risk.level} — ${risk.title}. ${risk.window}. Probability ${Math.round(risk.probability * 100)}%.`,
        `Forecast lowest ${Math.round(fc.lowest.v)} mg/dL at ${clockIST(fc.lowest.t)}; ${fc.inRangePct}% of the next 6 hours in range.`,
        ...drivers.map((d) => `Driver: ${d.text} (effect ${d.effect} ${d.unit === 'min' ? 'minutes above 180' : 'mg/dL on the overnight low'}).`),
        ...this.twins.facts(patientId).map((f) => `Fact: ${f}.`),
      ],
      risk,
      drivers,
    };
  }

  async explain(patientId: string, lang: Lang): Promise<{ text: string; by: 'ai' | 'offline' }> {
    const f = this.facts(patientId);
    if (!f) throw new Error('No forecast yet.');
    return this.orOffline(
      async () => ({ text: await this.text(EXPLAIN_SYSTEM, `Write for ${f.name} in ${LANG_NAME[lang]}.\n\n${f.lines.join('\n')}`), by: 'ai' as const }),
      () => {
        const top = f.drivers[0];
        const text =
          f.risk.kind === 'stable'
            ? `Your twin expects tonight to stay in range (${f.risk.window.toLowerCase()}).`
            : `${f.risk.title}: ${f.risk.window.toLowerCase()}. ${top ? `The biggest reason is: ${top.text.toLowerCase()}.` : ''} ${f.risk.kind === 'low' ? 'A small snack before bed helps.' : 'Drinking water and a short walk can help.'}`;
        return { text: text.replace(/\s+/g, ' ').trim(), by: 'offline' as const };
      },
    );
  }

  async brief(patientId: string): Promise<{ text: string; by: 'ai' | 'offline' }> {
    const f = this.facts(patientId);
    const p = this.twins.patient(patientId)!;
    if (!f) throw new Error('No forecast yet.');
    const background = `${p.name}, ${p.age ?? '?'} years, type 2 diabetes for ${p.years_t2d ?? '?'} years. Medicines: ${p.meds_long || 'not recorded'}.`;
    const tw = this.twins.twinSummary(patientId);
    return this.orOffline(
      async () => ({
        text: await this.text(BRIEF_SYSTEM, `Background: ${background}\n${tw ? `Twin: fitted on ${tw.days} days of data; back-tested error ±${tw.trackRecord.h4} mg/dL at 4 hours.\n` : ''}${f.lines.join('\n')}`),
        by: 'ai' as const,
      }),
      () => ({
        text: [
          `S: ${f.risk.title} — ${f.risk.window} (${Math.round(f.risk.probability * 100)}%).`,
          `B: ${background}`,
          `A: ${f.drivers.length ? f.drivers.map((d) => d.text).join('; ') : 'No strong drivers; forecast stable.'}${tw ? ` Twin fitted on ${tw.days} days, track record ±${tw.trackRecord.h4} mg/dL at 4 h.` : ''}`,
          `R: ${this.twins.careEntry(patientId)?.action.label ?? 'Review'}.`,
        ].join('\n'),
        by: 'offline' as const,
      }),
    );
  }

  async draft(patientId: string, intent: DraftIntent, lang: Lang, note: string): Promise<{ message: string; english: string; by: 'ai' | 'offline' }> {
    const f = this.facts(patientId);
    const p = this.twins.patient(patientId)!;
    const first = p.name.split(' ')[0];
    const purpose: Record<DraftIntent, string> = {
      snack: 'Ask them to have a small bedtime snack because the twin expects a low overnight.',
      reminder: 'Remind them to take their evening metformin, which has been missed.',
      call: 'Tell them you will call tonight about their sick-day plan.',
      sensor: 'Remind them to change their CGM sensor before bed.',
      checkin: 'Check in about tonight; the twin expects glucose to stay high for a while.',
      ack: 'Reassure them the forecast is steady tonight.',
    };
    return this.orOffline(
      async () => {
        if (!f) return draftOffline(intent, first, lang);
        const out = await this.json(DraftSchema, DRAFT_SYSTEM, [
          { text: `Patient first name: ${first}. Language: ${LANG_NAME[lang]}.\nPurpose: ${purpose[intent]}${note ? `\nClinician's note: ${note}` : ''}\n\nTwin data:\n${f.lines.join('\n')}` },
        ]);
        return { ...out, by: 'ai' as const };
      },
      () => draftOffline(intent, first, lang),
    );
  }

  /* ---------------- "Ask your twin" agent ---------------- */

  private chatTools(patientId: string) {
    const t = this.twins;
    const tools = {
      get_status: {
        description: "Current glucose, trend, time, and today's logged meals, walks and medicines.",
        schema: z.object({}),
        label: 'Checking your latest readings',
        run: () => {
          const l = t.latest(patientId);
          return {
            time: clockIST(t.clock.now()),
            glucose: l ? { mgdl: l.mgdl, trend: l.trend, note: l.note, at: clockIST(l.t) } : null,
            today: t.timeline(patientId).slice(0, 8).map((e) => ({ time: clockIST(e.t), what: e.title, detail: e.note })),
          };
        },
      },
      get_forecast: {
        description: "The twin's forecast for the next 2, 6 or 12 hours: lowest and highest values, chance of a low, time in range, risk window and the drivers behind it.",
        schema: z.object({ hours: z.number().describe('Forecast horizon in hours: 2, 6 or 12') }),
        label: 'Running the forecast',
        run: ({ hours }: { hours: number }) => {
          const h = [2, 6, 12].reduce((best, x) => (Math.abs(x - hours) < Math.abs(best - hours) ? x : best), 6);
          const fc = t.forecastRaw(patientId, h * 60);
          const rd = t.riskAndDrivers(patientId);
          if (!fc) return { error: 'No forecast available yet.' };
          return {
            horizon_hours: h,
            lowest: { mgdl: Math.round(fc.lowest.v), at: clockIST(fc.lowest.t) },
            highest: { mgdl: Math.round(fc.highest.v), at: clockIST(fc.highest.t) },
            chance_of_low_pct: Math.round(fc.pLow * 100),
            in_range_pct: fc.inRangePct,
            risk_window: fc.riskWindow ? `${clockIST(fc.riskWindow.from)}–${clockIST(fc.riskWindow.to)}` : null,
            drivers: h >= 6 && rd ? rd.drivers.map((d) => `${d.text} (${d.effect} ${d.unit})`) : [],
          };
        },
      },
      simulate_dinner: {
        description:
          'Try a dinner on the twin: returns the peak after the meal, minutes above 180, the overnight lowest value and the chance of an overnight low, compared with the usual rice dinner.',
        schema: z.object({
          carbs_g: z.number().min(0).max(250).describe('Total carbohydrate of the dinner in grams'),
          absorption: z.enum(['fast', 'medium', 'slow']).describe('fast: white rice, sweets; slow: millets, dal; else medium'),
          walk_minutes: z.number().min(0).max(90).describe('Walk after dinner, minutes'),
          sleep_hours: z.number().min(3).max(11).describe('Sleep the night before, hours (use 7 if unknown)'),
          evening_metformin: z.enum(['taken', 'missed']),
        }),
        label: 'Trying it on your twin',
        run: (a: { carbs_g: number; absorption: keyof typeof SPEED; walk_minutes: number; sleep_hours: number; evening_metformin: 'taken' | 'missed' }) => {
          const r = t.whatIf(patientId, { meal: { carbs: a.carbs_g, speed: SPEED[a.absorption] }, portion: 1, walk: Math.round(a.walk_minutes), sleep: a.sleep_hours, med: a.evening_metformin });
          if (!r) return { error: 'No twin yet.' };
          return {
            verdict: { 'in-range': 'stays in range', brief: 'brief spike above 180', long: 'long spike above 180' }[verdict(r.result)],
            peak_mgdl: Math.round(r.result.peak),
            peak_after_min: r.result.peakT,
            minutes_above_180: r.result.aboveMin,
            overnight_lowest_mgdl: Math.round(r.result.overnightLow),
            chance_of_overnight_low_pct: Math.round(r.result.pLowOvernight * 100),
            usual_dinner_peak_mgdl: Math.round(r.usual.peak),
          };
        },
      },
      get_learned_physiology: {
        description: 'What the twin has learned about this person (meal peaks, walk effect, sleep effect, overnight lows) and how well it has predicted recently.',
        schema: z.object({}),
        label: 'Looking at what your twin has learned',
        run: () => {
          const s = t.twinSummary(patientId);
          return s ? { learned: s.insights.map((i) => `${i.text} ${i.value}`), fitted_on_days: s.days, recent_forecast_error_mgdl: { at_1h: s.trackRecord.h1, at_4h: s.trackRecord.h4 } } : { error: 'No twin yet.' };
        },
      },
      lookup_food: {
        description: 'Typical carbohydrate per serving for a common Indian food (approximate reference values).',
        schema: z.object({ food: z.string() }),
        label: 'Looking up the food',
        run: ({ food }: { food: string }) => {
          const f = matchFood(food);
          return f
            ? { name: f.name, serving: f.serving, carbs_g: f.carbs, absorption: f.speed >= 1.25 ? 'fast' : f.speed <= 0.9 ? 'slow' : 'medium' }
            : { error: 'Not in the reference table; estimate it yourself.', examples: FOODS.slice(0, 8).map((x) => x.name) };
        },
      },
    } as const;
    return tools;
  }

  /**
   * Streams an answer from the twin agent: a manual function-calling loop. Each model turn is
   * kept in the history exactly as received (thought signatures included); tool calls run
   * against this patient's twin and their results go back as function responses.
   */
  async chat(patientId: string, history: Content[], emit: (e: ChatStreamEvent) => void): Promise<string> {
    const p = this.twins.patient(patientId);
    if (!p) throw new Error('No such patient.');
    const tools = this.chatTools(patientId);
    const names = Object.keys(tools) as (keyof typeof tools)[];
    const declarations = names.map((name) => ({ name, description: tools[name].description, parametersJsonSchema: jsonSchema(tools[name].schema) }));
    const contents: Content[] = [...history];
    let final = '';

    for (let turn = 0; turn < 8; turn++) {
      const stream = await this.api.models.generateContentStream({
        model: config.aiModel,
        contents,
        config: { systemInstruction: chatSystem(p.name.split(' ')[0], p.language), tools: [{ functionDeclarations: declarations }], ...this.thinking('default') },
      });
      const parts: Part[] = [];
      const calls: FunctionCall[] = [];
      let finish: string | undefined;
      for await (const chunk of stream) {
        if (chunk.promptFeedback?.blockReason) {
          emit({ type: 'error', text: 'Your twin could not answer that one. Please ask your doctor.' });
          return final;
        }
        const cand = chunk.candidates?.[0];
        for (const part of cand?.content?.parts ?? []) {
          parts.push(part);
          if (part.functionCall) {
            calls.push(part.functionCall);
            const name = part.functionCall.name as keyof typeof tools;
            emit({ type: 'tool', tool: part.functionCall.name, label: tools[name]?.label ?? 'Asking the twin' });
          } else if (part.text && !part.thought) {
            final += part.text;
            emit({ type: 'text', text: part.text });
          }
        }
        finish = cand?.finishReason ?? finish;
      }
      if (finish && BLOCKED.has(finish)) {
        emit({ type: 'error', text: 'Your twin could not answer that one. Please ask your doctor.' });
        break;
      }
      if (calls.length === 0) break;
      if (finish === FinishReason.MAX_TOKENS) {
        emit({ type: 'error', text: 'That took too long to work out. Please try a shorter question.' });
        break;
      }
      contents.push({ role: 'model', parts });
      const responses: Part[] = calls.map((call) => {
        const tool = tools[call.name as keyof typeof tools];
        if (!tool) return { functionResponse: { id: call.id, name: call.name, response: { error: `Unknown tool ${call.name}` } } };
        const args = tool.schema.safeParse(call.args ?? {});
        if (!args.success) return { functionResponse: { id: call.id, name: call.name, response: { error: 'Invalid arguments', details: args.error.issues.map((i) => i.message) } } };
        const output = (tool.run as (a: unknown) => unknown)(args.data);
        return { functionResponse: { id: call.id, name: call.name, response: { output } } };
      });
      contents.push({ role: 'user', parts: responses });
    }
    return final;
  }
}

/** A real calendar date as YYYY-MM-DD, from ISO or day-first (Indian) formats; null when unreadable. */
export function isoDate(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  let ymd = m ? [+m[1], +m[2], +m[3]] : null;
  if (!ymd && (m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) ymd = [+m[3], +m[2], +m[1]];
  if (!ymd) return null;
  const [y, mo, d] = ymd;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function toMeal(out: z.infer<typeof MealSchema>): MealEstimate {
  if (!out.is_food) return { items: [], totalCarbs: 0, speed: 1, confidence: 'low', notes: out.notes || 'This does not look like food.', by: 'ai' };
  const items = out.items.map((i) => ({ name: i.name, quantity: i.quantity, carbs: Math.round(i.carbs_g), speed: SPEED[i.absorption] }));
  const total = items.reduce((a, i) => a + i.carbs, 0);
  const speed = total > 0 ? items.reduce((a, i) => a + i.carbs * i.speed, 0) / total : 1;
  return { items, totalCarbs: total, speed: Math.round(speed * 100) / 100, confidence: out.confidence, notes: out.notes, by: 'ai' };
}
