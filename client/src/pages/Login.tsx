import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { homeFor, useAuth, type Portal } from '../AuthContext';
import { Alert, Field, Shell, btnPrimary, inputCls } from '../ui';

// Separate login portals: Applicant (FR-2) and Faculty / Staff (FR-8)
const PORTALS: { key: Portal; label: string; hint: string }[] = [
  { key: 'applicant', label: 'Applicant / Student', hint: 'Log in with the email you registered with.' },
  { key: 'staff', label: 'Faculty / Staff', hint: 'For Admission Officers and Administrators. Use your staff email.' },
];

export default function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { notice?: string } };
  const [params, setParams] = useSearchParams();
  const portal: Portal = params.get('as') === 'staff' ? 'staff' : 'applicant';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(sessionStorage.getItem('logoutMsg') || '');
  const [busy, setBusy] = useState(false);
  sessionStorage.removeItem('logoutMsg');

  if (ready && user) return <Navigate to={homeFor(user.role)} replace />;

  function switchPortal(p: Portal) {
    if (p === portal) return;
    setError('');
    setPassword('');
    setParams(p === 'staff' ? { as: 'staff' } : {}, { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email, password, portal);
      navigate(homeFor(u.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = PORTALS.find((p) => p.key === portal)!;

  return (
    <Shell title={portal === 'staff' ? 'Faculty / Staff Login' : 'Applicant Login'}>
      <div role="tablist" aria-label="Login type" className="grid grid-cols-2 border border-gray-200 rounded-sm overflow-hidden">
        {PORTALS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={portal === p.key} onClick={() => switchPortal(p.key)}
            className={`py-2.5 text-sm font-semibold transition-colors ${portal === p.key
              ? 'bg-[#1b2f5e] text-white'
              : 'bg-white text-gray-600 hover:text-[#1b2f5e] hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-xs text-gray-500">{current.hint}</p>
        {location.state?.notice && <Alert kind="success">{location.state.notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={portal === 'staff' ? 'Staff email' : 'Email'}>
          <input type="email" required autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </Field>
        <div className="text-right -mt-2">
          <Link to={`/forgot-password${portal === 'staff' ? '?as=staff' : ''}`}
            className="text-xs text-[#1b2f5e] underline">Forgot password?</Link>
        </div>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full py-3 uppercase tracking-wide`}>
          {busy ? 'Logging in…' : portal === 'staff' ? 'Staff login' : 'Login'}
        </button>
        {portal === 'applicant' ? (
          <p className="text-xs text-gray-500 text-center">
            New applicant? <Link to="/register" className="text-[#1b2f5e] underline">Create an account</Link>
          </p>
        ) : (
          <p className="text-xs text-gray-500 text-center">
            Staff accounts are created by the Administrator. Contact the admission office if you cannot log in.
          </p>
        )}
      </form>
    </Shell>
  );
}
