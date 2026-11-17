import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { homeFor, useAuth, type Role } from './AuthContext';

export default function RouteGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
    const { user, ready } = useAuth();
    if (!ready) return <p className="p-8 text-sm text-gray-500">Loading…</p>;
    // Staff pages send a logged-out user to the Staff login tab
    if (!user) return <Navigate to={roles.includes('applicant') ? '/' : '/?as=staff'} replace />;
    if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
    return <>{children}</>;
}
