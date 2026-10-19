import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from './icons';

/** Large primary call-to-action that navigates (a real link, styled as a pill button). */
export function PrimaryLink({ to, children, className = 'btn-lg' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`btn btn-primary ${className}`}>
      {children}
      <ArrowRight />
    </Link>
  );
}

/** Inline accent link with a trailing arrow. */
export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-link">
      {children}
      <ArrowRight size={16} />
    </Link>
  );
}
