import { useState } from 'react';
import type { OutlookDTO } from '../../../shared/api';
import { ChartFrame, ChartText, HLine } from '../../components/chart/Chart';
import { linear, pct } from '../../components/chart/paths';
import { Chip } from '../../components/ui/Chip';

const W = 320;
const H = 150;
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'Asia/Kolkata' });
const monthOf = (d: Date) => MONTH.format(d);
const shortYear = (d: Date) => `’${String(d.getUTCFullYear()).slice(2)}`;

/** HbA1c labs from records, the CGM-based estimate now, and the twin's 90-day projection. */
export function Outlook({ outlook, now }: { outlook: OutlookDTO; now: number }) {
  const [scenario, setScenario] = useState<'keep' | 'stop'>('keep');
  const proj = outlook.projection?.[scenario] ?? null;
  const labs = outlook.labs.slice(-3);
  const values = [...labs.map((l) => l.value), outlook.estimate ?? 7, proj ?? 7, outlook.target];
  const lo = Math.min(6.5, Math.floor(Math.min(...values) * 2) / 2);
  const hi = Math.max(8.8, Math.ceil(Math.max(...values) * 2) / 2 + 0.2);
  const A = linear(lo, hi, 130, 20);
  const nowDate = new Date(now * 60_000);
  const later = new Date((now + 90 * 1440) * 60_000);
  const xs = [20, 90, 160].slice(3 - labs.length);
  const points = labs.map((l, i) => ({ x: xs[i], v: l.value, label: monthOf(new Date(l.date)) }));
  const est = outlook.estimate != null ? { x: 230, v: outlook.estimate, label: monthOf(nowDate) } : null;
  const pr = proj != null ? { x: 300, v: proj, label: `${monthOf(later)} ${later.getUTCFullYear() !== nowDate.getUTCFullYear() ? shortYear(later) : ''}`.trim() } : null;
  const projColor = scenario === 'keep' ? 'var(--accent)' : 'var(--risk)';
  const lastLab = labs.at(-1);
  const label =
    `HbA1c${labs.length ? ` from lab: ${labs.map((l) => `${l.value}% in ${monthOf(new Date(l.date))}`).join(', ')}` : ': no lab results yet'}.` +
    (est ? ` Twin estimate from CGM ${est.v.toFixed(1)}% now.` : '') +
    (pr ? ` Projected ${pr.v.toFixed(1)}% by ${pr.label} ${scenario === 'keep' ? 'with the current routine' : 'if evening walks stop'}.` : '');
  const path = [...points, ...(est ? [est] : [])];

  return (
    <section aria-labelledby="outlook-h" className="tint-card hue-pk tw-panel">
      <div className="stack" style={{ gap: 2 }}>
        <h2 id="outlook-h" className="display tw-panel__h">
          90-day outlook
        </h2>
        <span className="tw-panel__sub">HbA1c · lab results from ABHA, twin estimate in between</span>
      </div>
      <div role="group" aria-label="Projection scenario" className="tw-chips">
        <Chip className="hit" pressed={scenario === 'keep'} onClick={() => setScenario('keep')} on={{ border: 'var(--accent)', bg: 'var(--tint)' }} style={{ minHeight: 40, fontSize: 13 }}>
          Current routine
        </Chip>
        <Chip className="hit" pressed={scenario === 'stop'} onClick={() => setScenario('stop')} on={{ border: 'var(--risk)', bg: 'var(--risk-wash)' }} style={{ minHeight: 40, fontSize: 13 }}>
          If evening walks stop
        </Chip>
      </div>
      <ChartFrame
        width={W}
        height={H}
        label={label}
        overlay={
          <>
            <ChartText style={{ left: 0, top: pct(A(outlook.target) + 5, H), color: 'var(--dim)', fontSize: 10 }}>target {outlook.target.toFixed(1)}%</ChartText>
            {[...points, ...(est ? [est] : []), ...(pr ? [pr] : [])].map((p) => (
              <ChartText key={`${p.x}`} style={{ left: pct(p.x, W), bottom: 0, transform: 'translateX(-50%)', color: 'var(--dim)', fontSize: 10 }}>
                {p.label}
              </ChartText>
            ))}
          </>
        }
      >
        <HLine y={A(outlook.target)} x2={W} color="var(--line-strong)" dash="3 4" />
        {points.length > 1 ? <path d={points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${A(p.v)}`).join(' ')} fill="none" style={{ stroke: 'var(--ink)' }} strokeWidth="2" /> : null}
        {path.length && pr ? (
          <path d={`M${path.at(-1)!.x} ${A(path.at(-1)!.v)} L${pr.x} ${A(pr.v)}`} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" strokeDasharray="5 4" />
        ) : null}
        {points.length && est ? <path d={`M${points.at(-1)!.x} ${A(points.at(-1)!.v)} L${est.x} ${A(est.v)}`} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2" strokeDasharray="5 4" /> : null}
        {points.map((p) => (
          <circle key={p.x} cx={p.x} cy={A(p.v)} r="4" style={{ fill: 'var(--ink)' }} />
        ))}
        {est ? <circle cx={est.x} cy={A(est.v)} r="4" style={{ fill: 'var(--card)', stroke: 'var(--accent)' }} strokeWidth="2" /> : null}
        {pr ? <circle cx={pr.x} cy={A(pr.v)} r="4" style={{ fill: 'var(--card)', stroke: 'var(--accent)' }} strokeWidth="2" /> : null}
      </ChartFrame>
      <dl className="tw-a1c-stats">
        <div>
          <dt>Last lab{lastLab ? ` · ${monthOf(new Date(lastLab.date))}` : ''}</dt>
          <dd>{lastLab ? `${lastLab.value.toFixed(1)}%` : '—'}</dd>
        </div>
        <div>
          <dt>Twin estimate · now</dt>
          <dd>{est ? `${est.v.toFixed(1)}%` : '—'}</dd>
        </div>
        <div>
          <dt>Projected · {pr?.label ?? '90 days'}</dt>
          <dd style={{ color: projColor }} aria-live="polite">
            {pr ? `${pr.v.toFixed(1)}%` : '—'}
          </dd>
        </div>
      </dl>
      <p className="tw-foot">Estimate: glucose management indicator from the last 14 days of CGM. Projection: 14 routine days played on the twin.</p>
    </section>
  );
}
