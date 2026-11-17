import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'applicant' | 'officer' | 'admin';
export type Portal = 'applicant' | 'staff';
export interface User { id: string; name: string; email: string; role: Role; permissions: string[] }

interface AuthCtx {
    user: User | null;
    ready: boolean;
    login: (email: string, password: string, portal?: Portal) => Promise<User>;
    logout: (message?: string) => void;
    can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
const IDLE_MS = 15 * 60 * 1000;      // FR-20: matches the server's idle timeout
const PING_MS = 4 * 60 * 1000;       // tells the server the user is still active

export const homeFor = (role: Role) => (role === 'applicant' ? '/dashboard' : '/officer');

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);
    const lastActivity = useRef(Date.now());
    const lastPing = useRef(Date.now());

    const logout = useCallback((message?: string) => {
        if (localStorage.getItem('token')) {
            api('/auth/logout', 'POST').catch(() => { /* session may already be gone */ });
        }
        // Clear after the request has picked up the token
        setTimeout(() => localStorage.removeItem('token'), 0);
        if (message) sessionStorage.setItem('logoutMsg', message);
        setUser(null);
    }, []);

    // Validate any saved token on first load
    useEffect(() => {
        if (!localStorage.getItem('token')) { setReady(true); return; }
        api<User>('/auth/me')
            .then(setUser)
            .catch(() => localStorage.removeItem('token'))
            .finally(() => setReady(true));
    }, []);

    // Token rejected by the server
    useEffect(() => {
        const onExpired = () => {
            localStorage.removeItem('token');
            // Keep a more specific message (e.g. the idle-logout one) if it was already set
            if (!sessionStorage.getItem('logoutMsg')) {
                sessionStorage.setItem('logoutMsg', 'Your session expired. Please log in again.');
            }
            setUser(null);
        };
        window.addEventListener('auth:expired', onExpired);
        return () => window.removeEventListener('auth:expired', onExpired);
    }, []);

    // Idle logout + keep the server session alive while the user is active
    useEffect(() => {
        if (!user) return;
        lastActivity.current = Date.now();
        lastPing.current = Date.now();
        const mark = () => { lastActivity.current = Date.now(); };
        const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
        events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
        const timer = setInterval(async () => {
            const now = Date.now();
            if (now - lastActivity.current > IDLE_MS) {
                logout('You were logged out after 15 minutes of inactivity.');
            } else if (now - lastPing.current > PING_MS && now - lastActivity.current < PING_MS) {
                try {
                    await api('/auth/refresh', 'POST');
                    lastPing.current = now;
                } catch { /* a 401 triggers auth:expired */ }
            }
        }, 15000);
        return () => {
            events.forEach((e) => window.removeEventListener(e, mark));
            clearInterval(timer);
        };
    }, [user, logout]);

    async function login(email: string, password: string, portal?: Portal) {
        localStorage.removeItem('token');
        const r = await api<{ token: string; user: User }>('/auth/login', 'POST', { email, password, portal });
        localStorage.setItem('token', r.token);
        setUser(r.user);
        return r.user;
    }

    const can = (permission: string) => !!user?.permissions?.includes(permission);

    return <Ctx.Provider value={{ user, ready, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
    const c = useContext(Ctx);
    if (!c) throw new Error('useAuth must be used inside AuthProvider');
    return c;
}
