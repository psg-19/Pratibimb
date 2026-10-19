import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** The patient whose twin is shown: yourself, or (for the care team) the one picked in ?patient=. */
export function usePatientId(): string | null {
  const { me } = useAuth();
  const [params] = useSearchParams();
  if (!me) return null;
  if (me.user.role === 'patient') return me.patient?.id ?? null;
  return params.get('patient') ?? 'suresh';
}
