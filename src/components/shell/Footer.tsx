import { APP_NAME, PLACEHOLDER } from '../../config';

export function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap ftr__inner">
        <span>{APP_NAME} — research prototype. Not a medical device. All patient data shown is synthetic.</span>
        <span>{PLACEHOLDER.contactEmail}</span>
      </div>
    </footer>
  );
}
