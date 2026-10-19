import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { APP_NAME } from '../../config';
import { useAuth } from '../../auth/AuthContext';
import { DemoClock } from './DemoClock';
import { LogoMark } from './Logo';
import { PaletteSwitcher } from './PaletteSwitcher';
import './shell.css';

export function Header() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const clinician = me?.user.role === 'clinician';
  // The care team keeps the patient they are looking at when switching between twin and what-if.
  const [params] = useSearchParams();
  const picked = clinician ? params.get('patient') : null;
  const withPatient = (to: string) => (picked ? `${to}?patient=${encodeURIComponent(picked)}` : to);
  const links = [
    { to: '/', label: 'Overview' },
    ...(clinician ? [] : [{ to: '/connect', label: 'Connect data' }]),
    { to: withPatient('/twin'), label: 'Live twin' },
    { to: withPatient('/simulate'), label: 'What-if' },
    ...(clinician ? [{ to: '/care', label: 'Care team' }] : me ? [{ to: '/messages', label: 'Messages' }] : [{ to: '/care', label: 'Care team' }]),
  ];

  return (
    <header className="hdr">
      <div className="wrap hdr__inner">
        <Link to="/" className="hdr__brand">
          <LogoMark />
          <span className="hdr__name">{APP_NAME}</span>
        </Link>
        <div className="hdr__right">
          <nav aria-label="Primary" className="hdr__nav">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className="navlink">
                {l.label}
              </NavLink>
            ))}
          </nav>
          <PaletteSwitcher />
          {me ? (
            <div className="hdr__user">
              <span className="hdr__who" title={me.user.email}>
                {me.user.name}
              </span>
              <button
                type="button"
                className="navlink hdr__out"
                onClick={() => {
                  void logout().then(() => nav('/'));
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="navlink hdr__signin">
              Sign in
            </NavLink>
          )}
        </div>
      </div>
      {me ? (
        <div className="hdr__bar">
          <div className="wrap hdr__bar-inner">
            <span className="hdr__bar-note">Synthetic demo · the twin's world runs on a simulated clock</span>
            <DemoClock />
          </div>
        </div>
      ) : null}
    </header>
  );
}
