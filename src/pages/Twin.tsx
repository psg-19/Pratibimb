import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TimelineItem } from '../../shared/api';
import { clockIST, formatDuration, istMidnight } from '../../shared/time';
import { api } from '../api/client';
import { useAsync } from '../api/hooks';
import { useLive } from '../api/live';
import { useAuth } from '../auth/AuthContext';
import { PageLoading } from '../auth/RequireAuth';
import { AskTwin } from '../components/ai/AskTwin';
import { MealLogger } from '../components/ai/MealLogger';
import { TwinPair } from '../components/illustrations/TwinPair';
import { Chip } from '../components/ui/Chip';
import { TrendDown } from '../components/ui/icons';
import { Legend, type LegendItem } from '../components/ui/Legend';
import { ArrowLink } from '../components/ui/Links';
import { Segmented } from '../components/ui/Segmented';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePatientId } from '../hooks/usePatient';
import { AlertCard } from './twin/AlertCard';
import { GlucoseChart } from './twin/GlucoseChart';
import { Outlook } from './twin/Outlook';
import './twin.css';

const HORIZONS = [
  { value: 120, label: '2 h' },
  { value: 360, label: '6 h' },
  { value: 720, label: '12 h' },
] as const;
const H_LABEL: Record<number, string> = { 120: '2 h', 360: '6 h', 720: '12 h' };

export function Twin() {
  const { me, health } = useAuth();
  const patientId = usePatientId();
  const [horizon, setHorizon] = useState<number>(360);
  const [showMeals, setShowMeals] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [syncAgo, setSyncAgo] = useState<number | null>(null);
  const dash = useAsync(() => api.dashboard(patientId!), [patientId]);
  // No twin yet means no forecast to ask for.
  const fc = useAsync(() => api.forecast(patientId!, horizon), [patientId, horizon], !!dash.data?.patient.hasTwin);
  usePageTitle(dash.data ? `${dash.data.patient.firstName}'s twin` : 'Live twin');

  // Live updates: new readings, alerts, events and refits refresh the dashboard (at most once a second).
  const pending = useRef<number | null>(null);
  const refresh = () => {
    if (pending.current) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      dash.reload();
      fc.reload();
    }, 600);
  };
  useLive((e) => {
    if (e.type === 'reading') setSyncAgo(0);
    if (e.type === 'reading' || e.type === 'alert' || e.type === 'events' || e.type === 'twin' || e.type === 'message' || e.type === 'clock') refresh();
  }, patientId);
  useEffect(() => {
    if (fc.data?.lastReadingAgoSec != null) setSyncAgo((s) => (s == null || s > fc.data!.lastReadingAgoSec! ? fc.data!.lastReadingAgoSec : s));
  }, [fc.data]);
  useEffect(() => {
    const id = setInterval(() => setSyncAgo((s) => (s == null ? s : s + 1)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!patientId) return <NoPatient />;
  if (dash.error) return <ErrorBox message={dash.error.message} />;
  if (!dash.data) return <PageLoading label="Loading the twin…" />;
  const d = dash.data;
  const p = d.patient;
  if (!p.hasTwin) return <EmptyTwin name={p.firstName} self={me?.user.role === 'patient'} />;

  const f = fc.data;
  const viewer = me?.user.role === 'clinician' ? 'clinician' : 'patient';
  const now = f?.now ?? health?.clock.now ?? 0;
  const low = f ? f.readout.lowest.v < 70 : false;
  const legend: LegendItem[] = [
    { label: 'Measured', color: 'var(--ink)', width: 2 },
    { label: 'Twin forecast ± uncertainty', color: 'var(--accent)', width: 2, dash: 'dashed' },
    ...(f?.scenario ? [{ label: `If ${viewer === 'patient' ? 'you have' : `${p.firstName} has`} the bedtime snack`, color: 'var(--accent)', width: 3 }] : []),
    { label: 'Low threshold', color: 'var(--risk)', width: 2, dash: 'dashed' as const },
  ];
  const meta = [p.age ? String(p.age) : null, p.yearsT2D != null ? `Type 2 diabetes for ${p.yearsT2D} years` : 'Type 2 diabetes', p.medsLong || null, p.city].filter(Boolean).join(' · ');
  const fitted = d.twin ? `${clockIST(d.twin.fittedAt)} ${istMidnight(d.twin.fittedAt) === istMidnight(now) ? 'today' : 'yesterday'}` : '';

  const onAlert = async (action: 'snack' | 'team' | 'dismiss' | 'undo') => {
    if (!d.alert) return;
    await api.alertAction(p.id, d.alert.id, action);
    dash.reload();
    fc.reload();
  };

  return (
    <div className="wrap tw-main">
      {viewer === 'clinician' ? <PatientPicker current={p.id} /> : null}
      <div className="tw-head">
        <div className="tw-who">
          <div className="tw-who__icon" aria-hidden="true">
            <TwinPair />
          </div>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div className="tw-who__row">
              <h1 className="display tw-who__h1">{viewer === 'patient' ? 'Your twin' : `${p.name}’s twin`}</h1>
              {p.synthetic ? <span className="pill-tag tw-who__tag">Synthetic patient</span> : null}
              {p.dataMode === 'imported' ? <span className="pill-tag tw-who__tag">Imported CGM</span> : null}
            </div>
            <span className="tw-who__meta">{meta}</span>
          </div>
        </div>
        <div className="tw-status">
          <span className="tw-live">
            <span className="live-dot" aria-hidden="true">
              <span className="ping" />
              <span />
            </span>
            {p.dataMode === 'imported'
              ? `Imported · last reading ${f?.measured.length ? clockIST(f.measured[f.measured.length - 1].t) : '—'}`
              : syncAgo == null || !Number.isFinite(syncAgo)
                ? 'Live · waiting for CGM'
                : `Live · CGM synced ${formatAgo(syncAgo)} ago`}
          </span>
          {fitted ? <span>Twin re-fitted {fitted}</span> : null}
        </div>
      </div>

      <div className="tw-tools">
        <button type="button" className="btn btn-primary tw-tool" onClick={() => setMealOpen(true)}>
          Log a meal
        </button>
        <button type="button" className="btn btn-ghost tw-tool" onClick={() => setAskOpen(true)}>
          Ask {viewer === 'patient' ? 'your' : `${p.firstName}'s`} twin
          <span className="ai-badge">AI</span>
        </button>
        {viewer === 'patient' ? (
          <Link to="/messages" className="btn btn-ghost tw-tool">
            Messages{d.unread ? <span className="tw-badge">{d.unread}</span> : null}
          </Link>
        ) : null}
      </div>

      <div className="tw-top">
        <section aria-label="Glucose chart" className="card tw-chart-card">
          <div className="tw-chart-head">
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Glucose now · {clockIST(f?.latest?.t ?? now)}</span>
              <div className="tw-now-row">
                <span className="display tw-now-val">{f?.latest?.mgdl ?? '—'}</span>
                <span className="tw-now-unit">mg/dL</span>
                {f?.latest ? (
                  <span className="tw-now-trend">
                    {f.latest.trend === 'falling' ? <TrendDown /> : f.latest.trend === 'rising' ? <span style={{ transform: 'scaleY(-1)', display: 'inline-flex' }}><TrendDown /></span> : null}
                    {f.latest.note}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="tw-controls">
              <Segmented label="Forecast horizon" options={HORIZONS} value={horizon} onChange={setHorizon} size={{ minHeight: 38, padX: 14 }} />
              <Chip pressed={showMeals} onClick={() => setShowMeals((v) => !v)} on={{ border: 'var(--o-dot)', bg: 'var(--o-bg)' }}>
                Meals
              </Chip>
              <Chip pressed={showActivity} onClick={() => setShowActivity((v) => !v)} on={{ border: 'var(--g-dot)', bg: 'var(--g-bg)' }}>
                Activity &amp; sleep
              </Chip>
            </div>
          </div>

          {fc.error ? <p className="form-error" role="alert">{fc.error.message} <button type="button" className="btn btn-ghost" onClick={fc.reload}>Try again</button></p> : f ? <GlucoseChart fc={f} hLabel={H_LABEL[horizon]} showMeals={showMeals} showActivity={showActivity} /> : <div className="tw-chart-skel" aria-hidden="true" />}

          <div className="tw-chart-foot">
            <Legend items={legend} label="Chart legend" />
            {f ? (
              <div className="tw-readouts" aria-live="polite">
                <div className="stack">
                  <span className="label label--sm">Forecast low · next {H_LABEL[horizon]}</span>
                  <span className="tw-readout" style={{ color: low ? 'var(--risk)' : 'var(--ink)' }}>
                    {Math.round(f.readout.lowest.v)} mg/dL <span className="tw-readout__at">at {clockIST(f.readout.lowest.t)}</span>
                  </span>
                </div>
                <div className="stack">
                  <span className="label label--sm">In range · next {H_LABEL[horizon]}</span>
                  <span className="tw-readout">{f.readout.inRangePct}%</span>
                </div>
                {f.trackRecordMae != null ? (
                  <div className="stack">
                    <span className="label label--sm">Track record</span>
                    <span className="tw-readout tw-readout--sm">± {f.trackRecordMae} mg/dL</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <div className="tw-side">
          <AlertCard patient={p} alert={d.alert} risk={d.risk} forecast={f} horizon={horizon} viewer={viewer} onAction={onAlert} onLookAhead={() => setHorizon(360)} />
          <section aria-label="Today" className="tw-tiles">
            <Tile hue="g" label="In range today" value={d.today.inRangePct != null ? `${d.today.inRangePct}%` : '—'} note="70–180 mg/dL" />
            <Tile hue="o" label="Steps" value={d.today.steps != null ? d.today.steps.toLocaleString('en-IN') : '—'} note={d.today.steps != null ? 'since 06:00' : 'connect a watch'} />
            <Tile hue="b" label="Sleep last night" value={d.today.sleepMinutes != null ? hm(d.today.sleepMinutes) : '—'} note={d.today.sleepMinutes != null ? 'from watch' : 'connect a watch'} />
            <Tile hue="pk" label="Resting heart rate" value={d.today.restingHr != null ? `${d.today.restingHr} bpm` : '—'} note={d.today.restingHr != null ? '7-day average' : 'connect a watch'} />
          </section>
        </div>
      </div>

      <div className="tw-bottom">
        <section aria-labelledby="learned-h" className="tint-card hue-y tw-panel">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="learned-h" className="display tw-panel__h">
              What the twin has learned about {viewer === 'patient' ? 'you' : p.firstName}
            </h2>
            <span className="tw-panel__sub">From {d.twin?.days ?? 0} days of data · re-fitted nightly</span>
          </div>
          <dl className="tw-learned">
            {d.twin?.insights.map((l) => (
              <div key={l.id}>
                <dt>{l.text}</dt>
                <dd style={{ color: l.risk ? 'var(--risk-on-tint, var(--risk))' : 'var(--ink)' }}>{l.value}</dd>
              </div>
            ))}
          </dl>
          {d.twin ? (
            <p className="tw-foot">
              Fit error ± {d.twin.rmse} mg/dL ({d.twin.mard}% MARD). Back-tested on {d.twin.trackRecord.nights} evenings: ± {d.twin.trackRecord.h1} mg/dL at 1 h, ± {d.twin.trackRecord.h4} at 4 h.
              {d.twin.inferredMeals ? ` Found ${d.twin.inferredMeals} unlogged meals in the CGM.` : ''}
            </p>
          ) : null}
          <div>
            <ArrowLink to={viewer === 'clinician' ? `/simulate?patient=${p.id}` : '/simulate'}>Test a change on the twin</ArrowLink>
          </div>
        </section>

        <Outlook outlook={d.outlook} now={now} />

        <section aria-labelledby="events-h" className="tint-card hue-b tw-panel">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="events-h" className="display tw-panel__h">
              What the twin saw today
            </h2>
            <span className="tw-panel__sub">Inputs behind tonight’s forecast</span>
          </div>
          <Timeline items={d.timeline} patientId={p.id} onChange={() => dash.reload()} />
        </section>
      </div>

      <MealLogger
        patientId={p.id}
        language={p.language}
        aiEnabled={!!health?.ai}
        mealLog={d.sources.meals ? 'on' : viewer === 'patient' ? 'off' : 'off-other'}
        onConnectMealLog={async () => {
          await api.setSource(p.id, 'meals', true);
          dash.reload();
        }}
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        onSaved={() => {
          dash.reload();
          fc.reload();
        }}
      />
      <AskTwin key={p.id} patientId={p.id} firstName={p.firstName} open={askOpen} onClose={() => setAskOpen(false)} aiEnabled={!!health?.ai} />
    </div>
  );
}

function Timeline({ items, patientId, onChange }: { items: TimelineItem[]; patientId: string; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return <p className="tw-muted-p">Nothing logged yet today.</p>;
  const act = async (id: number, kind: 'confirm' | 'delete') => {
    setBusy(id);
    setError(null);
    try {
      if (kind === 'confirm') await api.confirmEvent(patientId, id);
      else await api.deleteEvent(patientId, id);
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update that event.'); }
    finally {
      setBusy(null);
    }
  };
  return (
    <>{error ? <p className="form-error" role="alert">{error}</p> : null}<ol className="tw-events">
      {items.map((e) => (
        <li key={`${e.id}-${e.t}`} className={e.inferred ? 'is-inferred' : undefined}>
          <span className="tw-events__time">{clockIST(e.t)}</span>
          <span className="stack" style={{ minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ fontSize: 15 }}>{e.title}</span>
            <span className="tw-events__note">{e.note}</span>
            {e.inferred ? (
              <span className="tw-events__acts">
                <button type="button" className="btn btn-ghost tw-mini hit" disabled={busy === e.id} onClick={() => void act(e.id, 'confirm')}>
                  Yes, I ate
                </button>
                <button type="button" className="btn btn-ghost tw-mini hit" disabled={busy === e.id} onClick={() => void act(e.id, 'delete')}>
                  No
                </button>
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol></>
  );
}

function Tile({ hue, label, value, note }: { hue: string; label: string; value: string; note: string }) {
  return (
    <div className={`tw-tile hue-${hue}`}>
      <span className="tw-tile__label">{label}</span>
      <span className="display tw-tile__value">{value}</span>
      <span className="tw-tile__note">{note}</span>
    </div>
  );
}

function PatientPicker({ current }: { current: string }) {
  const [, setParams] = useSearchParams();
  const care = useAsync(() => api.care(), []);
  return (
    <div className="tw-picker">
      <label htmlFor="tw-pick" className="label">
        Viewing
      </label>
      <select id="tw-pick" className="ml-select" value={current} onChange={(e) => setParams({ patient: e.target.value })}>
        {(care.data ?? []).map((c) => (
          <option key={c.patient.id} value={c.patient.id}>
            {c.patient.name} — {c.risk.level} risk
          </option>
        ))}
        {!care.data ? <option value={current}>{current}</option> : null}
      </select>
      <Link to="/care" className="text-link">
        Back to triage
      </Link>
    </div>
  );
}

function EmptyTwin({ name, self }: { name: string; self: boolean }) {
  return (
    <div className="wrap" style={{ paddingTop: 72, paddingBottom: 120, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
      <span className="eyebrow">Live twin</span>
      <h1 className="h-page">{self ? 'Your twin needs data and permission.' : `${name}’s twin is not available yet.`}</h1>
      <p className="lede">Connect a glucose monitor (or import an export) and build the twin — it needs at least a day of CGM data.</p>
      {self ? (
        <Link to="/connect" className="btn btn-primary btn-lg">
          Connect data
        </Link>
      ) : null}
    </div>
  );
}

function NoPatient() {
  return (
    <div className="wrap" style={{ paddingTop: 72, paddingBottom: 120 }}>
      <h1 className="h-page">No patient selected.</h1>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="wrap" style={{ paddingTop: 72, paddingBottom: 120 }}>
      <p className="form-error" role="alert">
        {message}
      </p>
    </div>
  );
}

const hm = (min: number) => `${Math.floor(min / 60)} h ${min % 60} m`;
function formatAgo(sec: number) {
  if (sec < 90) return `${Math.max(0, Math.round(sec))} s`;
  return formatDuration(sec / 60);
}
