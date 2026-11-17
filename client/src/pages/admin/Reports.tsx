import { useEffect, useState } from 'react';
import { api, downloadFile, fmtDate, qs, type Report } from '../../api';
import { Alert, DateRange, Shell, btnGhost, inputCls, tdCls, thCls } from '../../ui';

// FR-19: summary reports by course, status or date, with optional date range and CSV / PDF export
const TYPES = [
  { v: 'course', label: 'By course' },
  { v: 'status', label: 'By status' },
  { v: 'date', label: 'By date' },
];

export default function Reports() {
  const [type, setType] = useState('course');
  const [range, setRange] = useState({ from: '', to: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const query = qs({ type, ...range });

  useEffect(() => {
    let current = true; // ignore a response that arrives after the filters changed (defect D-04)
    setError('');
    api<Report>(`/admin/reports${query}`)
      .then((r) => { if (current) setReport(r); })
      .catch((e) => { if (current) setError((e as Error).message); });
    return () => { current = false; };
  }, [query]);

  async function exportAs(format: 'csv' | 'pdf') {
    setBusy(format); setError('');
    try { await downloadFile(`/admin/reports${query}&format=${format}`, `report-${type}.${format}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  async function exportList() {
    setBusy('list'); setError('');
    try { await downloadFile(`/admin/reports/applications${qs(range)}`, 'applications.csv'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }

  const numericFrom = report?.type === 'course' ? 2 : 1;

  return (
    <Shell title="Admin — Reports" wide>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${inputCls} w-auto`} aria-label="Report type">
          {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <button disabled={!!busy} onClick={() => exportAs('csv')} className={`${btnGhost} text-xs`}>
            {busy === 'csv' ? 'Exporting…' : 'Export CSV'}
          </button>
          <button disabled={!!busy} onClick={() => exportAs('pdf')} className={`${btnGhost} text-xs`}>
            {busy === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
          <button disabled={!!busy} onClick={exportList} className={`${btnGhost} text-xs`}>
            {busy === 'list' ? 'Exporting…' : 'Full application list (CSV)'}
          </button>
        </div>
      </div>

      {report && (
        <>
          <div>
            <p className="text-sm font-semibold text-gray-800">{report.title}</p>
            <p className="text-xs text-gray-500">
              {report.from || report.to ? `${report.from || 'start'} to ${report.to || 'today'}` : 'All dates'}
              {' · '}{report.total} application(s){' · '}generated {fmtDate(report.generatedAt)}
            </p>
          </div>
          <div className="border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-200">
                {report.columns.map((c, i) => (
                  <th key={c} className={`${thCls} ${i >= numericFrom ? 'text-right' : ''}`}>{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {r.map((v, j) => (
                      <td key={j} className={`${tdCls} ${j >= numericFrom ? 'text-right tabular-nums' : ''} ${j === r.length - 1 && report.type !== 'status' ? 'font-semibold' : ''}`}>{v}</td>
                    ))}
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr><td colSpan={report.columns.length} className="px-3 py-4 text-center text-gray-400">No applications in this range</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
