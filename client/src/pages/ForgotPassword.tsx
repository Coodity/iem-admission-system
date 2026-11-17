import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Alert, Field, Shell, btnGhost, btnPrimary, inputCls } from '../ui';

// FR-2.3: reset a forgotten password with a verification code (or reset link) sent to the email.
// In this sandbox the code is printed in the server terminal.
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staff = params.get('as') === 'staff';
  const linkToken = params.get('token') || '';
  const loginPath = staff ? '/?as=staff' : '/';

  const [step, setStep] = useState<'email' | 'reset'>(linkToken ? 'reset' : 'email');
  const [email, setEmail] = useState(params.get('email') || '');
  const [code, setCode] = useState(linkToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(''); setFields({});
    try {
      const r = await api<{ message: string }>('/auth/forgot-password', 'POST', { email });
      setNotice(`${r.message} It is valid for 30 minutes. (Sandbox: check the server terminal.)`);
      setCode('');
      setStep('reset');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setFields({});
    try {
      const r = await api<{ message: string; role: string }>('/auth/reset-password', 'POST',
        { email, code, password, confirmPassword });
      const target = r.role === 'applicant' ? '/' : '/?as=staff';
      navigate(target, { replace: true, state: { notice: r.message } });
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Forgot Password">
      {error && <Alert kind="error">{error}</Alert>}

      {step === 'email' ? (
        <form onSubmit={requestCode} className="space-y-4">
          <p className="text-sm text-gray-600">
            Enter the email address of your {staff ? 'staff' : 'applicant'} account. We will send a 6-digit verification code to reset your password.
          </p>
          <Field label="Email">
            <input type="email" required maxLength={100} autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full py-3`}>
            {busy ? 'Sending…' : 'Send verification code'}
          </button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4">
          {notice && <Alert kind="info">{notice}</Alert>}
          {linkToken && code === linkToken
            ? <Alert kind="success">Reset link opened for {email}. Choose a new password.</Alert>
            : (
              <>
                <p className="text-sm text-gray-600">Code sent to <span className="font-semibold">{email}</span>.</p>
                <Field label="Verification code" error={fields.code}>
                  <input required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputCls} tracking-[0.4em] font-mono`} placeholder="000000" />
                </Field>
              </>
            )}
          <Field label="New password" error={fields.password}>
            <input type="password" required minLength={8} maxLength={20} autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            <span className="block text-xs text-gray-400 mt-1">8-20 characters with 1 uppercase letter, 1 number and 1 symbol</span>
          </Field>
          <Field label="Confirm new password" error={fields.confirmPassword}>
            <input type="password" required minLength={8} maxLength={20} autoComplete="new-password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
          </Field>
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full py-3`}>
            {busy ? 'Saving…' : 'Reset password'}
          </button>
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <button type="button" disabled={busy} onClick={() => requestCode()} className={`${btnGhost} text-xs px-3 py-1`}>
              Send a new code
            </button>
            <button type="button" onClick={() => { setStep('email'); setError(''); setNotice(''); }}
              className="underline text-gray-500 hover:text-gray-800">Use a different email</button>
          </div>
        </form>
      )}

      <p className="text-xs text-gray-500 text-center">
        Remembered it? <Link to={loginPath} className="text-[#1b2f5e] underline">Back to login</Link>
      </p>
    </Shell>
  );
}
