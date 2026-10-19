import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { PlannedDinner, WhatIfDTO, WhatIfRequest } from '../../shared/api';
import { api } from '../api/client';
import { useAsync } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { PageError, PageLoading } from '../auth/RequireAuth';
import { Area, ChartFrame, ChartText, Dot, HLine, Line, VGrid } from '../components/chart/Chart';
import { bandPath, linear, linePath, pct } from '../components/chart/paths';
import { PlateToTwin } from '../components/illustrations/PlateToTwin';
import { Legend } from '../components/ui/Legend';
import { Segmented } from '../components/ui/Segmented';
import { MEAL_ORDER, MEALS } from '../data/meals';
import { useChartSize } from '../hooks/useElementWidth';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePatientId } from '../hooks/usePatient';
import './simulate.css';

type MealChoice = 'rice' | 'chapati' | 'millet' | 'custom';
interface Inputs {
  meal: MealChoice;
  custom: { label: string; carbs: number; speed: number } | null;
  portion: number;
  walk: number;
  sleep: number;
  med: 'taken' | 'missed';
}

const DEFAULTS: Inputs = { meal: 'chapati', custom: null, portion: 1, walk: 20, sleep: 6.5, med: 'taken' };
const USUAL: Inputs = { meal: 'rice', custom: null, portion: 1, walk: 0, sleep: 7, med: 'taken' };
const MED_OPTIONS = [
  { value: 'taken', label: 'Taken' },
  { value: 'missed', label: 'Missed', activeBg: 'var(--risk)', activeFg: 'var(--card)' },
] as const;
const AXIS = ['dinner', '+30', '+60', '+90', '+120', '+150', '+3 h'];
const VERDICT = { 'in-range': 'Stays in range', brief: 'Brief spike above target', long: 'Long spike above target' } as const;

function toRequest(i: Inputs): WhatIfRequest {
  const m = i.meal === 'custom' && i.custom ? i.custom : MEALS[i.meal === 'custom' ? 'chapati' : i.meal];
  return { meal: { carbs: m.carbs, speed: m.speed, label: 'label' in m ? m.label : m.name }, portion: i.portion, walk: i.walk, sleep: i.sleep, med: i.med };
}
function fromRequest(r: WhatIfRequest): Inputs {
  const preset = MEAL_ORDER.find((id) => MEALS[id].carbs === r.meal.carbs && Math.abs(MEALS[id].speed - r.meal.speed) < 0.01);
  return {
    meal: preset ?? 'custom',
    custom: preset ? null : { label: r.meal.label ?? 'Custom dinner', carbs: r.meal.carbs, speed: r.meal.speed },
    portion: r.portion,
    walk: r.walk,
    sleep: r.sleep,
    med: r.med,
  };
}
function describe(i: Inputs) {
  const name = i.meal === 'custom' ? (i.custom?.label ?? 'Custom dinner') : MEALS[i.meal].short;
  return {
    meal: `${name} · ${i.portion === 1 ? 'usual portion' : `${i.portion}×`}`,
    detail: `${i.walk ? `walk ${i.walk} min` : 'no walk'} · slept ${i.sleep} h · metformin ${i.med}`,
  };
}
/** The largest dinner the twin simulates (the API's limit), g of carbohydrate. */
const MAX_CARBS = 300;
const formatDelta = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} mg/dL`;

export function Simulate() {
  usePageTitle('What-if simulator');
  const { me, health } = useAuth();
  const patientId = usePatientId();
  const dash = useAsync(() => api.dashboard(patientId!), [patientId]);
  const saved = useAsync(() => api.scenarios(patientId!), [patientId]);
  const [input, setInput] = useState<Inputs>(DEFAULTS);
  const [res, setRes] = useState<WhatIfDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [customErr, setCustomErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const req = useMemo(() => toRequest(input), [input]);
  const hasTwin = !!dash.data?.patient.hasTwin;

  useEffect(() => {
    if (!patientId || !hasTwin) return;
    setRes(null);
    let live = true;
    const t = setTimeout(() => {
      api
        .whatIf(patientId, req)
        .then((r) => live && (setRes(r), setErr(null)))
        .catch((e: Error) => live && setErr(e.message));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [patientId, req, hasTwin]);

  if (dash.error && !dash.data) return <PageError message={dash.error.message} retry={dash.reload} />;
  if (!patientId || !dash.data) return <PageLoading />;
  const p = dash.data.patient;
  if (!p.hasTwin) return <div className="wrap" style={{ padding: '72px 24px' }}><h1 className="h-page">Build the twin to try a scenario.</h1><p className="lede">Connect a glucose monitor and allow the twin to use its readings.</p><Link className="btn btn-primary" to={me?.user.role === 'clinician' ? '/care' : '/connect'}>{me?.user.role === 'clinician' ? 'Back to care team' : 'Connect data'}</Link></div>;
  const self = me?.user.role === 'patient';
  const who = self ? 'you' : p.firstName;
  const update = (patch: Partial<Inputs>) => {
    setInput((x) => ({ ...x, ...patch }));
    setSent(null);
  };

  const estimateCustom = async () => {
    setCustomBusy(true);
    setCustomErr(null);
    try {
      const e = await api.mealText(p.id, customText);
      if (e.totalCarbs <= 0) throw new Error(e.notes || 'Could not find any food in that.');
      if (e.totalCarbs > MAX_CARBS) throw new Error(`That is about ${e.totalCarbs} g of carbohydrate — more than the twin simulates for one dinner (${MAX_CARBS} g). Describe a smaller portion.`);
      update({ meal: 'custom', custom: { label: customText.trim().slice(0, 60), carbs: e.totalCarbs, speed: e.speed } });
    } catch (e) {
      setCustomErr(e instanceof Error ? e.message : 'Could not estimate.');
    } finally {
      setCustomBusy(false);
    }
  };

  const r = res?.result;
  const peak = r ? Math.round(r.peak) : 0;
  const planText = `Tonight — ${(input.meal === 'custom' ? (input.custom?.label ?? 'this dinner') : MEALS[input.meal].name).toLowerCase()}${input.walk ? `, then a ${input.walk}-minute walk` : ''}.`;
  const bestPeak = saved.data && saved.data.length > 1 ? Math.min(...saved.data.map((s) => s.peak)) : null;
  const saveAction = async (kind: 'plan' | 'scenario') => {
    setSaving(true);
    setErr(null);
    try {
      if (kind === 'plan') {
        await api.sendPlan(p.id, planText);
        setSent(self ? `Saved to your messages: “${planText}”` : `Sent to ${p.firstName}: “${planText}”`);
      } else {
        await api.saveScenario(p.id, req);
        saved.reload();
        setSent('Scenario saved for comparison.');
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="wrap sm-main">
      <div className="sm-head">
        <div className="sm-head__copy">
          <span className="eyebrow">What-if simulator · {p.name} · tonight’s dinner</span>
          <h1 className="h-page">Try it on the twin before trying it on {self ? 'yourself' : p.firstName}.</h1>
          <p className="lede">
            Change the meal, the walk after it, last night’s sleep or a missed dose. The twin replays the next three hours of {self ? 'your' : `${p.pronoun === 'she' ? 'her' : p.pronoun === 'he' ? 'his' : 'their'}`} glucose — and the night after — against the usual dinner.
          </p>
        </div>
        <div className="sm-head__art">
          <PlateToTwin />
        </div>
        <button type="button" className="btn btn-ghost sm-reset" onClick={() => update(USUAL)}>
          Reset to usual dinner
        </button>
      </div>

      <div className="sm-body">
        <section aria-label="Scenario controls" className="card sm-controls">
          <div role="group" aria-labelledby="meal-h" className="stack" style={{ gap: 10 }}>
            <span id="meal-h" className="label">
              Dinner
            </span>
            {MEAL_ORDER.map((id) => {
              const m = MEALS[id];
              return (
                <button key={id} type="button" className={`sm-opt hue-${m.hue}`} aria-pressed={input.meal === id} onClick={() => update({ meal: id })}>
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="sm-opt__name">{m.name}</span>
                    <span className="sm-opt__note">{m.note}</span>
                  </span>
                  <span aria-hidden="true" className="sm-opt__dot" />
                </button>
              );
            })}
            {input.custom ? (
              <button type="button" className="sm-opt hue-pk" aria-pressed={input.meal === 'custom'} onClick={() => update({ meal: 'custom' })}>
                <span className="stack" style={{ gap: 2 }}>
                  <span className="sm-opt__name">{input.custom.label}</span>
                  <span className="sm-opt__note">≈ {input.custom.carbs} g carbs · your description</span>
                </span>
                <span aria-hidden="true" className="sm-opt__dot" />
              </button>
            ) : null}
            <div className="sm-custom">
              <label className="field">
                <span>Or describe any dinner</span>
                <input value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="2 ragi rotti, chutney, a glass of buttermilk" />
              </label>
              <button type="button" className="btn btn-ghost sm-custom__go" disabled={customBusy || !customText.trim()} onClick={() => void estimateCustom()}>
                {customBusy ? 'Estimating…' : 'Use this'} {health?.ai ? <span className="ai-badge">AI</span> : null}
              </button>
              {customErr ? <p className="form-error">{customErr}</p> : null}
            </div>
          </div>

          <RangeField id="portion" hue="o" label="Portion" min={0.5} max={1.5} step={0.25} value={input.portion} display={input.portion === 1 ? 'usual' : `${input.portion}×`} ticks={['half', 'usual', '1.5×']} onChange={(portion) => update({ portion })} />
          <RangeField id="walk" hue="g" label="Walk after dinner" min={0} max={45} step={5} value={input.walk} display={input.walk ? `${input.walk} min` : 'none'} ticks={['none', '45 min']} onChange={(walk) => update({ walk })} />
          <RangeField id="sleep" hue="b" label="Sleep last night" min={4} max={9} step={0.5} value={input.sleep} display={`${input.sleep} h`} ticks={['4 h', '9 h']} onChange={(sleep) => update({ sleep })} />

          <div className="stack" style={{ gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>Evening metformin</span>
            <Segmented label="Evening metformin" options={MED_OPTIONS} value={input.med} onChange={(med) => update({ med })} size={{ minHeight: 40, padX: 18 }} className="sm-med" />
          </div>
        </section>

        <section aria-label="Simulated result" className="sm-result">
          <div className="card sm-result-card">
            {err ? <p className="form-error">{err}</p> : null}
            {r && res ? (
              <>
                <div className="sm-verdict-row">
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="label">Twin verdict</span>
                    <span className="display sm-verdict" style={{ color: res.verdict === 'in-range' ? 'var(--g-ink)' : 'var(--risk)' }}>
                      {VERDICT[res.verdict]}
                    </span>
                  </div>
                  <dl className="sm-stats">
                    <div>
                      <dt>Peak</dt>
                      <dd>
                        {peak} <span className="sm-stats__unit">mg/dL at +{r.peakT} min</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Above 180</dt>
                      <dd style={{ color: r.aboveMin > 0 ? 'var(--risk)' : 'var(--ink)' }}>{r.aboveMin} min</dd>
                    </div>
                    <div>
                      <dt>Peak vs usual</dt>
                      <dd style={{ color: res.deltaPeak < 0 ? 'var(--accent)' : res.deltaPeak > 0 ? 'var(--risk)' : 'var(--ink)' }}>{formatDelta(res.deltaPeak)}</dd>
                    </div>
                    <div>
                      <dt>Overnight low</dt>
                      <dd style={{ color: r.pLowOvernight >= 0.3 ? 'var(--risk)' : 'var(--ink)' }}>
                        {Math.round(r.overnightLow)} <span className="sm-stats__unit">{Math.round(r.pLowOvernight * 100)}% chance &lt;70</span>
                      </dd>
                    </div>
                  </dl>
                  <p className="sr-only" aria-live="polite">
                    {`${VERDICT[res.verdict]}. Peak ${peak} mg/dL at ${r.peakT} minutes, ${r.aboveMin} minutes above 180, ${formatDelta(res.deltaPeak)} versus the usual dinner. Overnight low ${Math.round(r.overnightLow)}.`}
                  </p>
                </div>
                <ResultChart res={res} />
                <Legend
                  label="Chart legend"
                  items={[
                    { label: 'This scenario ± uncertainty', color: 'var(--accent)', width: 3 },
                    { label: res.usualLabel, color: 'var(--dim)', width: 2, dash: 'dashed' },
                    { label: 'Time above target', color: 'var(--risk-line)', width: 6 },
                  ]}
                />
              </>
            ) : (
              <div className="tw-chart-skel" aria-hidden="true" />
            )}
          </div>

          <div className="sm-actions">
            <button
              type="button"
              className="btn btn-primary sm-act"
              disabled={saving || !res}
              onClick={() => void saveAction('plan')}
            >
              Suggest as tonight’s plan
            </button>
            <button
              type="button"
              className="btn btn-ghost sm-act"
              style={{ fontWeight: 500 }}
              disabled={saving || !res}
              onClick={() => void saveAction('scenario')}
            >
              Save to compare
            </button>
            <span role="status" className="sm-sent">
              {sent ? (
                <span key={sent} className="rise" style={{ display: 'inline-block' }}>
                  {sent}
                </span>
              ) : null}
            </span>
          </div>

          <div className="sm-saved">
            {saved.error ? <p className="form-error" role="alert">{saved.error.message}</p> : null}
            <div className="sm-saved__head">
              <h2 className="display sm-saved__h">Saved scenarios</h2>
              <span className="sm-saved__cap">Up to 4 · newest first</span>
            </div>
            {!saved.data || saved.data.length === 0 ? (
              <p className="sm-saved__empty">Save a few versions of tonight to compare them side by side.</p>
            ) : (
              <div className="sm-saved__scroll">
                <ul className="sm-saved__list">
                  {saved.data.map((s) => {
                    const l = describe(fromRequest(s.input));
                    return (
                      <li key={s.id} className="rise">
                        <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                          <span className="sm-saved__meal">
                            {l.meal}
                            {bestPeak != null && s.peak === bestPeak ? <span className="sm-best">Lowest peak</span> : null}
                          </span>
                          <span className="sm-saved__detail">{l.detail}</span>
                        </span>
                        <span className="mono sm-saved__num">
                          {s.peak} <span className="sm-saved__u">peak</span>
                        </span>
                        <span className="mono sm-saved__num" style={{ color: s.aboveMin > 0 ? 'var(--risk-deep)' : 'var(--ink)' }}>
                          {s.aboveMin} <span className="sm-saved__u">min &gt;180</span>
                        </span>
                        <button type="button" className="btn btn-ghost hit sm-load" aria-label={`Load ${l.meal}, ${l.detail}`} onClick={() => update(fromRequest(s.input))}>
                          Load
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <Planner patientId={p.id} who={who} aiEnabled={!!health?.ai} onTry={(o) => update({ meal: 'custom', custom: { label: o.name.slice(0, 60), carbs: Math.min(MAX_CARBS, o.carbs), speed: o.speed }, portion: 1, walk: 20 })} />

          <p className="sm-disclaimer">
            The twin is fitted to {self ? 'your' : `${p.firstName}’s`} own data, but it is a research model and its estimates have error — {dash.data.twin ? `back-tested at ± ${dash.data.twin.trackRecord.h4} mg/dL four hours ahead` : 'see the live twin for its track record'}. Not for treatment decisions — dose changes go through the doctor.
          </p>
        </section>
      </div>
    </div>
  );
}

function Planner({ patientId, who, aiEnabled, onTry }: { patientId: string; who: string; aiEnabled: boolean; onTry: (o: PlannedDinner) => void }) {
  const [prefs, setPrefs] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ options: PlannedDinner[]; by: 'ai' | 'offline' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api.plan(patientId, prefs));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan dinners.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card sm-planner" aria-labelledby="planner-h">
      <div className="sm-saved__head">
        <h2 id="planner-h" className="display sm-saved__h">
          Dinner ideas, ranked by the twin
        </h2>
        <span className="ai-badge">{(out ? out.by === 'ai' : aiEnabled) ? 'AI' : 'Built-in list'}</span>
      </div>
      <p className="tw-muted-p" style={{ fontSize: 14 }}>
        {aiEnabled ? 'AI suggests home-style dinners; ' : 'Five common swaps; '}the twin plays each one on {who} (with a 20-minute walk) and ranks them by time above 180.
      </p>
      <div className="sm-custom">
        <label className="field">
          <span>Preferences (optional)</span>
          <input value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="vegetarian, no millets, something with rice" />
        </label>
        <button type="button" className="btn btn-primary sm-custom__go" disabled={busy} onClick={() => void run()}>
          {busy ? 'Trying them on the twin…' : 'Suggest dinners'}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {out && aiEnabled && out.by === 'offline' ? <p className="notice">The AI is busy right now, so these are the built-in ideas. Try again in a minute.</p> : null}
      {out ? (
        <div className="sm-saved__scroll">
          <table className="sm-plan">
            <caption className="sr-only">Dinner ideas ranked by the twin</caption>
            <thead>
              <tr>
                <th scope="col">Dinner</th>
                <th scope="col">Carbs</th>
                <th scope="col">Peak</th>
                <th scope="col">Min &gt;180</th>
                <th scope="col">Night low</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {out.options.map((o, i) => (
                <tr key={`${i}-${o.name}`}>
                  <td>
                    <span className="sm-plan__name">
                      {i === 0 ? <span className="sm-best">Best</span> : null} {o.name}
                    </span>
                    <span className="sm-plan__why">
                      {o.items} — {o.why}
                    </span>
                  </td>
                  <td className="mono">{o.carbs} g</td>
                  <td className="mono">{o.peak}</td>
                  <td className="mono" style={{ color: o.aboveMin ? 'var(--risk)' : undefined }}>
                    {o.aboveMin}
                  </td>
                  <td className="mono" style={{ color: o.pLowOvernight >= 0.3 ? 'var(--risk)' : undefined }}>
                    {o.overnightLow}
                    {o.pLowOvernight >= 0.3 ? ` (${Math.round(o.pLowOvernight * 100)}% <70)` : ''}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost hit sm-load" onClick={() => onTry(o)}>
                      Try
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

interface RangeFieldProps {
  id: string;
  hue: 'o' | 'g' | 'b';
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  ticks: string[];
  onChange: (v: number) => void;
}

function RangeField({ id, hue, label, min, max, step, value, display, ticks, onChange }: RangeFieldProps) {
  return (
    <div className={`sm-range hue-${hue}`}>
      <div className="sm-range__top">
        <label htmlFor={id} style={{ fontSize: 15, fontWeight: 500 }}>
          {label}
        </label>
        <span className="mono sm-range__val" aria-hidden="true">
          {display}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={display} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <div className="sm-range__ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function ResultChart({ res }: { res: WhatIfDTO }) {
  const size = useChartSize<HTMLDivElement>({ w: 720, h: 300 }, { w: 360, h: 300 });
  const { w: W, h: H } = size;
  const r = res.result;
  const x = linear(0, 180, 0, W);
  const top = Math.max(345, Math.ceil((Math.max(...r.band.map((b) => b.hi), res.usual.peak) + 15) / 5) * 5);
  const y = linear(60, top, H - 10, 5, true);
  const every = (pts: number[], step: number) => pts.filter((_, t) => t % step === 0).map((v, i) => ({ t: i * step, v }));
  const scen = every(r.pts, 3);
  const ghost = every(res.usual.pts, 3);
  const above = every(r.pts, 2).map(({ t, v }) => ({ t, v: Math.max(v, 180) }));
  const aboveD = r.aboveMin > 0 ? `${linePath(above, x, y)} L${W} ${y(180)} L0 ${y(180)} Z` : '';
  const peakY = y(r.peak);
  const tagStyle: CSSProperties = { top: pct(peakY, H), left: pct(x(r.peakT), W), transform: `translate(-50%, ${peakY < 44 ? '14px' : 'calc(-100% - 12px)'})` };
  const label = `Simulated glucose for three hours after dinner. Peak ${Math.round(r.peak)} mg/dL at ${r.peakT} minutes, ${r.aboveMin} minutes above 180. The usual dinner peaks at ${Math.round(res.usual.peak)}. Overnight low ${Math.round(r.overnightLow)} about ${Math.round(r.overnightLowAt / 60)} hours after dinner.`;
  return (
    <div>
      <div ref={size.ref}>
        <ChartFrame
          width={W}
          height={H}
          label={label}
          overlay={
            <>
              <ChartText style={{ right: pct(6, W), top: pct(y(180) - 7, H), transform: 'translateY(-100%)', color: 'var(--risk)', fontSize: 12 }}>180 mg/dL</ChartText>
              <div className="sm-peak-tag" style={tagStyle} aria-hidden="true">
                peak {Math.round(r.peak)}
              </div>
            </>
          }
        >
          <VGrid xs={[30, 60, 90, 120, 150].map(x)} height={H} />
          <Area d={aboveD} color="var(--risk)" opacity={0.3} />
          <HLine y={y(180)} x2={W} color="var(--risk)" width={1.2} dash="5 5" />
          <Line d={linePath(ghost, x, y)} color="var(--dim)" width={2} dash="3 5" />
          <Area d={bandPath(r.band, x, y)} color="var(--accent)" opacity={0.15} />
          <Line d={linePath(scen, x, y)} color="var(--accent)" width={3} />
          <Dot x={x(r.peakT)} y={peakY} r={6} fill="var(--accent)" ringWidth={3} />
        </ChartFrame>
      </div>
      <div className="axis axis--spread" aria-hidden="true">
        {AXIS.map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>
    </div>
  );
}
