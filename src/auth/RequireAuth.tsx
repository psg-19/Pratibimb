import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../../shared/api';
import { useAuth } from './AuthContext';

export function RequireAuth({ children, only }: { children: ReactNode; only?: Role }) {
  const { me, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <PageLoading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (only && me.user.role !== only) {
    return (
      <div className="wrap" style={{ paddingTop: 80, paddingBottom: 120 }}>
        <h1 className="h-page">{only === 'clinician' ? 'This page is for the care team.' : 'This page is for patients.'}</h1>
        <p className="lede" style={{ marginTop: 12 }}>{only === 'clinician' ? 'Sign in with a clinician account to see the triage list.' : 'Clinicians message patients from the care-team view.'}</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="wrap page-loading" role="status">
      <span className="page-loading__dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function PageError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="wrap" style={{ paddingTop: 72, paddingBottom: 100 }}>
    <p className="form-error" role="alert">{message}</p>
    {retry ? <button type="button" className="btn btn-primary" onClick={retry}>Try again</button> : null}
  </div>;
}
