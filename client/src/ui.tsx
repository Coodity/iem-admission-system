import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './AuthContext';

export const inputCls =
    'w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-[#1b2f5e] focus:ring-1 focus:ring-[#1b2f5e]';
export const btnPrimary =
    'bg-[#1b2f5e] text-white text-sm font-semibold px-5 py-2 hover:bg-[#111e3d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost =
    'border border-gray-300 text-gray-600 text-sm font-medium px-4 py-2 hover:border-[#1b2f5e] hover:text-[#1b2f5e] transition-colors disabled:opacity-50';
export const btnDanger =
    'border-2 border-red-500 text-red-600 text-sm font-semibold px-5 py-2 hover:bg-red-50 transition-colors disabled:opacity-50';
export const thCls = 'text-left text-xs font-semibold text-gray-500 px-3 py-2 whitespace-nowrap';
export const tdCls = 'px-3 py-2 align-top';

// Staff navigation, shown only for modules in the user's permission set (FR-16, IR-1)
const STAFF_NAV: { to: string; label: string; perm: string }[] = [
    { to: '/officer', label: 'Applications', perm: 'applications:review' },
    { to: '/admin/courses', label: 'Courses', perm: 'courses:manage' },
    { to: '/admin/staff', label: 'Staff', perm: 'staff:manage' },
    { to: '/admin/reports', label: 'Reports', perm: 'reports:view' },
    { to: '/admin/notifications', label: 'Notifications', perm: 'notifications:view' },
    { to: '/admin/audit', label: 'Audit log', perm: 'audit:view' },
];

export function Shell({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
    const { user, logout, can } = useAuth();
    const nav = user && user.role !== 'applicant' ? STAFF_NAV.filter((n) => can(n.perm)) : [];
    return (
        <div className="min-h-screen bg-[#f4f5f7] px-4 py-6">
            <div className={`${wide ? 'max-w-5xl' : 'max-w-2xl'} mx-auto`}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1 print:hidden">
                    <span className="text-xs font-mono tracking-widest text-gray-400 uppercase">IEM Admission Portal</span>
                    {user && (
                        <span className="text-xs text-gray-500">
                            {user.name} ({user.role}){' '}
                            <button onClick={() => logout()} className="ml-2 underline hover:text-gray-800">Log out</button>
                        </span>
                    )}
                </div>
                {nav.length > 1 && (
                    <nav className="flex flex-wrap gap-1 mb-3 print:hidden" aria-label="Staff sections">
                        {nav.map((n) => (
                            <NavLink key={n.to} to={n.to}
                                className={({ isActive }) =>
                                    `text-xs font-semibold px-3 py-1.5 border rounded-sm ${isActive
                                        ? 'bg-[#1b2f5e] border-[#1b2f5e] text-white'
                                        : 'bg-white border-gray-200 text-gray-600 hover:text-[#1b2f5e]'}`}>
                                {n.label}
                            </NavLink>
                        ))}
                    </nav>
                )}
                <div className="bg-white border border-gray-200 shadow-sm rounded-sm">
                    <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-sm text-sm font-semibold text-[#1b2f5e]">
                        {title}
                    </div>
                    <div className="p-4 sm:p-6 space-y-5">{children}</div>
                </div>
            </div>
        </div>
    );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
            {children}
            {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
        </label>
    );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
    const cls = {
        error: 'bg-red-50 text-red-700 border-red-200',
        success: 'bg-green-50 text-green-700 border-green-200',
        info: 'bg-blue-50 text-blue-700 border-blue-200',
    }[kind];
    return <div className={`border rounded-sm px-3 py-2 text-sm ${cls}`} role="alert">{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
    const cls =
        status === 'Approved' || status === 'Verified' || status === 'Paid' || status === 'Sent' || status === 'Active' ? 'bg-green-100 text-green-700'
            : status === 'Rejected' || status === 'Failed' || status === 'Deactivated' || status === 'Inactive' ? 'bg-red-100 text-red-700'
                : status === 'Under Review' || status === 'Pending' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600';
    const label = status === 'Submitted' ? 'Draft' : status; // "Submitted" on the server means created but not yet sent for review
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{label}</span>;
}

// From / To date inputs used by search, audit, notifications and reports (FR-10.1, FR-19.1)
export function DateRange({ from, to, onChange }: {
    from: string; to: string; onChange: (v: { from: string; to: string }) => void;
}) {
    return (
        <>
            <label className="flex items-center gap-1 text-xs text-gray-500">
                From
                <input type="date" value={from} max={to || undefined} className={`${inputCls} w-auto`}
                    onChange={(e) => onChange({ from: e.target.value, to })} />
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500">
                To
                <input type="date" value={to} min={from || undefined} className={`${inputCls} w-auto`}
                    onChange={(e) => onChange({ from, to: e.target.value })} />
            </label>
        </>
    );
}
