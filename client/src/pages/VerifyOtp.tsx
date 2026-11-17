import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Field, Shell, btnGhost, btnPrimary, inputCls } from '../ui';

export default function VerifyOtp() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const email = params.get('email') || '';
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [busy, setBusy] = useState(false);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setError(''); setInfo(''); setBusy(true);
        try {
            const r = await api<{ message: string }>('/auth/verify-otp', 'POST', { email, code });
            navigate('/', { state: { notice: r.message } });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }

    async function resend() {
        setError(''); setInfo('');
        try {
            await api('/auth/resend-otp', 'POST', { email });
            setInfo('A new code was sent. In sandbox mode, check the server terminal.');
        } catch (err) {
            setError((err as Error).message);
        }
    }

    return (
        <Shell title="Verify your email">
            <form onSubmit={onSubmit} className="space-y-4">
                <Alert kind="info">
                    We sent a 6-digit code for <b>{email || 'your email'}</b>. Sandbox mode: the code is printed in the
                    server terminal.
                </Alert>
                {error && <Alert kind="error">{error}</Alert>}
                {info && <Alert kind="success">{info}</Alert>}
                <Field label="Verification code">
                    <input required inputMode="numeric" maxLength={6} value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={inputCls} />
                </Field>
                <div className="flex gap-3">
                    <button type="submit" disabled={busy || code.length !== 6} className={btnPrimary}>Verify</button>
                    <button type="button" onClick={resend} className={btnGhost}>Resend code</button>
                </div>
            </form>
        </Shell>
    );
}
