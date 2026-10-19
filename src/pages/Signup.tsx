import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import './auth.css';

export function Signup() {
  usePageTitle('Create an account');
  const { me, signup } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', age: '', yearsT2D: '', city: '', language: 'en', pronoun: 'they', medsLong: 'Metformin 500 mg twice daily' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/connect" replace />;

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Optional whole numbers: blank is fine, anything else must be digits.
    const whole = (v: string) => (v.trim() === '' ? undefined : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
    const age = whole(f.age);
    const yearsT2D = whole(f.yearsT2D);
    if (Number.isNaN(age)) return setError('Age must be a whole number, for example 54.');
    if (Number.isNaN(yearsT2D)) return setError('Years with type 2 diabetes must be a whole number, for example 6.');
    setBusy(true);
    setError(null);
    try {
      await signup({
        ...f,
        age,
        yearsT2D,
        city: f.city.trim() || undefined,
      });
      nav('/connect', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap au-main">
      <div className="au-copy">
        <span className="eyebrow">Create an account</span>
        <h1 className="h-page">Start your own twin.</h1>
        <p className="lede">Next you will connect a glucose monitor — the demo sensor, or an export from Dexcom Clarity or LibreView — and the twin will learn from it.</p>
      </div>
      <form className="card au-form au-form--wide" onSubmit={submit}>
        <div className="au-row">
          <label className="field">
            <span>Full name</span>
            <input required autoComplete="name" value={f.name} onChange={set('name')} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
          </label>
        </div>
        <label className="field">
          <span>Password</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} aria-describedby="pw-hint" />
          <small id="pw-hint">At least 8 characters.</small>
        </label>
        <div className="au-row au-row--3">
          <label className="field">
            <span>Age</span>
            <input inputMode="numeric" value={f.age} onChange={set('age')} />
          </label>
          <label className="field">
            <span>Years with type 2 diabetes</span>
            <input inputMode="numeric" value={f.yearsT2D} onChange={set('yearsT2D')} />
          </label>
          <label className="field">
            <span>City</span>
            <input value={f.city} onChange={set('city')} autoComplete="address-level2" />
          </label>
        </div>
        <label className="field">
          <span>Current diabetes medicines</span>
          <input value={f.medsLong} onChange={set('medsLong')} aria-describedby="meds-hint" />
          <small id="meds-hint">The twin never changes these — dose changes go through your doctor.</small>
        </label>
        <div className="au-row">
          <label className="field">
            <span>Preferred language</span>
            <select value={f.language} onChange={set('language')}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="kn">ಕನ್ನಡ</option>
            </select>
          </label>
          <label className="field">
            <span>Pronouns</span>
            <select value={f.pronoun} onChange={set('pronoun')}>
              <option value="they">they / them</option>
              <option value="she">she / her</option>
              <option value="he">he / him</option>
            </select>
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="au-alt">
          Already have one?{' '}
          <Link to="/login" className="tap-link">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
