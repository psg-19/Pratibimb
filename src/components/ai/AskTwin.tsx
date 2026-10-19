import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { AiDataNote } from './AiDataNote';
import { Sheet } from './Sheet';
import './ai.css';

interface Msg {
  id: number | string;
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = ['Why might I go low tonight?', 'What if I have 2 dosa and sambar for dinner?', 'How much does a walk after dinner help me?', 'ಇಂದು ರಾತ್ರಿ ಏನು ತಿನ್ನಲಿ?'];

/** "Ask your twin": a chat with an AI agent whose tools run this patient's twin. */
export function AskTwin({ patientId, firstName, open, onClose, aiEnabled }: { patientId: string; firstName: string; open: boolean; onClose: () => void; aiEnabled: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void api
      .chatHistory(patientId)
      .then((h) => setMsgs(h.messages))
      .catch(() => setMsgs([]));
  }, [open, patientId]);
  // Block body: scrollIntoView returns a Promise in current Chrome, and effects may only return a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs, status]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const answerId = `a${Date.now()}`;
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: question }, { id: answerId, role: 'assistant', text: '' }]);
    try {
      await api.chat(patientId, question, (e) => {
        if (e.type === 'tool') setStatus(e.label ?? 'Asking the twin');
        if (e.type === 'text' && e.text) {
          setStatus(null);
          setMsgs((m) => m.map((x) => (x.id === answerId ? { ...x, text: x.text + e.text } : x)));
        }
        if (e.type === 'error') setError(e.text ?? 'Something went wrong.');
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The twin could not answer.');
    } finally {
      // An answer that never arrived (a thrown error or an error event) leaves no empty bubble.
      setMsgs((m) => m.filter((x) => x.id !== answerId || x.text));
      setBusy(false);
      setStatus(null);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Ask your twin" labelId="ask-h">
      <p className="tw-muted-p" style={{ fontSize: 14 }}>
        Answers come from {firstName}'s twin — every number is a forecast or simulation it ran. It never suggests changing a medicine dose.
      </p>
      {!aiEnabled ? <p className="notice">Chat needs the AI service, which is off on this server (set GEMINI_API_KEY).</p> : <AiDataNote what="What you type" />}
      {/* Focusable so keyboard users can scroll a long conversation. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="at-log" role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
        {msgs.length === 0 ? (
          <div className="at-suggest">
            <span className="label">Try asking</span>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip at-suggest__chip" disabled={!aiEnabled || busy} onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`at-msg at-msg--${m.role}`}>
              <span className="sr-only">{m.role === 'user' ? 'You:' : 'Twin:'}</span>
              {m.text || (busy ? '…' : '')}
            </div>
          ))
        )}
        {status ? (
          <div className="at-status" role="status">
            <span className="at-status__dot" aria-hidden="true" />
            {status}…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="at-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="at-input">
          Your question
        </label>
        <input id="at-input" className="at-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about tonight, a meal or a walk…" disabled={!aiEnabled} autoComplete="off" />
        <button type="submit" className="btn btn-primary at-send" disabled={!aiEnabled || busy || !input.trim()}>
          Ask
        </button>
      </form>
      {msgs.length ? (
        <button
          type="button"
          className="btn btn-ghost at-clear"
          onClick={() => {
            void api.clearChat(patientId).then(() => setMsgs([])).catch((e: Error) => setError(e.message));
          }}
          disabled={busy}
        >
          Clear conversation
        </button>
      ) : null}
    </Sheet>
  );
}
