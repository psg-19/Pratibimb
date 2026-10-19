import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TwinScene } from '../components/illustrations/TwinScene';
import { ClinicianGlyph, ConsentGlyph, ExplainGlyph } from '../components/ui/icons';
import { PrimaryLink } from '../components/ui/Links';
import { PLACEHOLDER } from '../config';
import { CONDITIONS, STEPS, VALIDATION_PLACEHOLDERS, type Condition } from '../data/overview';
import { usePageTitle } from '../hooks/usePageTitle';
import type { CareMode } from '../model/overnight';
import { OvernightDemo } from './overview/OvernightDemo';
import './overview.css';

export function Overview({ startMode = 'proactive' }: { startMode?: CareMode }) {
  usePageTitle('Overview');
  return (
    <>
      <section className="paper ov-band" aria-labelledby="hero-h">
        <div className="wrap ov-hero">
          <div className="ov-hero__copy">
            <div className="ov-pill">
              <span className="live-dot" aria-hidden="true">
                <span className="ping" />
                <span />
              </span>
              <span>Proof of concept · Type 2 diabetes</span>
            </div>
            <h1 id="hero-h" className="display ov-hero__h1">
              Meet the twin that sees tonight’s low before it happens.
            </h1>
            <p className="ov-hero__lede">
              Pratibimb pairs continuous glucose and wearable data with a patient’s health records to build a living model of their
              metabolism — then plays the next six hours forward, so care can act before a high or a low, not after.
            </p>
            <div className="ov-hero__ctas">
              <PrimaryLink to="/twin">Open the live twin</PrimaryLink>
              <Link to="/simulate" className="ov-hero__secondary">
                Try a what-if on the twin
              </Link>
            </div>
            <p className="ov-hero__note">Research prototype · synthetic data · not a medical device</p>
          </div>

          <div className="ov-hero__art">
            <TwinScene />
          </div>

          <div className="ov-hero__demo">
            <OvernightDemo startMode={startMode} />
          </div>
        </div>
      </section>

      <ScopeSection />
      <HowSection />
      <TrustSection />

      <section className="paper ov-cta" aria-labelledby="cta-h">
        <div className="wrap ov-cta__inner">
          <span className="ov-cta__kicker">Happiest Health · Reimagining and Reforming Healthcare in India Summit 2026 · Bengaluru</span>
          <h2 id="cta-h" className="display ov-cta__h2">
            Medicine that moves before the reading does.
          </h2>
          <p className="ov-cta__by">
            A proof of concept by {PLACEHOLDER.teamName} · {PLACEHOLDER.incubator}
          </p>
          <PrimaryLink to="/twin">Open the live twin</PrimaryLink>
        </div>
      </section>
    </>
  );
}

function SectionHead({ id, eyebrow, title, maxCh }: { id: string; eyebrow: string; title: string; maxCh: number }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id={id} className="h-section" style={{ maxWidth: `${maxCh}ch` }}>
        {title}
      </h2>
    </div>
  );
}

function ScopeSection() {
  const [cond, setCond] = useState<Condition['id']>('t2d');
  const cur = CONDITIONS.find((c) => c.id === cond) ?? CONDITIONS[0];
  const isPoc = cur.id === 't2d';
  const fields = [
    ['The twin predicts', cur.predicts],
    ['Forecast horizon', cur.horizon],
    ['Signals it learns from', cur.signals],
    ['How it acts', cur.acts],
  ] as const;

  return (
    <section className="ov-band" aria-labelledby="scope-h">
      <div className="wrap ov-section">
        <div className="ov-scope__head">
          <SectionHead id="scope-h" eyebrow="Scope" title="One condition, modelled deeply." maxCh={15} />
          <p className="lede ov-scope__lede">
            A whole-body twin is a decade of work. A proof of concept earns trust by predicting one outcome well — so we started with
            type 2 diabetes, where a forecast hours ahead changes what a patient eats tonight.
          </p>
        </div>
        <div role="group" aria-label="Condition" className="ov-scope__chips">
          {CONDITIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`ov-tone-btn ov-scope__chip hue-${c.hue}`}
              aria-pressed={c.id === cond}
              aria-controls="scope-panel"
              onClick={() => setCond(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div id="scope-panel" className={`ov-scope__panel hue-${cur.hue}`} role="region" aria-label={cur.name}>
          <div className="ov-scope__panel-head">
            <h3 className="display ov-scope__h3">{cur.name}</h3>
            <span className={`ov-scope__tag${isPoc ? ' ov-scope__tag--poc' : ''}`}>{cur.tag}</span>
          </div>
          <dl className="ov-scope__grid">
            {fields.map(([k, v]) => (
              <div key={k} className="stack" style={{ gap: 8 }}>
                <dt className="label">{k}</dt>
                <dd className="ov-scope__val">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function HowSection() {
  const [step, setStep] = useState(0);
  const sel = STEPS[step];
  return (
    <section className="paper ov-band" aria-labelledby="how-h">
      <div className="wrap ov-section">
        <SectionHead id="how-h" eyebrow="How the twin works" title="Sense. Mirror. Simulate. Act." maxCh={20} />
        <div role="group" aria-label="Steps" className="ov-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.n}
              type="button"
              className={`ov-tone-btn ov-step hue-${s.hue}`}
              aria-pressed={i === step}
              aria-controls="step-detail"
              onClick={() => setStep(i)}
            >
              <span className="ov-step__n">{s.n}</span>
              <span className="display ov-step__verb">{s.verb}</span>
              <span className="ov-step__line">{s.line}</span>
            </button>
          ))}
        </div>
        <div id="step-detail" key={step} className={`rise ov-step-detail hue-${sel.hue}`} role="region" aria-label={`${sel.verb}, in detail`}>
          <div className="ov-step-detail__head">
            <span className="label">Step {sel.n}</span>
            <span className="display ov-step-detail__title">{sel.verb}, in detail</span>
          </div>
          <ul className="ov-step-detail__list">
            {sel.details.map((d) => (
              <li key={d}>
                <span aria-hidden="true" className="ov-step-detail__dot" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  {
    hue: 'y',
    icon: <ExplainGlyph />,
    title: 'Explainable by default',
    body: 'Every forecast lists the signals that moved it — a lighter dinner, a long walk, a missed dose — so a doctor can see the reasoning and disagree with it.',
  },
  {
    hue: 'g',
    icon: <ConsentGlyph />,
    title: 'Consent, stream by stream',
    body: 'Patients switch each data source on or off and see exactly what it is used for. Designed around India’s Digital Personal Data Protection Act, 2023.',
  },
  {
    hue: 'pk',
    icon: <ClinicianGlyph />,
    title: 'A clinician signs off',
    body: 'The twin suggests; it never changes a prescription. Any change to a dose goes to the patient’s doctor for review first.',
  },
] as const;

function TrustSection() {
  return (
    <section className="ov-band" aria-labelledby="trust-h">
      <div className="wrap ov-section">
        <SectionHead id="trust-h" eyebrow="Trust" title="Built to be questioned." maxCh={18} />
        <div className="ov-trust">
          {TRUST.map((t) => (
            <div key={t.title} className={`ov-trust__card hue-${t.hue}`}>
              <div className="ov-trust__icon">{t.icon}</div>
              <h3 className="display ov-trust__h3">{t.title}</h3>
              <p className="ov-trust__body">{t.body}</p>
            </div>
          ))}
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <h3 className="label" style={{ fontWeight: 400 }}>
            How we will prove it
          </h3>
          <div className="ov-proof">
            {VALIDATION_PLACEHOLDERS.map((m) => (
              <div key={m.caption} className={`ov-proof__card hue-${m.hue}`}>
                <span className="ov-proof__value">{m.value}</span>
                <span className="ov-proof__caption">{m.caption}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
