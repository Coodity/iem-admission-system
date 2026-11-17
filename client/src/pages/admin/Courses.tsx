import { useEffect, useState, type FormEvent } from 'react';
import { api, type Course } from '../../api';
import { Alert, Field, Shell, StatusBadge, btnGhost, btnPrimary, inputCls, tdCls, thCls } from '../../ui';

// FR-17: add, edit and deactivate courses, campuses, eligibility and fees
const EMPTY = { name: '', campuses: '', minPercent: '', fee: '', active: true };

export default function Courses() {
  const [list, setList] = useState<Course[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<Course[]>('/admin/courses').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  function edit(c: Course) {
    setEditingId(c._id); setError(''); setNotice('');
    setForm({ name: c.name, campuses: c.campuses.join(', '), minPercent: String(c.minPercent), fee: String(c.fee), active: c.active !== false });
  }
  function reset() { setEditingId(null); setForm(EMPTY); }

  const payload = (f: typeof form) => ({
    name: f.name, campuses: f.campuses.split(',').map((s) => s.trim()).filter(Boolean),
    minPercent: Number(f.minPercent), fee: Number(f.fee), active: f.active,
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (editingId) await api(`/admin/courses/${editingId}`, 'PUT', payload(form));
      else await api('/admin/courses', 'POST', payload(form));
      setNotice(editingId ? 'Course updated.' : 'Course added.');
      reset(); load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function toggle(c: Course) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/admin/courses/${c._id}`, 'PUT', { ...c, active: c.active === false });
      load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Shell title="Admin — Courses & Campuses" wide>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 border border-gray-200 rounded-sm p-4">
        <p className="sm:col-span-2 text-sm font-semibold text-gray-800">{editingId ? 'Edit course' : 'Add a course'}</p>
        <Field label="Course name">
          <input required maxLength={100} value={form.name} className={inputCls}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Campuses (comma separated)">
          <input required value={form.campuses} className={inputCls} placeholder="Main Campus, City Campus"
            onChange={(e) => setForm({ ...form, campuses: e.target.value })} />
        </Field>
        <Field label="Minimum qualifying marks (%)">
          <input required type="number" min={0} max={100} step="0.01" value={form.minPercent} className={inputCls}
            onChange={(e) => setForm({ ...form, minPercent: e.target.value })} />
        </Field>
        <Field label="Admission fee (₹)">
          <input required type="number" min={0} value={form.fee} className={inputCls}
            onChange={(e) => setForm({ ...form, fee: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active (shown to applicants)
        </label>
        <div className="flex gap-2 sm:justify-end">
          {editingId && <button type="button" onClick={reset} className={btnGhost}>Cancel</button>}
          <button type="submit" disabled={busy} className={btnPrimary}>{editingId ? 'Save changes' : 'Add course'}</button>
        </div>
      </form>

      <p className="text-xs text-gray-500">{list.length} course(s). Inactive courses are hidden from the applicant course list.</p>
      <div className="border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b border-gray-200">
            {['Course', 'Campuses', 'Min %', 'Fee', 'Status', ''].map((h) => <th key={h} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c._id} className="border-b border-gray-100">
                <td className={tdCls}>{c.name}</td>
                <td className={`${tdCls} text-gray-600`}>{c.campuses.join(', ')}</td>
                <td className={tdCls}>{c.minPercent}</td>
                <td className={tdCls}>₹{c.fee}</td>
                <td className={tdCls}><StatusBadge status={c.active === false ? 'Inactive' : 'Active'} /></td>
                <td className={`${tdCls} whitespace-nowrap text-right`}>
                  <button onClick={() => edit(c)} className={`${btnGhost} text-xs px-2 py-1`}>Edit</button>{' '}
                  <button disabled={busy} onClick={() => toggle(c)} className={`${btnGhost} text-xs px-2 py-1`}>
                    {c.active === false ? 'Activate' : 'Deactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
