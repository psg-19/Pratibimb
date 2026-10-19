import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CarePatientDTO, Lang, ReviewStatus } from '../../shared/api';
import type { RiskLevel } from '../../shared/twin/triage';
import { clockIST } from '../../shared/time';
import { api } from '../api/client';
import { useAsync } from '../api/hooks';
import { useLive } from '../api/live';
import { simNow, useAuth } from '../auth/AuthContext';
import { PageError, PageLoading } from '../auth/RequireAuth';
import { TwinRow } from '../components/illustrations/TwinRow';
import { Chip } from '../components/ui/Chip';
import { ArrowLink } from '../components/ui/Links';
import { Segmented } from '../components/ui/Segmented';
import { usePageTitle } from '../hooks/usePageTitle';
import './care.css';

type Sort = 'risk' | 'reading';
type Filter = 'all' | 'high' | 'open';

const SORTS = [
  { value: 'risk', label: 'Predicted risk' },
  { value: 'reading', label: 'Latest reading' },
] as const;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'High risk' },
  { id: 'open', label: 'Not reviewed' },
];
const REVIEW_LABEL: Record<ReviewStatus, string> = { new: 'Not reviewed', reviewed: 'Reviewed', acted: 'Action sent' };
const LEVEL: Record<RiskLevel, { bg: string; fg: string; border: string; color: string; bar: string; boxBg: string; boxBorder: string }> = {
  High: { bg: 'var(--risk)', fg: 'var(--card)', border: 'var(--risk)', color: 'var(--risk-on-tint, var(--risk))', bar: 'var(--risk)', boxBg: 'var(--risk-wash)', boxBorder: 'var(--risk-line)' },
  Medium: { bg: 'transparent', fg: 'var(--risk-deep)', border: 'var(--warn-line)', color: 'var(--risk-deep)', bar: 'var(--warn)', boxBg: 'var(--warn-wash)', boxBorder: 'var(--warn-soft)' },
  Low: { bg: 'var(--g-bg)', fg: 'var(--g-ink)', border: 'var(--g-dot)', color: 'var(--g-ink)', bar: 'var(--g-dot)', boxBg: 'var(--g-bg)', boxBorder: 'var(--g-mid)' },
};
const inRange = (v: number) => v >= 70 && v <= 180;

function hiddenLows(list: CarePatientDTO[]) {
  return list
    .filter((c) => c.latest && inRange(c.latest.mgdl) && c.risk.kind === 'low' && c.risk.level !== 'Low')
    .sort((a, b) => b.risk.probability - a.risk.probability);
}
function callout(list: CarePatientDTO[]) {
  const h = hiddenLows(list);
  if (!h.length) return null;
  const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
  const names = join(h.map((c) => c.patient.firstName));
  const probs = join(h.map((c) => `${Math.round(c.risk.probability * 100)}%`));
  return h.length === 1
    ? `By latest reading, ${names} looks in range right now. Their twin forecasts a low tonight — ${probs} likely.`
    : `By latest reading, ${names} look in range right now. Their twins forecast lows tonight — ${probs} likely.`;
}

export function Care() {
  usePageTitle('Care team');
  const { me, health, healthAt } = useAuth();
  const care = useAsync(() => api.care(), []);
  // Simulated time of the latest refresh of the list.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const clock = useRef({ health, healthAt });
  clock.current = { health, healthAt };
  useEffect(() => {
    if (care.data) setUpdatedAt(simNow(clock.current.health, clock.current.healthAt));
  }, [care.data]);
  const [sort, setSort] = useState<Sort>('risk');
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const pending = useRef<number | null>(null);

  useLive((e) => {
    if (e.type === 'hello' || e.type === 'ping') return;
    if (pending.current) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      care.reload();
    }, 1500);
  });

  if (!care.data) return care.error ? <PageError message={care.error.message} retry={care.reload} /> : <PageLoading label="Asking every twin…" />;
  const all = care.data;
  const byRisk = sort === 'risk';
  const sorted = [...all].sort((a, b) => (byRisk ? b.risk.probability - a.risk.probability || levelRank(b) - levelRank(a) : (b.latest?.mgdl ?? 0) - (a.latest?.mgdl ?? 0)));
  const rows = sorted.filter((c) => (filter === 'high' ? c.risk.level === 'High' : filter === 'open' ? c.review === 'new' : true));
  const counts = { all: all.length, high: all.filter((c) => c.risk.level === 'High').length, open: all.filter((c) => c.review === 'new').length };
  const cur = rows.find((c) => c.patient.id === sel) ?? rows[0];
  const note = callout(all);

  const pick = (id: string) => {
    setSel(id);
    const panel = panelRef.current;
    const list = listRef.current;
    if (panel && list && panel.offsetTop > list.offsetTop + 40) {
      panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  };
  const setStatus = async (id: string, status: ReviewStatus) => {
    const updated = await api.review(id, status);
    care.reload();
    return updated;
  };

  return (
    <div className="wrap cr-main">
      <div className="cr-head">
        <div className="cr-head__copy">
          <span className="eyebrow">Care team · {me?.user.name ?? 'Dr. [CLINICIAN NAME]'} · [CLINIC NAME]</span>
          <h1 className="h-page">Who needs you tonight?</h1>
          <p className="lede">Patients ranked by what their twins predict for the next six hours — not only by their last reading.</p>
        </div>
        <div className="cr-head__art">
          <TwinRow levels={[...all].sort((a, b) => b.risk.probability - a.risk.probability).map((c) => c.risk.level)} />
          <span className="cr-head__meta">
            {all.length} patients · synthetic{updatedAt != null ? ` · updated ${clockIST(updatedAt)} IST` : ''}
          </span>
        </div>
      </div>

      <div className="cr-bar">
        <div className="cr-sort">
          <span className="cr-sort__label">Sort by</span>
          <Segmented label="Sort patients" options={SORTS} value={sort} onChange={setSort} track="card" />
        </div>
        <div role="group" aria-label="Filter patients" className="cr-filters">
          {FILTERS.map((f) => (
            <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)} on={{ border: 'var(--accent)', bg: 'var(--tint)' }} style={{ padding: '0 16px' }}>
              {f.label} <span className="mono cr-count">{counts[f.id]}</span>
            </Chip>
          ))}
        </div>
      </div>

      {!byRisk && note ? (
        <div className="rise cr-callout" role="note">
          <span className="cr-callout__text">{note}</span>
          <button type="button" className="btn btn-risk cr-callout__btn" onClick={() => setSort('risk')}>
            Sort by predicted risk
          </button>
        </div>
      ) : null}

      <div className="cr-body">
        <section aria-label="Patients" className="card cr-list" ref={listRef}>
          <div className="cr-list__inner">
            <div className="cr-grid cr-list__head" aria-hidden="true">
              <span>Patient</span>
              <span>Now</span>
              <span>{byRisk ? 'Next 6 h forecast' : 'Status by reading'}</span>
              <span>Top driver</span>
              <span>Review</span>
            </div>
            <ul className="cr-rows">
              {rows.map((c) => (
                <li key={c.patient.id}>
                  <PatientRow c={c} byRisk={byRisk} selected={c.patient.id === cur?.patient.id} onPick={() => pick(c.patient.id)} />
                </li>
              ))}
            </ul>
            {rows.length === 0 ? <p className="cr-empty">{filter === 'open' ? 'Everyone in this view has been reviewed.' : filter === 'high' ? 'No patients currently have high predicted risk.' : 'No patients are sharing with the care team.'}</p> : null}
          </div>
        </section>

        <aside aria-label="Selected patient" className="card cr-detail" ref={panelRef}>
          {cur ? <Detail key={cur.patient.id} c={cur} setStatus={(s) => setStatus(cur.patient.id, s)} aiEnabled={!!health?.ai} /> : null}
        </aside>
      </div>
    </div>
  );
}

const patientMeta = (c: CarePatientDTO) =>
  [c.patient.age != null ? String(c.patient.age) : null, c.patient.yearsT2D != null ? `T2D, ${c.patient.yearsT2D} yrs` : 'T2D'].filter(Boolean).join(' · ');

const levelRank = (c: CarePatientDTO) => (c.risk.level === 'High' ? 2 : c.risk.level === 'Medium' ? 1 : 0);

function PatientRow({ c, byRisk, selected, onPick }: { c: CarePatientDTO; byRisk: boolean; selected: boolean; onPick: () => void }) {
  const L = LEVEL[c.risk.level];
  const now = c.latest?.mgdl;
  const ok = now != null && inRange(now);
  const prob = Math.round(c.risk.probability * 100);
  const badge = byRisk
    ? { text: c.risk.level, bg: L.bg, fg: L.fg, border: L.border, status: `${c.risk.short} · ${prob}%` }
    : now == null
      ? { text: 'No reading', bg: 'transparent', fg: 'var(--muted)', border: 'var(--line-strong)', status: 'Connect a CGM' }
      : ok
      ? { text: 'In range', bg: 'transparent', fg: 'var(--muted)', border: 'var(--line-strong)', status: 'Looks fine by reading' }
      : now != null && now < 70
        ? { text: 'Low now', bg: 'transparent', fg: 'var(--risk-deep)', border: 'var(--risk-line)', status: 'Below 70 mg/dL' }
        : { text: 'High now', bg: 'transparent', fg: 'var(--risk-deep)', border: 'var(--warn-line)', status: 'Above 180 mg/dL' };
  return (
    <button type="button" className="cr-grid cr-row" aria-pressed={selected} onClick={onPick}>
      <span className="cr-row__who">
        <span aria-hidden="true" className={`cr-avatar hue-${c.patient.avatar}`}>
          {c.patient.initials}
        </span>
        <span className="stack" style={{ minWidth: 0 }}>
          <span className="cr-row__name">{c.patient.name}</span>
          <span className="cr-row__meta">{patientMeta(c)}</span>
        </span>
      </span>
      <span className="stack">
        <span className="mono cr-row__now" style={{ color: now != null && (now > 180 || now < 70) ? 'var(--risk-deep)' : 'var(--ink)' }}>
          {now ?? '—'}
        </span>
        <span className="cr-row__unit">mg/dL · {c.latest?.trend ?? 'no data'}</span>
      </span>
      <span className="stack" style={{ gap: 6, minWidth: 0 }}>
        <span className="cr-row__status">
          <span className="cr-badge" style={{ background: badge.bg, color: badge.fg, borderColor: badge.border }}>
            {badge.text}
          </span>
          <span className="cr-row__status-text">{badge.status}</span>
        </span>
        {byRisk ? (
          <span className="cr-bar-track" aria-hidden="true">
            <span style={{ width: `${prob}%`, background: L.bar }} />
          </span>
        ) : null}
      </span>
      <span className="cr-row__driver">{c.topDriver}</span>
      <span className="cr-row__review" style={{ color: c.review === 'new' ? 'var(--ink)' : 'var(--dim)' }}>
        {c.alert?.status === 'team' && c.review === 'new' ? 'Escalated' : REVIEW_LABEL[c.review]}
      </span>
    </button>
  );
}

// Draft purpose per suggested action. A dose-review flag is raised for a predicted low, so its message is the low-risk (snack) one.
const INTENT_FOR: Record<CarePatientDTO['action']['effect'], string> = { snack: 'snack', call: 'call', reminder: 'reminder', checkin: 'checkin', sensor: 'sensor', flag: 'snack', ack: 'ack' };

function Detail({ c, setStatus, aiEnabled }: { c: CarePatientDTO; setStatus: (s: ReviewStatus) => Promise<unknown>; aiEnabled: boolean }) {
  const L = LEVEL[c.risk.level];
  const handled = c.review !== 'new';
  const prob = Math.round(c.risk.probability * 100);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<{ text: string; by: string } | null>(null);
  /** Gemini was busy (free-tier limit), so the last brief or draft came from a template. */
  const [templated, setTemplated] = useState(false);
  const [lang, setLang] = useState<Lang>(c.patient.language);
  const [draft, setDraft] = useState('');
  const [english, setEnglish] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversation = useAsync(() => api.messages(c.patient.id), [c.patient.id]);
  useLive((e) => { if (e.type === 'message') conversation.reload(); }, c.patient.id);
  useEffect(() => {
    if (conversation.data?.some((m) => m.sender === 'patient' && !m.read)) {
      void api.markRead(c.patient.id).catch((e: Error) => setError(e.message));
    }
  }, [c.patient.id, conversation.data]);

  useEffect(() => {
    setSentAt(null);
  }, [draft]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="cr-detail__head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="display cr-detail__name">{c.patient.name}</h2>
          <span className="cr-detail__meta">{[patientMeta(c), c.patient.medsShort].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="cr-detail__now">
          <span className="mono" style={{ fontSize: 22, color: c.latest && (c.latest.mgdl > 180 || c.latest.mgdl < 70) ? 'var(--risk-deep)' : 'var(--ink)' }}>
            {c.latest?.mgdl ?? '—'}
          </span>
          <span className="cr-row__unit">mg/dL now</span>
        </span>
      </div>

      <div className="cr-riskbox" style={{ background: L.boxBg, borderColor: L.boxBorder } as CSSProperties}>
        <span className="label label--sm" style={{ color: L.color }}>
          {c.risk.level} risk · next 6 h
        </span>
        <span className="cr-riskbox__kind">{c.risk.title}</span>
        <span className="cr-riskbox__window">{c.risk.window}</span>
        <div className="cr-riskbox__prob">
          <span className="cr-bar-track cr-bar-track--lg" role="meter" aria-label="Probability" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prob}>
            <span style={{ width: `${prob}%`, background: L.bar }} />
          </span>
          <span className="mono" style={{ fontSize: 14 }}>
            {prob}%
          </span>
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label label--sm">Why the twin thinks so</span>
        <ul className="cr-why">
          {c.drivers.map((d) => (
            <li key={d}>
              <span aria-hidden="true" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="cr-next">
        <span className="label label--sm">Suggested next step</span>
        <span className="cr-next__action">{c.action.label}</span>
        {handled ? (
          <div className="rise cr-done" role="status">
            <span className="cr-done__note">{c.reviewNote ?? (c.review === 'acted' ? c.action.done : 'Marked reviewed')}</span>
            <button type="button" className="btn btn-ghost hit cr-undo" disabled={busy} onClick={() => void run(() => setStatus('new'))}>
              Undo
            </button>
          </div>
        ) : (
          <div className="cr-next__btns">
            <button type="button" className="btn btn-primary cr-next__btn" disabled={busy} onClick={() => void run(() => setStatus('acted'))}>
              {c.action.button}
            </button>
            <button type="button" className="btn btn-ghost cr-next__btn" style={{ fontWeight: 400 }} disabled={busy} onClick={() => void run(() => setStatus('reviewed'))}>
              Mark reviewed
            </button>
          </div>
        )}
      </div>

      <div className="cr-ai">
        <div className="cr-ai__row">
          <span className="label label--sm">Assistant</span>
          <span className="ai-badge">{aiEnabled ? 'AI' : 'Templates'}</span>
        </div>
        <button type="button" className="btn btn-ghost cr-ai__btn" disabled={busy} onClick={() =>
            void run(async () => {
              const b = await api.brief(c.patient.id);
              setBrief(b);
              setTemplated(aiEnabled && b.by === 'offline');
            })
          }
        >
          Write a handoff note
        </button>
        {brief ? <pre className="cr-brief">{brief.text}</pre> : null}
        {templated ? <p className="notice">The AI is busy right now, so this used a template. Try again in a minute.</p> : null}
        <div className="cr-ai__row">
          <label className="sr-only" htmlFor="draft-lang">
            Message language
          </label>
          <select id="draft-lang" className="ml-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="kn">ಕನ್ನಡ</option>
          </select>
          <button
            type="button"
            className="btn btn-ghost cr-ai__btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const d = await api.draft(c.patient.id, INTENT_FOR[c.action.effect] ?? 'checkin', lang, '');
                setDraft(d.message);
                setEnglish(lang === 'en' ? null : d.english);
                setTemplated(aiEnabled && d.by === 'offline');
              })
            }
          >
            Draft a message to {c.patient.firstName}
          </button>
        </div>
        {(
          <>
            <label className="field">
              <span>Message (edit before sending)</span>
              <textarea value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} lang={lang} />
            </label>
            {english ? <p className="cr-english">English: {english}</p> : null}
            <button
              type="button"
              className="btn btn-primary cr-ai__btn"
              disabled={busy || !draft.trim()}
              onClick={() =>
                void run(async () => {
                  await api.sendMessage(c.patient.id, draft, lang);
                  setSentAt(`Sent to ${c.patient.firstName}`);
                  conversation.reload();
                })
              }
            >
              Send
            </button>
            {sentAt ? (
              <p className="cr-done__note" role="status">
                {sentAt}
              </p>
            ) : null}
          </>
        )}
        {error ? <p className="form-error">{error}</p> : null}
      </div>

      <section aria-label="Patient conversation" className="stack" style={{ gap: 10 }}>
        <h3 className="display">Conversation with {c.patient.firstName}</h3>
        {conversation.error ? <p className="form-error" role="alert">{conversation.error.message}</p> : null}
        {conversation.data?.length === 0 ? <p className="tw-muted-p">No messages yet.</p> : null}
        {(conversation.data ?? []).slice(0, 10).map((m) => <div key={m.id} className="card" style={{ padding: 12 }}>
          <span className="label">{m.sender === 'patient' ? c.patient.firstName : m.author} · {clockIST(m.sentAt)}</span>
          <p lang={m.language} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</p>
        </div>)}
      </section>

      {c.patient.hasTwin ? (
        <div>
          <ArrowLink to={`/twin?patient=${c.patient.id}`}>Open {c.patient.firstName}’s twin</ArrowLink>
        </div>
      ) : null}
      <span className="cr-signoff">The twin suggests; any dose change needs your sign-off.</span>
    </>
  );
}
