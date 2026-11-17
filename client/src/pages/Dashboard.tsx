import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Application, type Note } from '../api';
import { Alert, Shell, StatusBadge, btnGhost, btnPrimary } from '../ui';

const fmt = (d: string) => new Date(d).toLocaleString();

export default function Dashboard() {
  const [app, setApp] = useState<Application | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, n] = await Promise.all([
        api<Application | null>('/applications/mine'),
        api<Note[]>('/notifications'),
      ]);
      setApp(a);
      setNotes(n);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function payAdmission() {
    setBusy(true); setError('');
    try {
      setApp(await api<Application>('/applications/pay', 'POST', { type: 'Admission' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Shell title="Applicant Dashboard"><p className="text-sm text-gray-500">Loading…</p></Shell>;

  if (!app) {
    return (
      <Shell title="Applicant Dashboard">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-gray-700">You have not started an application yet.</p>
        <Link to="/apply" className={`${btnPrimary} inline-block`}>Start application</Link>
      </Shell>
    );
  }

  const count = (s: string) => app.docs.filter((d) => d.status === s).length;
  const appPaid = app.payments.find((p) => p.type === 'Application' && p.status === 'Success');
  const admPaid = app.payments.find((p) => p.type === 'Admission' && p.status === 'Success');
  const rejectedDocs = app.docs.filter((d) => d.status === 'Rejected');

  return (
    <Shell title="Applicant Dashboard">
      {error && <Alert kind="error">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-gray-400 font-mono">{app.appId}</p>
          <p className="text-sm font-semibold text-gray-800">{app.course} — {app.campus}</p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {app.status === 'Submitted' && (
        <Alert kind="info">
          Your application is not submitted yet. <Link to="/apply" className="underline font-semibold">Continue</Link>
        </Alert>
      )}
      {rejectedDocs.length > 0 && app.status === 'Under Review' && (
        <Alert kind="error">
          {rejectedDocs.map((d) => `${d.label}: ${d.reason}`).join(' | ')}{' '}
          <Link to="/apply" className="underline font-semibold">Re-upload</Link>
        </Alert>
      )}
      {app.status === 'Rejected' && app.decisionReason && <Alert kind="error">Reason: {app.decisionReason}</Alert>}

      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="border border-gray-200 rounded-sm p-3">
          <p className="text-xs text-gray-400">Documents</p>
          <p>{count('Verified')} verified, {count('Pending')} pending, {count('Rejected')} rejected</p>
        </div>
        <div className="border border-gray-200 rounded-sm p-3">
          <p className="text-xs text-gray-400">Application fee</p>
          <p>{appPaid ? `Paid ₹${appPaid.amount}` : 'Pending'}</p>
          {appPaid && <p className="text-xs text-gray-400">{app.feeVerified ? 'Confirmed by admission office' : 'Awaiting office confirmation'}</p>}
        </div>
        <div className="border border-gray-200 rounded-sm p-3">
          <p className="text-xs text-gray-400">Admission fee</p>
          <p>{admPaid ? `Paid ₹${admPaid.amount}` : app.status === 'Approved' ? 'Due' : 'Not yet due'}</p>
        </div>
      </div>

      {app.status === 'Approved' && !admPaid && (
        <button onClick={payAdmission} disabled={busy} className={btnPrimary}>
          {busy ? 'Processing…' : 'Pay admission fee (sandbox)'}
        </button>
      )}

      <div>
        <p className="text-sm font-semibold text-gray-800 mb-2">Status timeline</p>
        <ol className="border-l-2 border-gray-200 ml-2 space-y-3">
          {app.history.map((h, i) => (
            <li key={i} className="pl-4 relative">
              <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-[#1b2f5e]" />
              <p className="text-sm text-gray-800">{h.status === 'Submitted' ? 'Application created' : h.status}</p>
              <p className="text-xs text-gray-400">{fmt(h.at)}</p>
            </li>
          ))}
        </ol>
      </div>

      {notes.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-800 mb-2">Notifications</p>
          <ul className="space-y-2">
            {notes.slice(0, 5).map((n) => (
              <li key={n._id} className="border border-gray-200 rounded-sm px-3 py-2 text-sm">
                {n.content} <span className="block text-xs text-gray-400">{fmt(n.sentAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3 print:hidden">
        <Link to="/apply" className={btnGhost}>View application</Link>
        {appPaid && <button onClick={() => window.print()} className={btnGhost}>Print receipt</button>}
      </div>
    </Shell>
  );
}
