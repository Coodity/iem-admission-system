import { useEffect, useState } from 'react';
import { api, fmtDate, qs, type Note } from '../../api';
import { Alert, DateRange, Shell, StatusBadge, inputCls, tdCls, thCls } from '../../ui';

// FR-14: log of every notification sent through the sandboxed email service, with its delivery result
export default function Notifications() {
  const [list, setList] = useState<Note[]>([]);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true; // ignore a response that arrives after the filters changed (defect D-04)
    setError('');
    api<Note[]>(`/admin/notifications${qs({ status, ...range, limit: '500' })}`)
      .then((rows) => { if (current) setList(rows); })
      .catch((e) => { if (current) setError((e as Error).message); });
    return () => { current = false; };
  }, [status, range]);

  const failed = list.filter((n) => n.deliveryStatus === 'Failed').length;

  return (
    <Shell title="Admin — Notification Log" wide>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`} aria-label="Delivery status">
          <option value="">All results</option>
          <option value="Sent">Sent</option>
          <option value="Failed">Failed</option>
        </select>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
      </div>
      <p className="text-xs text-gray-500">{list.length} notification(s) shown{failed > 0 && `, ${failed} failed`}.</p>
      <div className="border border-gray-200 rounded-sm overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-200">
            {['Sent at', 'Application', 'Recipient', 'Trigger', 'Content', 'Delivery'].map((h) => <th key={h} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((n) => (
              <tr key={n._id} className="border-b border-gray-100">
                <td className={`${tdCls} text-xs text-gray-500 whitespace-nowrap`}>{fmtDate(n.sentAt)}</td>
                <td className={`${tdCls} font-mono text-xs`}>{n.appId}</td>
                <td className={`${tdCls} text-xs`}>{n.applicantEmail || '—'}</td>
                <td className={tdCls}>{n.trigger}</td>
                <td className={`${tdCls} text-xs text-gray-600 min-w-[220px]`}>{n.content}</td>
                <td className={tdCls}>
                  <StatusBadge status={n.deliveryStatus} />
                  {n.failureReason && <span className="block text-xs text-red-600">{n.failureReason}</span>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No notifications</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
