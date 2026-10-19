import { PrimaryLink } from '../components/ui/Links';
import { usePageTitle } from '../hooks/usePageTitle';

export function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="wrap" style={{ paddingTop: 96, paddingBottom: 120, display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }}>
      <span className="eyebrow">404</span>
      <h1 className="h-page">This page has no twin.</h1>
      <p className="lede">The address doesn’t match any screen in this prototype.</p>
      <PrimaryLink to="/">Back to the overview</PrimaryLink>
    </div>
  );
}
