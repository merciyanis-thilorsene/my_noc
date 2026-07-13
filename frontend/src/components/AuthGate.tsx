import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { checkSession, login } from '../api';
import { L } from '../lib/i18n';

type Phase = 'checking' | 'authed' | 'locked';

/**
 * Gates the app behind the access code. Probes /api/session once: a 200 (valid session, or
 * the gate being disabled server-side) renders the app; a 401 shows the login screen. On a
 * successful login it re-probes rather than assuming, so the app only mounts once the cookie
 * is actually accepted.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = () => {
    checkSession()
      .then((ok) => setPhase(ok ? 'authed' : 'locked'))
      .catch(() => setPhase('locked'));
  };

  useEffect(probe, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting || code === '') return;
    setSubmitting(true);
    setError(null);
    login(code)
      .then((r) => {
        if (r.ok) {
          setCode('');
          setPhase('checking');
          probe();
        } else if (r.status === 429) {
          setError(L.auth.tooMany(r.retryAfter ?? 60));
        } else {
          setError(L.auth.wrongCode);
        }
      })
      .catch(() => setError(L.auth.networkError))
      .finally(() => setSubmitting(false));
  };

  if (phase === 'checking') {
    return <div className="login-checking">{L.common.loading}</div>;
  }
  if (phase === 'authed') {
    return <>{children}</>;
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="mark" src={`${import.meta.env.BASE_URL}sharingan.svg`} alt="Sharingan" />
        <h1>{L.auth.title}</h1>
        <p className="sub">{L.auth.subtitle}</p>
        <form className="login-form" onSubmit={onSubmit}>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder={L.auth.codePlaceholder}
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
          />
          <button type="submit" className="btn primary" disabled={submitting || code === ''}>
            <span className="icon">lock_open</span>
            {submitting ? L.auth.submitting : L.auth.submit}
          </button>
          <div className="login-error">
            {error !== null ? <><span className="icon">error</span>{error}</> : null}
          </div>
        </form>
      </div>
    </div>
  );
}
