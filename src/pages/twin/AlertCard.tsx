import { useEffect, useRef, useState } from 'react';
import type { AlertDTO, ForecastDTO, Lang, PatientSummary } from '../../../shared/api';
import type { Risk } from '../../../shared/twin/triage';
import { clockIST } from '../../../shared/time';
import { api } from '../../api/client';
import { CheckCircle, Warning } from '../../components/ui/icons';

type Card = 'risk' | 'high' | 'cgm' | 'info' | 'clear' | 'handled';
const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'kn', label: 'ಕನ್ನಡ' },
];

function cardFor(alert: AlertDTO | null, horizon: number): Card {
  if (!alert) return horizon >= 360 ? 'clear' : 'info';
  if (alert.status !== 'open') return 'handled';
  if (alert.kind === 'cgm-low') return 'cgm';
  if (alert.kind === 'predicted-high') return 'high';
  return horizon >= 360 ? 'risk' : 'info';
}

interface Props {
  patient: PatientSummary;
  alert: AlertDTO | null;
  /** The twin's risk as of now; an alert keeps the numbers it was issued with. */
  risk: Risk | null;
  forecast: ForecastDTO | null;
  horizon: number;
  viewer: 'patient' | 'clinician';
  onAction: (action: 'snack' | 'team' | 'dismiss' | 'undo') => Promise<void>;
  onLookAhead: () => void;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** One line on how the live forecast differs from the alert's issued numbers, or null when it hardly does. */
function sinceIssued(alert: AlertDTO, risk: Risk | null): string | null {
  if (!risk || alert.status !== 'open' || alert.kind === 'cgm-low') return null;
  const issued = Math.round((alert.probability ?? 0) * 100);
  const now = Math.round(risk.probability * 100);
  const same = (alert.kind === 'predicted-low' && risk.kind === 'low') || (alert.kind === 'predicted-high' && risk.kind === 'high');
  if (same && Math.abs(now - issued) < 10) return null;
  if (risk.kind === 'stable') return `Since it was issued, the forecast has settled: ${lowerFirst(risk.window)}.`;
  if (same) return `Latest forecast: ${now}% chance — ${lowerFirst(risk.window)}.`;
  return `Latest forecast: ${lowerFirst(risk.title)} — ${now}% chance.`;
}

export function AlertCard({ patient, alert, risk, forecast, horizon, viewer, onAction, onLookAhead }: Props) {
  const card = cardFor(alert, horizon);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prev = useRef(card);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ text: string; by: string } | null>(null);
  const [lang, setLang] = useState<Lang>(patient.language);

  useEffect(() => {
    if (prev.current !== card) headingRef.current?.focus();
    prev.current = card;
    setExplain(null);
  }, [card]);

  const act = async (a: 'snack' | 'team' | 'dismiss' | 'undo') => {
    setBusy(true);
    setError(null);
    try {
      await onAction(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };
  const loadExplain = async () => {
    setExplain({ text: 'Asking the twin…', by: '' });
    try {
      setExplain(await api.explain(patient.id, lang));
    } catch (e) {
      setExplain({ text: e instanceof Error ? e.message : 'Could not explain right now.', by: '' });
    }
  };
  const first = patient.firstName;
  const pron = patient.pronoun === 'he' ? 'he' : patient.pronoun === 'she' ? 'she' : 'they';

  const ExplainBlock = (
    <div className="tw-explain">
      <div className="tw-explain__row">
        <label className="sr-only" htmlFor="explain-lang">
          Language
        </label>
        <select id="explain-lang" className="tw-explain__lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost tw-explain__btn" onClick={() => void loadExplain()}>
          Explain this simply
        </button>
      </div>
      {explain ? (
        <p className="tw-explain__text" aria-live="polite" lang={lang}>
          {explain.text} {explain.by === 'ai' ? <span className="ai-badge">AI</span> : null}
        </p>
      ) : null}
    </div>
  );

  if (card === 'risk' && alert) {
    const p = Math.round((alert.probability ?? 0) * 100);
    return (
      <section className="rise tw-alert" aria-labelledby="alert-h">
        <div className="tw-alert__kicker">
          <Warning />
          <span>Forecast · issued {clockIST(alert.issuedAt)}</span>
        </div>
        <h2 id="alert-h" ref={headingRef} tabIndex={-1} className="display tw-alert__h">
          Likely low tonight, while {viewer === 'patient' ? 'you sleep' : `${pron} sleeps`}
        </h2>
        <p className="tw-alert__lede">
          The twin expects glucose to fall below 70 mg/dL
          {alert.windowFrom && alert.windowTo ? ` between ${clockIST(alert.windowFrom)} and ${clockIST(alert.windowTo)}` : ' overnight'}, lowest around {Math.round(alert.lowest ?? 0)}
          {alert.lowestAt ? ` at ${clockIST(alert.lowestAt)}` : ''}.
        </p>
        <Chance p={p} label="Chance of a low" />
        <Why drivers={alert.drivers.map((d) => d.text)} />
        <Since text={sinceIssued(alert, risk)} />
        <div className="tw-alert__actions">
          <button type="button" className="btn btn-risk tw-alert__btn" style={{ flex: '1 1 auto' }} disabled={busy} onClick={() => void act('snack')}>
            {viewer === 'patient' ? 'Plan a bedtime snack' : 'Suggest a bedtime snack'}
          </button>
          <button type="button" className="btn tw-alert__btn tw-alert__team" style={{ flex: '1 1 auto' }} disabled={busy} onClick={() => void act('team')}>
            Alert care team
          </button>
          <button type="button" className="btn tw-alert__btn tw-alert__dismiss" disabled={busy} onClick={() => void act('dismiss')}>
            Dismiss
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {ExplainBlock}
      </section>
    );
  }

  if (card === 'high' && alert) {
    const p = Math.round((alert.probability ?? 0) * 100);
    return (
      <section className="rise tw-alert" aria-labelledby="alert-h">
        <div className="tw-alert__kicker">
          <Warning />
          <span>Forecast · issued {clockIST(alert.issuedAt)}</span>
        </div>
        <h2 id="alert-h" ref={headingRef} tabIndex={-1} className="display tw-alert__h">
          Likely high tonight
        </h2>
        <p className="tw-alert__lede">
          The twin expects glucose to stay above 180 mg/dL for much of the night, peaking near {Math.round(alert.lowest ?? 0)}
          {alert.lowestAt ? ` around ${clockIST(alert.lowestAt)}` : ''}.
        </p>
        <Chance p={p} label="Chance of a long high" />
        <Why drivers={alert.drivers.map((d) => d.text)} />
        <Since text={sinceIssued(alert, risk)} />
        <div className="tw-alert__actions">
          <button type="button" className="btn btn-risk tw-alert__btn" style={{ flex: '1 1 auto' }} disabled={busy} onClick={() => void act('team')}>
            Alert care team
          </button>
          <button type="button" className="btn tw-alert__btn tw-alert__dismiss" disabled={busy} onClick={() => void act('dismiss')}>
            Dismiss
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {ExplainBlock}
      </section>
    );
  }

  if (card === 'cgm' && alert) {
    return (
      <section className="rise tw-alert tw-alert--now" aria-labelledby="alert-h" role="alert">
        <div className="tw-alert__kicker">
          <Warning />
          <span>CGM alarm · {clockIST(alert.issuedAt)}</span>
        </div>
        <h2 id="alert-h" ref={headingRef} tabIndex={-1} className="display tw-alert__h">
          Low now: {Math.round(alert.lowest ?? 0)} mg/dL
        </h2>
        <p className="tw-alert__lede">
          Treat it the way {viewer === 'patient' ? 'your' : `${first}'s`} doctor taught — for example 15 g of fast sugar — and check again in 15 minutes. If
          {viewer === 'patient' ? ' you feel' : ` ${pron} feels`} unwell, call the doctor or emergency services.
        </p>
        <div className="tw-alert__actions">
          <button type="button" className="btn btn-risk tw-alert__btn" disabled={busy} onClick={() => void act('dismiss')}>
            Acknowledge
          </button>
        </div>
      </section>
    );
  }

  if (card === 'handled' && alert) {
    const at = alert.handledAt ? clockIST(alert.handledAt) : '';
    const copy =
      alert.status === 'snack'
        ? viewer === 'patient'
          ? { tag: `Snack planned · ${at}`, title: 'Bedtime snack planned', note: 'Have a small snack before bed — a glass of milk or a banana. The forecast now shows the night with the snack; the twin keeps checking.' }
          : { tag: `Sent to ${first} · ${at}`, title: 'Bedtime snack suggested', note: '“Have a small snack before bed — a glass of milk or a banana.” The forecast now shows the night with the snack; the twin keeps checking.' }
        : alert.status === 'team'
          ? { tag: `Care team notified · ${at}`, title: 'Dr. [CLINICIAN NAME] has the forecast', note: `They see the predicted window, the ${Math.round((alert.probability ?? 0) * 100)}% chance and the drivers. ${viewer === 'patient' ? 'You are' : `${first} is`} not woken unless the risk rises.` }
          : { tag: `Dismissed · ${at}`, title: 'Alert dismissed', note: 'The twin keeps watching and will alert again if the forecast changes.' };
    return (
      <section className="rise tw-done" aria-labelledby="done-h">
        <div className="tw-done__kicker">
          <CheckCircle />
          <span>{copy.tag}</span>
        </div>
        <h2 id="done-h" ref={headingRef} tabIndex={-1} className="display tw-card-h" aria-live="polite">
          {copy.title}
        </h2>
        <p className="tw-muted-p">{copy.note}</p>
        <button type="button" className="btn btn-ghost tw-undo" disabled={busy || !alert.canUndo} onClick={() => void act('undo')}>
          Undo
        </button>
        {!alert.canUndo ? <p className="tw-muted-p" style={{ fontSize: 13 }}>The snack time has passed.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>
    );
  }

  // No alert at this horizon.
  const settles = forecast?.median.at(-1)?.v;
  const low = forecast?.readout.lowest.v;
  return (
    <section className="rise card tw-info" aria-labelledby="info-h">
      <span className="label">Forecast · next {horizon / 60} h</span>
      <h2 id="info-h" ref={headingRef} tabIndex={-1} className="display tw-card-h">
        {alert && card === 'info' ? 'Nothing flagged in the next 2 hours' : 'Nothing flagged tonight'}
      </h2>
      <p className="tw-muted-p">
        {settles ? `Glucose settles towards ${Math.round(settles / 5) * 5} mg/dL.` : ''}
        {alert && card === 'info' ? ' The overnight risk sits beyond this horizon.' : low && low > 70 ? ` The lowest the twin expects is ${Math.round(low)} mg/dL.` : ''}
      </p>
      {alert && card === 'info' ? (
        <button type="button" className="btn tw-look" onClick={onLookAhead}>
          Look 6 hours ahead
        </button>
      ) : null}
    </section>
  );
}

function Since({ text }: { text: string | null }) {
  return text ? (
    <p className="tw-alert__since" aria-live="polite">
      {text}
    </p>
  ) : null;
}

function Chance({ p, label }: { p: number; label: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="tw-alert__prob">
        <span id="prob-l">{label}</span>
        <span className="mono" style={{ color: 'var(--risk-deep)' }}>
          {p}%
        </span>
      </div>
      <div className="tw-alert__track" role="meter" aria-labelledby="prob-l" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-valuetext={`${p}%`}>
        <div style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function Why({ drivers }: { drivers: string[] }) {
  if (drivers.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label label--sm" style={{ color: 'var(--risk-dim)' }}>
        Why the twin thinks so
      </span>
      <ul className="tw-alert__why">
        {drivers.map((d) => (
          <li key={d}>
            <span aria-hidden="true" />
            {d}
          </li>
        ))}
      </ul>
    </div>
  );
}
