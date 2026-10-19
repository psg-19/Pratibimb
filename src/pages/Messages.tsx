import { useEffect, useState, type FormEvent } from 'react';
import { clockIST, dayIST } from '../../shared/time';
import { api } from '../api/client';
import { useAsync } from '../api/hooks';
import { useLive } from '../api/live';
import { useAuth } from '../auth/AuthContext';
import { PageError, PageLoading } from '../auth/RequireAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import './messages.css';

const WHO = { clinician: 'Care team', twin: 'Your twin', patient: 'You' } as const;

export function Messages() {
  usePageTitle('Messages');
  const { me } = useAuth();
  const pid = me?.patient?.id ?? null;
  const msgs = useAsync(() => api.messages(pid!), [pid]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLive((e) => e.type === 'message' && msgs.reload(), pid);
  useEffect(() => {
    if (pid && msgs.data?.some((m) => !m.read && m.sender !== 'patient')) void api.markRead(pid).catch((e: Error) => setError(e.message));
  }, [pid, msgs.data]);
  if (msgs.error && !msgs.data) return <PageError message={msgs.error.message} retry={msgs.reload} />;
  if (!pid || !msgs.data) return <PageLoading />;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(pid, text.trim(), me?.patient?.language ?? 'en');
      setText('');
      msgs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap ms-main">
      <div className="stack" style={{ gap: 12, maxWidth: '44rem' }}>
        <span className="eyebrow">Messages</span>
        <h1 className="h-page">From your care team and your twin.</h1>
        <p className="lede">Nudges your twin sends, and notes from Dr. [CLINICIAN NAME]. Reply here — urgent problems need a phone call.</p>
      </div>
      <ol className="ms-list" aria-label="Messages, newest first">
        {msgs.data.length === 0 ? <li className="ms-empty">No messages yet.</li> : null}
        {msgs.data.map((m) => (
          <li key={m.id} className={`ms-item ms-item--${m.sender}`}>
            <div className="ms-item__head">
              <span className="ms-item__who">{m.sender === 'clinician' ? m.author : WHO[m.sender]}</span>
              <span className="mono ms-item__at">
                {dayIST(m.sentAt)} · {clockIST(m.sentAt)}
              </span>
              {m.kind !== 'message' ? <span className="pill-tag ms-item__kind">{m.kind === 'nudge' ? 'Nudge' : 'Plan'}</span> : null}
            </div>
            <p className="ms-item__body" lang={m.language}>
              {m.body}
            </p>
          </li>
        ))}
      </ol>
      <form className="card ms-reply" onSubmit={send}>
        <label className="field">
          <span>Reply to your care team</span>
          <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn btn-primary ms-send" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
