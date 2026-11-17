import { useEffect, useState, type FormEvent } from 'react';
import { api, type StaffMember } from '../../api';
import { useAuth } from '../../AuthContext';
import { Alert, Field, Shell, StatusBadge, btnGhost, btnPrimary, inputCls, tdCls, thCls } from '../../ui';

// FR-18: create, edit, deactivate staff accounts and assign roles
type Role = StaffMember['role'];
const ROLE_LABEL: Record<Role, string> = { officer: 'Admission Officer', admin: 'Administrator' };

export default function Staff() {
  const { user } = useAuth();
  const [list, setList] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'officer' as Role });
  const [editing, setEditing] = useState<{ id: string; name: string; role: Role } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<StaffMember[]>('/admin/staff').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(ok); load(); return true; }
    catch (err) { setError((err as Error).message); return false; }
    finally { setBusy(false); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api('/admin/staff', 'POST', form), 'Staff account created.')) {
      setForm({ name: '', email: '', password: '', role: 'officer' });
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (await run(() => api(`/admin/staff/${editing.id}`, 'PATCH', { name: editing.name, role: editing.role }), 'Staff account updated.')) {
      setEditing(null);
    }
  }

  return (
    <Shell title="Admin — Staff Accounts" wide>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <form onSubmit={create} className="grid sm:grid-cols-2 gap-3 border border-gray-200 rounded-sm p-4">
        <p className="sm:col-span-2 text-sm font-semibold text-gray-800">Add a staff member</p>
        <Field label="Full name">
          <input required maxLength={100} value={form.name} className={inputCls}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Staff email">
          <input required type="email" maxLength={100} value={form.email} className={inputCls}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Temporary password (8-20 chars, 1 uppercase, 1 number, 1 symbol)">
          <input required type="password" minLength={8} maxLength={20} value={form.password} className={inputCls}
            autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Role">
          <select value={form.role} className={inputCls} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="officer">Admission Officer</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <button type="submit" disabled={busy} className={btnPrimary}>Create account</button>
        </div>
      </form>

      <p className="text-xs text-gray-500">{list.length} staff account(s). Deactivated staff cannot log in and are signed out immediately.</p>
      <div className="border border-gray-200 rounded-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 border-b border-gray-200">
            {['Name', 'Email', 'Role', 'Status', ''].map((h) => <th key={h} className={thCls}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((s) => {
              const self = s._id === user?.id;
              const isEditing = editing?.id === s._id;
              return (
                <tr key={s._id} className="border-b border-gray-100">
                  <td className={tdCls}>
                    {isEditing
                      ? <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
                      : <>{s.name}{self && <span className="ml-1 text-xs text-gray-400">(you)</span>}</>}
                  </td>
                  <td className={`${tdCls} text-gray-600`}>{s.email}</td>
                  <td className={tdCls}>
                    {isEditing ? (
                      <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })} className={inputCls}>
                        <option value="officer">Admission Officer</option>
                        <option value="admin">Administrator</option>
                      </select>
                    ) : ROLE_LABEL[s.role]}
                  </td>
                  <td className={tdCls}><StatusBadge status={s.active ? 'Active' : 'Deactivated'} /></td>
                  <td className={`${tdCls} whitespace-nowrap text-right`}>
                    {self ? null : isEditing ? (
                      <>
                        <button disabled={busy} onClick={saveEdit} className={`${btnPrimary} text-xs px-2 py-1`}>Save</button>{' '}
                        <button onClick={() => setEditing(null)} className={`${btnGhost} text-xs px-2 py-1`}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing({ id: s._id, name: s.name, role: s.role })} className={`${btnGhost} text-xs px-2 py-1`}>Edit</button>{' '}
                        <button disabled={busy} className={`${btnGhost} text-xs px-2 py-1`}
                          onClick={() => run(() => api(`/admin/staff/${s._id}`, 'PATCH', { active: !s.active }),
                            s.active ? `${s.name} deactivated.` : `${s.name} activated.`)}>
                          {s.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
