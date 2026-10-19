import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import './auth.css';

const DEMO = [
  { email: 'suresh@pratibimb.demo', label: 'Suresh R.', role: 'Patient · likely low tonight' },
  { email: 'doctor@pratibimb.demo', label: 'Dr. [CLINICIAN NAME]', role: 'Care team · six patients' },
  { email: 'lakshmi@pratibimb.demo', label: 'Lakshmi N.', role: 'Patient · Kannada' },
];
const DEMO_PASSWORD = 'pratibimb';

export function Login() {
  usePageTitle('Sign in');
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const requestedNext = params.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') && !requestedNext.includes('\\') ? requestedNext : null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={next ?? (me.user.role === 'clinician' ? '/care' : '/twin')} replace />;

  const go = async (e: string, pw: string) => {
    setBusy(true);
    setError(null);
    try {
      const signedIn = await login(e, pw);
      nav(next ?? (signedIn.user.role === 'clinician' ? '/care' : '/twin'), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void go(email, password);
  };

  return (
    <div className="wrap au-main">
      <div className="au-copy">
        <span className="eyebrow">Sign in</span>
        <h1 className="h-page">Open your twin.</h1>
        <p className="lede">Patients see their own twin. The care team sees everyone they look after. All accounts here are synthetic demo patients.</p>
      </div>
      <div className="au-grid">
        <form className="card au-form" onSubmit={submit} noValidate>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="au-alt">
            New here?{' '}
            <Link to="/signup" className="tap-link">
              Create a patient account
            </Link>
          </p>
        </form>
        <section className="tint-card hue-y au-demo" aria-labelledby="demo-h">
          <h2 id="demo-h" className="display au-demo__h">
            Demo accounts
          </h2>
          <p className="au-demo__note">
            Password for all of them: <code className="mono">{DEMO_PASSWORD}</code>
          </p>
          <ul className="au-demo__list">
            {DEMO.map((d) => (
              <li key={d.email}>
                <button type="button" className="au-demo__btn" disabled={busy} onClick={() => void go(d.email, DEMO_PASSWORD)}>
                  <span className="au-demo__name">{d.label}</span>
                  <span className="au-demo__role">{d.role}</span>
                  <span className="au-demo__email mono">{d.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
