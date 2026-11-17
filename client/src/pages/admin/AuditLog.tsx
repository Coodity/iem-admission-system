import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, fmtDate, qs, type AuditEntry } from '../../api';
import { Alert, DateRange, Shell, btnGhost, btnPrimary, inputCls, tdCls, thCls } from '../../ui';

// FR-15: read-only view of the immutable audit trail. There are no edit or delete controls by design.
export default function AuditLog() {
  const [list, setList] = useState<AuditEntry[]>([]);
  const [q, setQ] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState('');

  const latestRequest = useRef(0); // only the newest request may update the list (defect D-04)
  const load = async () => {
    const requestNo = ++latestRequest.current;
    setError('');
    try {
      const rows = await api<AuditEntry[]>(`/admin/audit${qs({ q: q.trim(), ...range, limit: '500' })}`);
      if (requestNo === latestRequest.current) setList(rows);
    } catch (e) {
      if (requestNo === latestRequest.current) setError((e as Error).message);
    }
  };
  useEffect(() => { load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSearch(e: FormEvent) { e.preventDefault(); load(); }

  return (
    <Shell title="Admin — Audit Log" wide>
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">Audit entries are recorded automatically and cannot be edited or deleted.</Alert>
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={50} placeholder="Search staff, action, record or log ID"
          className={`${inputCls} flex-1 min-w-[200px]`} />
        <DateRange from={range.from} to={range.to} onChange={setRange} />
        <button type="submit" className={btnPrimary}>Search</button>
        <button type="button" className={`${btnGhost} text-xs`} onClick={() => { setQ(''); setRange({ from: '', to: '' }); }}>Clear</button>
      </form>
      <p className="text-xs text-gray-500">{list.length} entr{list.length === 1 ? 'y' : 'ies'} shown (latest 500).</p>
      <div className="border border-gray-200 rounded-sm overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-200">
            {['Log ID', 'Timestamp', 'User', 'Action', 'Target record'].map((h) => <th key={h} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a._id} className="border-b border-gray-100">
                <td className={`${tdCls} font-mono text-xs text-gray-500`}>{a.logId || '—'}</td>
                <td className={`${tdCls} text-xs text-gray-500 whitespace-nowrap`}>{fmtDate(a.at)}</td>
                <td className={tdCls}>{a.userName}{a.role && <span className="block text-xs text-gray-400">{a.role} · {a.userId}</span>}</td>
                <td className={tdCls}>{a.action}</td>
                <td className={`${tdCls} font-mono text-xs`}>{a.target}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No entries</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
