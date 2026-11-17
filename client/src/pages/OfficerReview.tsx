import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fmtDate, openFile, qs, type Application, type FeeType } from '../api';
import {
  Alert, DateRange, Shell, StatusBadge, btnDanger, btnGhost, btnPrimary, inputCls, tdCls, thCls,
} from '../ui';

const STATUSES = ['', 'Submitted', 'Under Review', 'Approved', 'Rejected'];
const SORTS = [
  { v: 'newest', label: 'Newest first' },
  { v: 'oldest', label: 'Oldest first' },
  { v: 'status', label: 'Status' },
  { v: 'course', label: 'Course' },
  { v: 'name', label: 'Applicant name' },
];

type ListRow = Pick<Application, '_id' | 'appId' | 'applicantName' | 'course' | 'campus' | 'status' | 'createdAt'>;

export default function OfficerReview() {
  const [list, setList] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectingDoc, setRejectingDoc] = useState<number | null>(null);
  const [rejectingApp, setRejectingApp] = useState(false);
  const [reason, setReason] = useState('');

  const loadList = useCallback(async () => {
    try {
      setList(await api<ListRow[]>(`/staff/applications${qs({ q: query.trim(), status, sort, ...range })}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query, status, sort, range]);

  // Filters and sort apply immediately; the text search applies on Search
  useEffect(() => { loadList(); }, [status, sort, range]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSearch(e: FormEvent) { e.preventDefault(); setError(''); loadList(); }

  function clearFilters() {
    setQuery(''); setStatus(''); setSort('newest'); setRange({ from: '', to: '' });
  }

  async function select(id: string) {
    setError(''); setRejectingDoc(null); setRejectingApp(false); setReason('');
    try { setSelected(await api<Application>(`/staff/applications/${id}`)); }
    catch (e) { setError((e as Error).message); }
  }

  async function act(path: string, body?: unknown) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const updated = await api<Application>(`/staff/applications/${selected._id}${path}`, 'POST', body ?? {});
      setSelected(updated);
      setRejectingDoc(null); setRejectingApp(false); setReason('');
      loadList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function view(i: number) {
    if (!selected) return;
    try { await openFile(`/staff/applications/${selected._id}/docs/${i}/file`); }
    catch (e) { setError((e as Error).message); }
  }

  const reviewing = selected?.status === 'Under Review';

  return (
    <Shell title="Officer / Admin — Review Applications" wide>
      {error && <Alert kind="error">{error}</Alert>}

      <form onSubmit={onSearch} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={50}
            className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Search by Application ID, name or course" />
          <button type="submit" className={btnPrimary}>Search</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`} aria-label="Status">
            {STATUSES.map((s) => <option key={s} value={s}>{s === 'Submitted' ? 'Draft' : s || 'All statuses'}</option>)}
          </select>
          <DateRange from={range.from} to={range.to} onChange={setRange} />
          <label className="flex items-center gap-1 text-xs text-gray-500">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputCls} w-auto`}>
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={clearFilters} className={`${btnGhost} text-xs`}>Clear</button>
        </div>
      </form>

      <p className="text-xs text-gray-500">
        <span className="font-semibold text-gray-700">{list.length}</span> application(s) found.
        {' '}"Draft" means not yet submitted by the applicant.
      </p>

      <div className="border border-gray-200 rounded-sm overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0">
            <tr className="bg-gray-50 border-b border-gray-200">
              {['App ID', 'Applicant', 'Course', 'Applied on', 'Status'].map((h) => <th key={h} className={thCls}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a._id} onClick={() => select(a._id)}
                className={`border-b border-gray-100 cursor-pointer ${selected?._id === a._id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <td className={`${tdCls} font-mono text-xs text-gray-600`}>{a.appId}</td>
                <td className={tdCls}>{a.applicantName}</td>
                <td className={`${tdCls} text-gray-600`}>{a.course}<span className="block text-xs text-gray-400">{a.campus}</span></td>
                <td className={`${tdCls} text-xs text-gray-500 whitespace-nowrap`}>{new Date(a.createdAt).toLocaleDateString()}</td>
                <td className={tdCls}><StatusBadge status={a.status} /></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No applications found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="space-y-4 border-t border-gray-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-800">
              {selected.applicantName}
              <span className="ml-2 text-xs font-normal text-gray-400 font-mono">
                {selected.appId} · {selected.course}, {selected.campus} · {selected.qualification} · {selected.marks}%
              </span>
            </p>
            <StatusBadge status={selected.status} />
          </div>
          {!reviewing && <Alert kind="info">This application is "{selected.status === 'Submitted' ? 'Draft' : selected.status}". Document and decision actions are only possible while it is Under Review.</Alert>}

          {/* FR-11 Document verification */}
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Documents</p>
            {selected.docs.map((doc, i) => (
              <div key={doc.label} className="border border-gray-200 rounded-sm px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm text-gray-700">
                    {doc.label} <StatusBadge status={doc.status} />
                    {doc.reuploads > 0 && (
                      <span className="ml-2 text-xs text-amber-700">Re-uploaded {doc.reuploads}×</span>
                    )}
                    {doc.reason && <span className="block text-xs text-red-600">Reason: {doc.reason}</span>}
                    {doc.verifiedBy && (
                      <span className="block text-xs text-gray-400">{doc.status} by {doc.verifiedBy} · {fmtDate(doc.verifiedAt)}</span>
                    )}
                  </span>
                  <button onClick={() => view(i)} className={`${btnGhost} text-xs`}>View file</button>
                  <button disabled={busy || !reviewing || doc.status === 'Verified'} className={`${btnPrimary} text-xs px-3`}
                    onClick={() => act(`/docs/${i}/review`, { decision: 'Verified' })}>Verify</button>
                  <button disabled={busy || !reviewing || doc.status === 'Rejected'} className={`${btnGhost} text-xs hover:border-red-400 hover:text-red-600`}
                    onClick={() => { setRejectingDoc(i); setReason(''); }}>Reject + reason</button>
                </div>
                {rejectingDoc === i && (
                  <div className="flex gap-2 mt-2">
                    <input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for rejection (required)" className={inputCls} />
                    <button disabled={busy || !reason.trim()} className={`${btnDanger} text-xs px-3`}
                      onClick={() => act(`/docs/${i}/review`, { decision: 'Rejected', reason })}>Confirm</button>
                    <button className={`${btnGhost} text-xs`} onClick={() => setRejectingDoc(null)}>Cancel</button>
                  </div>
                )}
              </div>
            ))}
            {selected.docs.length === 0 && <p className="text-sm text-gray-400">No documents uploaded.</p>}
          </section>

          {/* FR-12 Fee status recording */}
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fees</p>
            <FeePanel app={selected} type="Application" editable={reviewing} busy={busy}
              onRecord={(body) => act('/fee', body)} />
            {(selected.status === 'Approved' || selected.payments.some((p) => p.type === 'Admission')) && (
              <FeePanel app={selected} type="Admission" editable={selected.status === 'Approved'} busy={busy}
                onRecord={(body) => act('/fee', body)} />
            )}
          </section>

          {/* FR-13 Decision */}
          {reviewing && (
            rejectingApp ? (
              <div className="flex flex-wrap gap-2">
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for rejecting the application (required)" className={`${inputCls} flex-1 min-w-[200px]`} />
                <button disabled={busy || !reason.trim()} className={btnDanger}
                  onClick={() => act('/decision', { decision: 'Rejected', reason })}>Confirm reject</button>
                <button className={btnGhost} onClick={() => setRejectingApp(false)}>Cancel</button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button disabled={busy} onClick={() => act('/decision', { decision: 'Approved' })}
                  className={`${btnPrimary} flex-1 py-3 uppercase tracking-wide`}>Approve</button>
                <button disabled={busy} onClick={() => { setRejectingApp(true); setReason(''); }}
                  className={`${btnDanger} flex-1 py-3 uppercase tracking-wide`}>Reject</button>
              </div>
            )
          )}
          {selected.decisionReason && <Alert kind="error">Decision reason: {selected.decisionReason}</Alert>}

          {/* FR-13.1 Status history log */}
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status history</p>
            <div className="border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-200">
                  {['Status', 'Changed by', 'Timestamp'].map((h) => <th key={h} className={thCls}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {selected.history.map((h, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className={tdCls}><StatusBadge status={h.status} /></td>
                      <td className={tdCls}>{h.by}</td>
                      <td className={`${tdCls} text-xs text-gray-500 whitespace-nowrap`}>{fmtDate(h.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function FeePanel({ app, type, editable, busy, onRecord }: {
  app: Application; type: FeeType; editable: boolean; busy: boolean;
  onRecord: (body: { type: FeeType; status: 'Pending' | 'Paid'; amount: number }) => void;
}) {
  const payment = app.payments.find((p) => p.type === type && p.status === 'Success');
  const records = (app.feeRecords ?? []).filter((r) => r.type === type);
  const latest = records[records.length - 1];
  // Older applications were verified before fee records existed
  const legacy = !latest && type === 'Application' && app.feeVerified;
  const expected = app.feeSchedule?.[type] ?? null;
  const [status, setStatus] = useState<'Pending' | 'Paid'>(latest?.status ?? (payment ? 'Paid' : 'Pending'));
  const [amount, setAmount] = useState(String(expected ?? ''));

  useEffect(() => { setAmount(String(expected ?? '')); }, [expected, app._id]);
  useEffect(() => { setStatus(latest?.status ?? (payment ? 'Paid' : 'Pending')); }, [app._id, latest?.status, !!payment]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="border border-gray-200 rounded-sm px-3 py-2 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-700">{type} fee {expected !== null && <span className="text-gray-400 font-normal">(schedule ₹{expected})</span>}</span>
        <span className="text-xs">
          Applicant payment:{' '}
          {payment
            ? <span className="text-green-700">₹{payment.amount} · {payment.reference} · {fmtDate(payment.at)}</span>
            : <span className="text-amber-600">none received</span>}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        Recorded status:{' '}
        {latest ? (
          <><StatusBadge status={latest.status} /> ₹{latest.amount} · recorded by {latest.recordedBy} · {fmtDate(latest.recordedAt)}</>
        ) : legacy ? (
          <><StatusBadge status="Paid" /> verified by {app.feeVerifiedBy ?? 'staff'}</>
        ) : 'not recorded yet'}
      </p>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as 'Pending' | 'Paid')}
            className={`${inputCls} w-auto`} aria-label={`${type} fee status`}>
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
          </select>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} w-32`} aria-label="Amount" />
          <button disabled={busy || amount === ''} className={`${btnGhost} text-xs`}
            onClick={() => onRecord({ type, status, amount: Number(amount) })}>Record fee status</button>
        </div>
      )}
      {records.length > 1 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">Earlier records ({records.length - 1})</summary>
          <ul className="mt-1 space-y-0.5">
            {records.slice(0, -1).reverse().map((r, i) => (
              <li key={i}>{r.status} · ₹{r.amount} · {r.recordedBy} · {fmtDate(r.recordedAt)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
