/** Request/response shapes shared by the API server and the web client. */
import type { Driver } from './twin/drivers';
import type { Insight } from './twin/insights';
import type { Risk } from './twin/triage';
import type { WhatIfResult } from './twin/whatif';

export type Role = 'patient' | 'clinician';
export type Lang = 'en' | 'hi' | 'kn';
export type Pronoun = 'he' | 'she' | 'they';
export type SourceId = 'cgm' | 'watch' | 'abha' | 'meals' | 'bp';
export type ConsentId = 'build' | 'care' | 'research';

export interface PatientSummary {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  age: number | null;
  yearsT2D: number | null;
  city: string | null;
  language: Lang;
  pronoun: Pronoun;
  medsShort: string;
  medsLong: string;
  avatar: string;
  abhaSuffix: string | null;
  dataMode: 'synthetic' | 'imported' | 'empty';
  synthetic: boolean;
  hasTwin: boolean;
}

export interface Me {
  user: { id: string; name: string; email: string; role: Role };
  patient: PatientSummary | null;
}

export interface ClockState {
  now: number;
  /** Simulated time in fractional epoch minutes. */
  exact: number;
  speed: number;
  paused: boolean;
  demoStart: number;
}

export interface Health {
  ok: true;
  ai: boolean;
  aiModel: string;
  clock: ClockState;
}

export interface SeriesPoint {
  t: number;
  v: number;
}

export interface BandPoint {
  t: number;
  lo: number;
  hi: number;
}

export interface Latest {
  t: number;
  mgdl: number;
  trend: 'rising' | 'falling' | 'steady';
  /** "falling, after a walk". */
  note: string;
}

export interface ForecastDTO {
  patientId: string;
  now: number;
  horizon: number;
  /** Chart window start (now − 6 h). */
  from: number;
  end: number;
  measured: SeriesPoint[];
  median: SeriesPoint[];
  band: BandPoint[];
  /** "If the bedtime snack is eaten" line, when a snack is planned. */
  scenario: SeriesPoint[] | null;
  /** Readouts for the line in effect (scenario if any). */
  readout: { lowest: SeriesPoint; inRangePct: number; pLow: number };
  riskWindow: { from: number; to: number } | null;
  meals: { t: number; label: string; compact: string; planned: boolean }[];
  walks: { from: number; to: number; label: string }[];
  sleep: { from: number; to: number; label: string } | null;
  latest: Latest | null;
  /** Real seconds since the latest reading arrived (demo clock aware). */
  lastReadingAgoSec: number | null;
  /** Calibration track record at this horizon: mean absolute error of past forecasts, mg/dL. */
  trackRecordMae: number | null;
}

export type AlertStatus = 'open' | 'snack' | 'team' | 'dismissed';

export interface AlertDTO {
  id: number;
  kind: 'predicted-low' | 'predicted-high' | 'cgm-low';
  issuedAt: number;
  status: AlertStatus;
  handledAt: number | null;
  windowFrom: number | null;
  windowTo: number | null;
  lowest: number | null;
  lowestAt: number | null;
  probability: number | null;
  drivers: Driver[];
  snackAt: number | null;
  /** Undo is possible until the planned snack time has passed. */
  canUndo: boolean;
}

export interface TwinSummaryDTO {
  fittedAt: number;
  days: number;
  rmse: number;
  mard: number;
  /** Mean absolute error of the twin's own back-tested forecasts at 1 h and 4 h, mg/dL. */
  trackRecord: { h1: number; h4: number; nights: number };
  insights: Insight[];
  inferredMeals: number;
}

export interface TodayDTO {
  inRangePct: number | null;
  steps: number | null;
  sleepMinutes: number | null;
  restingHr: number | null;
}

export interface OutlookDTO {
  labs: { date: string; value: number }[];
  estimate: number | null;
  projection: { keep: number; stop: number } | null;
  target: number;
}

export interface TimelineItem {
  id: number;
  t: number;
  kind: 'meal' | 'walk' | 'med' | 'sleep' | 'illness';
  title: string;
  note: string;
  source: string | null;
  inferred: boolean;
}

export interface TwinDashboardDTO {
  patient: PatientSummary;
  alert: AlertDTO | null;
  /** The twin's risk for the next 6 hours as of now (an alert keeps the numbers it was issued with). */
  risk: Risk | null;
  /** Connected data sources; the twin ignores logged meals while the meal log is off. */
  sources: Record<SourceId, boolean>;
  today: TodayDTO;
  twin: TwinSummaryDTO | null;
  outlook: OutlookDTO;
  timeline: TimelineItem[];
  unread: number;
}

export interface WhatIfRequest {
  meal: { carbs: number; speed: number; label?: string };
  portion: number;
  walk: number;
  sleep: number;
  med: 'taken' | 'missed';
}

export interface WhatIfDTO {
  result: WhatIfResult;
  usual: WhatIfResult;
  usualLabel: string;
  verdict: 'in-range' | 'brief' | 'long';
  deltaPeak: number;
}

export interface SavedScenarioDTO {
  id: number;
  input: WhatIfRequest;
  peak: number;
  aboveMin: number;
  createdAt: number;
}

export type ReviewStatus = 'new' | 'reviewed' | 'acted';
export type ActionEffect = 'snack' | 'call' | 'reminder' | 'checkin' | 'flag' | 'sensor' | 'ack';

export interface CarePatientDTO {
  patient: PatientSummary;
  latest: Latest | null;
  risk: Risk;
  drivers: string[];
  topDriver: string;
  facts: string[];
  review: ReviewStatus;
  reviewNote: string | null;
  action: { label: string; button: string; done: string; effect: ActionEffect };
  alert: AlertDTO | null;
}

export interface MessageDTO {
  id: number;
  sender: 'clinician' | 'twin' | 'patient';
  author: string;
  body: string;
  language: Lang;
  kind: string;
  sentAt: number;
  read: boolean;
}

export interface SourceStateDTO {
  sources: Record<SourceId, boolean>;
  consents: Record<ConsentId, boolean>;
  readiness: number;
  dataMode: PatientSummary['dataMode'];
  hasTwin: boolean;
  readings: number;
  days: number;
}

export interface RecordDTO {
  id: number;
  date: string;
  kind: 'lab' | 'medication';
  name: string;
  value: number | null;
  unit: string | null;
  detail: string | null;
  source: string;
}

/* ---------- AI ---------- */

export interface MealItem {
  name: string;
  quantity: string;
  carbs: number;
  speed: number;
}

export interface MealEstimate {
  items: MealItem[];
  totalCarbs: number;
  speed: number;
  confidence: 'low' | 'medium' | 'high';
  notes: string;
  /** 'ai' when Gemini produced it, 'offline' for the built-in food table. */
  by: 'ai' | 'offline';
}

export interface ExtractedRecords {
  reportDate: string | null;
  labs: { name: string; value: number; unit: string; date: string | null }[];
  medications: { name: string; dose: string; frequency: string }[];
  notes: string;
  by: 'ai' | 'offline';
}

export interface PlannedDinner {
  name: string;
  items: string;
  carbs: number;
  speed: number;
  why: string;
  peak: number;
  aboveMin: number;
  overnightLow: number;
  pLowOvernight: number;
}

export interface ChatStreamEvent {
  type: 'text' | 'tool' | 'done' | 'error';
  text?: string;
  tool?: string;
  label?: string;
}
