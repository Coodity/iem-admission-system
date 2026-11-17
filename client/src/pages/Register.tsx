import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Alert, Field, Shell, btnPrimary, inputCls } from '../ui';

const empty = { name: '', email: '', phone: '', dob: '', password: '', confirmPassword: '' };

export default function Register() {
    const navigate = useNavigate();
    const [form, setForm] = useState(empty);
    const [fields, setFields] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [k]: e.target.value }));

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setError(''); setFields({}); setBusy(true);
        try {
            await api('/auth/register', 'POST', form);
            navigate(`/verify?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
        } catch (err) {
            const ae = err as ApiError;
            setError(ae.message);
            setFields(ae.fields || {});
        } finally {
            setBusy(false);
        }
    }

    return (
        <Shell title="Applicant Registration">
            <form onSubmit={onSubmit} className="space-y-4">
                {error && <Alert kind="error">{error}</Alert>}
                <Field label="Full name" error={fields.name}>
                    <input required value={form.name} onChange={set('name')} className={inputCls} />
                </Field>
                <Field label="Email" error={fields.email}>
                    <input type="email" required value={form.email} onChange={set('email')} className={inputCls} />
                </Field>
                <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Phone (10 digits)" error={fields.phone}>
                        <input required inputMode="numeric" maxLength={10} value={form.phone} onChange={set('phone')} className={inputCls} />
                    </Field>
                    <Field label="Date of birth" error={fields.dob}>
                        <input type="date" required value={form.dob} onChange={set('dob')} className={inputCls} />
                    </Field>
                </div>
                <Field label="Password" error={fields.password}>
                    <input type="password" required value={form.password} onChange={set('password')} className={inputCls} />
                </Field>
                <p className="text-xs text-gray-400 -mt-3">8-20 characters with an uppercase letter, a number and a symbol.</p>
                <Field label="Confirm password" error={fields.confirmPassword}>
                    <input type="password" required value={form.confirmPassword} onChange={set('confirmPassword')} className={inputCls} />
                </Field>
                <button type="submit" disabled={busy} className={`${btnPrimary} w-full py-3 uppercase tracking-wide`}>
                    {busy ? 'Creating account…' : 'Register'}
                </button>
                <p className="text-xs text-gray-500 text-center">
                    Already registered? <Link to="/" className="text-[#1b2f5e] underline">Log in</Link>
                </p>
            </form>
        </Shell>
    );
}
