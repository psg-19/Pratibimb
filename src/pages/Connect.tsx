import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ExtractedRecords, RecordDTO, SourceId, SourceStateDTO } from '../../shared/api';
import { api } from '../api/client';
import { useAsync } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { PageError, PageLoading } from '../auth/RequireAuth';
import { AiDataNote } from '../components/ai/AiDataNote';
import { TwinFigure } from '../components/illustrations/TwinFigure';
import { ArrowRight, Check, CheckDot, Lock, SourceGlyph, Spinner } from '../components/ui/icons';
import { CONSENTS, LEARNABLE_PARAMS, SOURCE_HUE, SOURCE_SHORT, SOURCES, SYNC_MS, type ConsentId, type SourceDef } from '../data/sources';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSimNow } from '../hooks/useSimNow';
import { BUILD_NOTE, buildBlocker, readinessScore, readinessStatus, ringSegments, STATUS_COPY } from '../model/readiness';
import './connect.css';

const RING_R = 64;
const RING_C = 2 * Math.PI * RING_R;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Connect() {
  usePageTitle('Connect data');
  const { me, health } = useAuth();
  const nav = useNavigate();
  const pid = me?.patient?.id ?? null;
  const state = useAsync(() => api.sources(pid!), [pid], !!pid);
  const [syncing, setSyncing] = useState<SourceId | null>(null);
  const [announce, setAnnounce] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<SourceStateDTO | null>(null);

  if (me?.user.role === 'clinician') {
    return (
      <div className="wrap" style={{ paddingTop: 72, paddingBottom: 120 }}>
        <h1 className="h-page">Patients connect their own data.</h1>
        <p className="lede" style={{ marginTop: 12 }}>
          Open the <Link to="/care">care-team view</Link> to see everyone’s twins.
        </p>
      </div>
    );
  }
  const s = local ?? state.data;
  if (state.error && !s) return <PageError message={state.error.message} retry={state.reload} />;
  if (!pid || !s) return <PageLoading />;

  const on = s.sources;
  const score = readinessScore(on);
  const status = readinessStatus(on, score);
  const blocker = buildBlocker(on, s.consents.build);

  const toggle = async (src: SourceDef) => {
    if (syncing || building) return;
    const next = !on[src.id];
    setError(null);
    setSyncing(src.id);
    setLocal({ ...s, sources: { ...on, [src.id]: next } });
    if (next) {
      setSyncing(src.id);
      setAnnounce(`${src.shortName}: syncing`);
    }
    try {
      const [res] = await Promise.all([api.setSource(pid, src.id, next), next ? wait(SYNC_MS) : Promise.resolve()]);
      setLocal(res);
      setAnnounce(`${src.shortName} ${next ? 'connected' : 'disconnected'}. Twin readiness ${res.readiness}%.`);
    } catch (e) {
      setLocal(s);
      setError(e instanceof Error ? e.message : 'Could not change that source.');
    } finally {
      setSyncing((x) => (x === src.id ? null : x));
    }
  };
  const setConsent = async (id: ConsentId) => {
    setError(null);
    try {
      const res = await api.setConsents(pid, { [id]: !s.consents[id] });
      setLocal(res);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update consent.'); }
  };
  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      await api.build(pid);
      nav('/twin');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the twin.');
      setBuilding(false);
    }
  };

  return (
    <div className="wrap cn-main">
      <div className="cn-head">
        <span className="eyebrow">Build your twin · step 1 of 2</span>
        <h1 className="display cn-h1">Give your twin something to learn from.</h1>
        <p className="cn-lede">
          Each source teaches the model something different about how your body handles food, movement and sleep. You can pause any of them later, and nothing is
          shared until you say so below.
        </p>
      </div>

      <div className="cn-body">
        <div className="cn-left">
          {SOURCES.map((src) => (
            <SourceCard key={src.id} src={src} on={on[src.id]} syncing={syncing === src.id} disabled={!!syncing || building} onToggle={() => void toggle(src)} note={src.id === 'cgm' && on.cgm ? dataNote(s) : undefined} />
          ))}
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>

          <ImportCard pid={pid} onImported={(st) => setLocal(st)} />
          <RecordsCard pid={pid} aiEnabled={!!health?.ai} />

          <fieldset className="cn-consent">
            <legend className="display cn-consent__legend">How your data is used</legend>
            {CONSENTS.map((c) => (
              <label key={c.id} className="cn-consent__opt">
                <input type="checkbox" checked={s.consents[c.id]} disabled={building || !!syncing} onChange={() => void setConsent(c.id)} />
                <span className="stack" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>{c.title}</span>
                  <span className="cn-consent__note">{c.note}</span>
                </span>
              </label>
            ))}
            <p className="cn-consent__foot">Change these choices here at any time. This local demo stores data on this computer. Device connections are simulated; CSV imports and saved records are stored locally.</p>
          </fieldset>

          <div className="cn-cta">
            <span id="build-note" className="cn-cta__note" style={{ color: blocker ? 'var(--risk)' : 'var(--muted)' }} aria-live="polite">
              {building ? 'Fitting your twin: finding unlogged meals, learning your physiology, back-testing its forecasts…' : error ?? BUILD_NOTE[blocker ?? 'ok']}
            </span>
            {blocker ? (
              <button type="button" className="btn cn-cta__btn cn-cta__btn--locked" aria-disabled="true" aria-describedby="build-note">
                Build my twin
              </button>
            ) : (
              <button type="button" className="btn btn-primary cn-cta__btn" aria-describedby="build-note" disabled={building || !!syncing} onClick={() => void build()}>
                {building ? <Spinner /> : null}
                {s.hasTwin ? 'Re-fit my twin' : 'Build my twin'}
                {building ? null : <ArrowRight />}
              </button>
            )}
          </div>
          {s.hasTwin ? (
            <p className="cn-consent__foot">
              Your twin is already built.{' '}
              <Link to="/twin" className="tap-link">
                Open it
              </Link>{' '}
              — it re-fits itself every night at 03:00.
            </p>
          ) : null}
        </div>

        <aside aria-label="Twin readiness" className="card cn-aside">
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Twin readiness</span>
            <span className="display cn-aside__title">{STATUS_COPY[status].title}</span>
          </div>
          <div className="cn-ring-row">
            <ReadinessRing on={on} score={score} />
            <p className="cn-ring-note">{STATUS_COPY[status].note}</p>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">Your twin, taking shape</span>
            <div className="cn-figure">
              <TwinFigure on={on} score={score} />
              <ul className="cn-figure__legend" aria-label="Figure legend">
                {SOURCES.map((src) => (
                  <li key={src.id} style={{ color: on[src.id] ? 'var(--ink)' : 'var(--dim)' }}>
                    <span aria-hidden="true" style={{ background: on[src.id] ? `var(--${src.hue}-dot)` : 'var(--grid)' }} />
                    {src.figureName}
                    <span className="sr-only">{on[src.id] ? ' (connected)' : ' (not connected)'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label" id="learn-h">
              What the twin can learn
            </span>
            <ul className="cn-params" aria-labelledby="learn-h">
              {LEARNABLE_PARAMS.map((p) => {
                const ok = on[p.source];
                return (
                  <li key={p.name} style={{ color: ok ? 'var(--ink)' : 'var(--dim)' }}>
                    {ok ? <CheckDot color={`var(--${SOURCE_HUE[p.source]}-ink)`} /> : <Lock />}
                    <span style={{ flex: '1 1 auto' }}>{p.name}</span>
                    <span className="cn-params__state">{ok ? `from ${SOURCE_SHORT[p.source]}` : `needs ${SOURCE_SHORT[p.source]}`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function dataNote(s: SourceStateDTO) {
  if (!s.readings) return undefined;
  const kind = s.dataMode === 'imported' ? 'imported' : s.dataMode === 'synthetic' ? 'from the demo sensor' : '';
  return `${s.readings.toLocaleString('en-IN')} readings over ${s.days} days ${kind}`.trim();
}

function SourceCard({ src, on, syncing, disabled, onToggle, note }: { src: SourceDef; on: boolean; syncing: boolean; disabled: boolean; onToggle: () => void; note?: string }) {
  const label = syncing ? 'Syncing…' : on ? 'Connected' : 'Connect';
  return (
    <div className={`cn-src hue-${src.hue}${on ? ' is-on' : ''}`}>
      <div className="cn-src__icon">
        <SourceGlyph id={src.id} />
      </div>
      <div className="cn-src__text">
        <div className="cn-src__name-row">
          <span className="cn-src__name">{src.name}</span>
          {src.tag ? <span className="pill-tag cn-src__tag">{src.tag}</span> : null}
        </div>
        <span className="cn-src__desc">{src.description}</span>
        <span className="cn-src__teaches">{note ?? src.teaches}</span>
      </div>
      <button type="button" className="cn-src__btn" aria-pressed={on} aria-label={`${src.shortName}: ${label}`} onClick={onToggle} disabled={disabled}>
        {syncing ? <Spinner /> : on ? <Check /> : null}
        <span>{label}</span>
      </button>
    </div>
  );
}

function ImportCard({ pid, onImported }: { pid: string; onImported: (s: SourceStateDTO) => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="cn-extra hue-b" aria-labelledby="import-h">
      <h2 id="import-h" className="display cn-extra__h">
        Bring your own CGM data
      </h2>
      <p className="cn-src__desc">Export a CSV from Dexcom Clarity or LibreView (or any file with time and glucose columns). The export is replayed so its last day lines up with today. Importing replaces the previous sensor readings, demo context and fitted twin. Manually added records and meals are kept; rebuild the twin after importing.</p>
      <label className="field">
        <span>CGM export (.csv)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setMsg(null);
            try {
              const r = await api.importCgm(pid, f);
              setMsg({ ok: true, text: `Imported ${r.count.toLocaleString('en-IN')} readings (${r.format}) over ${r.days} days — last reading ${r.lastReading}.` });
              onImported(r.state);
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not import that file.' });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {msg ? (
        <p className={msg.ok ? 'notice' : 'form-error'} role="status">
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}

function RecordsCard({ pid, aiEnabled }: { pid: string; aiEnabled: boolean }) {
  const records = useAsync(() => api.records(pid), [pid]);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<ExtractedRecords | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({ date: '', value: '' });
  // Undated results default to the demo's (simulated) date in IST, not the computer's date.
  const sim = useSimNow(60_000);
  const today = sim != null ? new Date((sim + 330) * 60_000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const rows: Omit<RecordDTO, 'id' | 'source'>[] = found
    ? [
        ...found.labs.map((l) => ({ date: l.date ?? found.reportDate ?? today, kind: 'lab' as const, name: l.name, value: l.value, unit: l.unit, detail: null })),
        ...found.medications.map((m) => ({ date: found.reportDate ?? today, kind: 'medication' as const, name: m.name, value: null, unit: null, detail: [m.dose, m.frequency].filter(Boolean).join(', ') })),
      ]
    : [];

  return (
    <section className="cn-extra hue-y" aria-labelledby="records-h">
      <h2 id="records-h" className="display cn-extra__h">
        Health records
      </h2>
      <p className="cn-src__desc">The twin uses HbA1c and your medicine list as its starting point. Upload a lab report or prescription and review what was read before saving.</p>
      {records.data && records.data.length ? (
        <ul className="cn-records">
          {records.data.slice(0, 6).map((r) => (
            <li key={r.id}>
              <span className="mono cn-records__date">{r.date}</span>
              <span>
                {r.name}
                {r.value != null ? ` ${r.value}${r.unit ? ` ${r.unit}` : ''}` : ''}
                {r.detail ? ` — ${r.detail}` : ''}
              </span>
              <span className="cn-records__src">{r.source}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {aiEnabled ? (
        <>
          <label className="field">
            <span>
              Lab report or prescription (PDF or photo) <span className="ai-badge">AI reads it</span>
            </span>
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                setError(null);
                setFound(null);
                try {
                  const r = await api.extractRecords(pid, f);
                  setFound(r);
                  setKeep(new Array(r.labs.length + r.medications.length).fill(true));
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not read that document.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <AiDataNote what="The document" />
        </>
      ) : null}
      {(
        <form
          className="cn-manual"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Number(manual.value);
            if (!manual.date || !(v > 3 && v < 20)) {
              setError('Enter the test date and an HbA1c between 3 and 20 %.');
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await api.saveRecords(pid, [{ date: manual.date, kind: 'lab', name: 'HbA1c', value: v, unit: '%', detail: null }], 'Entered by patient');
              setManual({ date: '', value: '' });
              records.reload();
            } catch (err) { setError(err instanceof Error ? err.message : 'Could not save that result.'); }
            finally { setBusy(false); }
          }}
        >
          <label className="field">
            <span>HbA1c test date</span>
            <input type="date" value={manual.date} onChange={(e) => setManual((m) => ({ ...m, date: e.target.value }))} />
          </label>
          <label className="field">
            <span>HbA1c (%)</span>
            <input inputMode="decimal" value={manual.value} onChange={(e) => setManual((m) => ({ ...m, value: e.target.value }))} />
          </label>
          <button type="submit" className="btn btn-ghost cn-manual__btn" disabled={busy}>
            Add result
          </button>
        </form>
      )}
      {busy ? <p className="notice" role="status">Working on your records…</p> : null}
      {records.error ? <p className="form-error" role="alert">{records.error.message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {found ? (
        <div className="cn-found">
          <p className="cn-src__desc">{rows.length ? 'Tick what to add to your record:' : found.notes || 'Nothing to add was found.'}</p>
          {rows.map((r, i) => (
            <label key={i} className="cn-consent__opt">
              <input type="checkbox" checked={keep[i] ?? false} onChange={() => setKeep((k) => k.map((x, j) => (j === i ? !x : x)))} />
              <span>
                <span className="mono cn-records__date">{r.date}</span> {r.name}
                {r.value != null ? ` ${r.value} ${r.unit ?? ''}` : ''}
                {r.detail ? ` — ${r.detail}` : ''}
              </span>
            </label>
          ))}
          {rows.length ? (
            <button
              type="button"
              className="btn btn-primary cn-manual__btn"
              disabled={busy || !keep.some(Boolean)}
              onClick={async () => {
                const chosen = rows.filter((_, i) => keep[i]);
                if (!chosen.length) return;
                setBusy(true);
                setError(null);
                try {
                  await api.saveRecords(pid, chosen, 'Uploaded document (read by AI)');
                  setFound(null);
                  records.reload();
                } catch (err) { setError(err instanceof Error ? err.message : 'Could not save those records.'); }
                finally { setBusy(false); }
              }}
            >
              Save to my record
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReadinessRing({ on, score }: { on: Record<SourceId, boolean>; score: number }) {
  const segs = ringSegments(on, RING_C);
  return (
    <div className="cn-ring">
      <svg width="150" height="150" viewBox="0 0 160 160" role="img" aria-label={`Readiness ${score} percent`}>
        <circle cx="80" cy="80" r={RING_R} fill="none" style={{ stroke: 'var(--grid)' }} strokeWidth="12" />
        {segs.map((s) => (
          <circle
            key={s.id}
            className="cn-ring__seg"
            cx="80"
            cy="80"
            r={RING_R}
            fill="none"
            style={{ stroke: `var(--${SOURCE_HUE[s.id]}-dot)` }}
            strokeWidth="12"
            strokeDasharray={`${s.length.toFixed(1)} ${RING_C.toFixed(1)}`}
            strokeDashoffset={(-s.start).toFixed(1)}
            transform="rotate(-90 80 80)"
          />
        ))}
      </svg>
      <div className="cn-ring__center" aria-hidden="true">
        <span className="display">
          {score}
          <span className="cn-ring__pct">%</span>
        </span>
      </div>
    </div>
  );
}
