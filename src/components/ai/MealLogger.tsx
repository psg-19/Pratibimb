import { useEffect, useRef, useState } from 'react';
import type { Lang, MealEstimate } from '../../../shared/api';
import { api } from '../../api/client';
import { useSimNow } from '../../hooks/useSimNow';
import { Segmented } from '../ui/Segmented';
import { AiDataNote } from './AiDataNote';
import { Sheet } from './Sheet';
import { shrinkImage, speechSupported, startDictation } from './speech';
import './ai.css';

const SPEECH_LANG: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };
const WHEN = [
  { value: 0, label: 'Now' },
  { value: 30, label: '30 min ago' },
  { value: 60, label: '1 h ago' },
  { value: 120, label: '2 h ago' },
] as const;

interface Props {
  patientId: string;
  language: Lang;
  aiEnabled: boolean;
  /** Whether the twin uses logged meals: the meal log is on, off (the patient can turn it on), or off for another patient. */
  mealLog: 'on' | 'off' | 'off-other';
  onConnectMealLog: () => Promise<void>;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Log a meal by describing it, saying it, or photographing it; AI (or the food table) estimates the carbs. */
export function MealLogger({ patientId, language, aiEnabled, mealLog, onConnectMealLog, open, onClose, onSaved }: Props) {
  const now = useSimNow(5000);
  const [mode, setMode] = useState<'text' | 'photo'>('text');
  const [text, setText] = useState('');
  const [lang, setLang] = useState<Lang>(language);
  const [listening, setListening] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [est, setEst] = useState<MealEstimate | null>(null);
  const [carbs, setCarbs] = useState<number[]>([]);
  const [ago, setAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'logged' | 'voice' | 'photo'>('logged');
  const stop = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open) {
      stop.current();
      setText('');
      setFile(null);
      setPreview(null);
      setEst(null);
      setError(null);
      setNote('');
      setAgo(0);
      setSource('logged');
      setMode('text');
    }
  }, [open]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const dictate = () => {
    if (listening) {
      stop.current();
      return;
    }
    setError(null);
    setListening(true);
    stop.current = startDictation(
      SPEECH_LANG[lang],
      (t) => {
        setText(t);
        setSource('voice');
      },
      (err) => {
        setListening(false);
        if (err) setError(err);
      },
    );
  };

  const estimate = async () => {
    setBusy(true);
    setError(null);
    setEst(null);
    try {
      const r = mode === 'photo' && file ? await api.mealPhoto(patientId, await shrinkImage(file), note) : await api.mealText(patientId, text);
      if (mode === 'photo') setSource('photo');
      setEst(r);
      setCarbs(r.items.map((i) => i.carbs));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not estimate this meal.');
    } finally {
      setBusy(false);
    }
  };

  const total = carbs.reduce((a, c) => a + (Number.isFinite(c) ? Math.max(0, c) : 0), 0);
  const save = async () => {
    if (!est) return;
    setBusy(true);
    try {
      const label = est.items.map((i) => i.name).join(', ').slice(0, 180) || text.slice(0, 120) || 'Meal';
      await api.logEvent(patientId, { kind: 'meal', t: now != null ? now - ago : undefined, carbs: total, speed: est.speed, label, source, note: source === 'voice' ? `Voice note, ${lang === 'hi' ? 'Hindi' : lang === 'kn' ? 'Kannada' : 'English'}` : undefined });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Log a meal" labelId="meal-h">
      {mealLog === 'off' ? (
        <div className="notice ml-off">
          <span>Your meal log is turned off, so the twin will not use meals you log here.</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              onConnectMealLog()
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Turn on the meal log
          </button>
        </div>
      ) : mealLog === 'off-other' ? (
        <p className="notice">This patient’s meal log is turned off, so the twin will not use meals logged here until they turn it on.</p>
      ) : null}
      <Segmented
        label="How to log"
        options={[
          { value: 'text', label: 'Describe or say it' },
          { value: 'photo', label: 'Photo' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setEst(null);
        }}
      />
      {mode === 'text' ? (
        <div className="stack" style={{ gap: 10 }}>
          <label className="field">
            <span>What did you eat?</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="two chapati, dal, bhindi sabzi" lang={lang} />
          </label>
          <div className="ml-voice">
            <label className="sr-only" htmlFor="ml-lang">
              Voice language
            </label>
            <select id="ml-lang" className="ml-select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="kn">ಕನ್ನಡ</option>
            </select>
            {speechSupported() ? (
              <button type="button" className="btn btn-ghost ml-mic" aria-pressed={listening} onClick={dictate}>
                <span aria-hidden="true" className={`ml-mic__dot${listening ? ' is-on' : ''}`} />
                {listening ? 'Listening… tap to stop' : 'Say it'}
              </button>
            ) : (
              <span className="ml-hint">Voice input needs Chrome, Edge or Safari.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {!aiEnabled ? <p className="notice">Photo estimates need the AI service, which is off on this server. Describe the meal instead.</p> : <AiDataNote what="The photo" />}
          <label className="field">
            <span>Meal photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={!aiEnabled}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          {preview ? <img src={preview} alt="Your meal, as uploaded" className="ml-preview" /> : null}
          <label className="field">
            <span>Anything the photo doesn't show? (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 cups of rice under the curry" />
          </label>
        </div>
      )}

      <button type="button" className="btn btn-primary ml-go" disabled={busy || (mode === 'text' ? !text.trim() : !file)} onClick={() => void estimate()}>
        {busy && !est ? 'Estimating…' : 'Estimate carbs'}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {est ? (
        <div className="ml-result" aria-live="polite">
          <div className="ml-result__head">
            <span className="label">Estimate</span>
            <span className="ai-badge">{est.by === 'ai' ? 'AI' : 'Food table'}</span>
            <span className="ml-conf">confidence: {est.confidence}</span>
          </div>
          {est.items.length === 0 ? (
            <p className="tw-muted-p">{est.notes}</p>
          ) : (
            <table className="ml-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Carbs (g)</th>
                </tr>
              </thead>
              <tbody>
                {est.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.name}</td>
                    <td>{it.quantity}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        step={5}
                        aria-label={`Carbs for ${it.name}`}
                        value={carbs[i] ?? 0}
                        onChange={(e) => setCarbs((c) => c.map((v, j) => (j === i ? Number(e.target.value) : v)))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>
                    Total
                  </th>
                  <td className="mono">{total} g</td>
                </tr>
              </tfoot>
            </table>
          )}
          {est.items.length ? <p className="ml-notes">{est.notes}</p> : null}
          <div className="ml-when">
            <span className="field" style={{ fontWeight: 500 }}>
              When
            </span>
            <Segmented label="When was it eaten" options={WHEN} value={ago} onChange={setAgo} size={{ minHeight: 36, padX: 12 }} />
          </div>
          {total > 300 ? <p className="form-error" role="alert">Keep the total at 300 g or less; log larger meals in separate entries.</p> : null}
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || total <= 0 || total > 300} onClick={() => void save()}>
            Save to my log
          </button>
          <p className="ml-hint">{mealLog === 'on' ? 'Your twin updates its forecast as soon as the meal is saved.' : 'The meal is saved to the log; the twin uses it once the meal log is on.'}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
