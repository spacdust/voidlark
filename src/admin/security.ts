import crypto from 'crypto';

interface Session {
    id: string;
    csrfToken: string;
    expiresAt: number;
}

interface SecurityOptions {
    password: string;
    secureCookie: boolean;
    sessionTtlMs?: number;
}

const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
const safeEqual = (left: string, right: string) => crypto.timingSafeEqual(digest(left), digest(right));

const knownDefaultPasswords = new Set([
    'admin-dev-only',
    'change-me-before-production',
    'changeme',
    'password',
    'password123',
]);

const passwordLikeTerms = /(?:admin|changeme|change[\W_]*me|letmein|password|passw0rd|qwerty|welcome)/i;
const keyboardAndSequenceRuns = [
    '0123456789', '9876543210',
    'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
    'qwertyuiopasdfghjklzxcvbnm', 'mnbvcxzlkjhgfdsaqpoiuytrewq',
];

const isPredictablePassword = (password: string) => {
    const compact = password.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (passwordLikeTerms.test(password) || /^(.{1,8})\1+$/.test(password)) return true;
    if (keyboardAndSequenceRuns.some((sequence) => sequence.includes(compact))) return true;
    if (/^\d+$/.test(compact)) return true;
    return false;
};

export const assertProductionAdminPassword = (password: string) => {
    const normalized = password.trim();
    if (normalized.length < 16 || knownDefaultPasswords.has(normalized.toLowerCase()) || isPredictablePassword(normalized)) {
        throw new Error('ADMIN_PASSWORD wajib diisi dengan password production yang kuat dan bukan nilai default.');
    }
};

export const createAdminSecurity = ({ password, secureCookie, sessionTtlMs = 8 * 60 * 60 * 1_000 }: SecurityOptions) => {
    const sessions = new Map<string, Session>();
    const getSession = (id: string) => {
        const session = sessions.get(id);
        if (!session || session.expiresAt <= Date.now()) {
            if (session) sessions.delete(id);
            return null;
        }
        return session;
    };
    return {
        cookieName: secureCookie ? '__Host-voidlark_admin' : 'voidlark_admin',
        cookieOptions: { httpOnly: true, secure: secureCookie, sameSite: 'strict' as const, path: '/', maxAge: sessionTtlMs },
        login(candidate: string) {
            if (!password || !safeEqual(candidate, password)) return { ok: false as const, error: 'LOGIN_FAILED' as const };
            const session: Session = { id: crypto.randomBytes(32).toString('base64url'), csrfToken: crypto.randomBytes(32).toString('base64url'), expiresAt: Date.now() + sessionTtlMs };
            sessions.set(session.id, session);
            return { ok: true as const, session };
        },
        logout(id: string) { sessions.delete(id); },
        isAuthenticated(id: string) { return Boolean(getSession(id)); },
        getCsrfToken(id: string) { return getSession(id)?.csrfToken || ''; },
        verifyCsrf(id: string, token: string) {
            const expected = getSession(id)?.csrfToken;
            return Boolean(expected && token && safeEqual(expected, token));
        },
    };
};

export const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split('=')).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));

export const shouldRejectCrossSite = (fetchSite: string | undefined) => fetchSite?.toLowerCase() === 'cross-site';

export const csrfTokenFromRequest = (request: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
}) => String(request.body?._csrf || request.query?._csrf || request.headers?.['x-csrf-token'] || '');

export const adminEntryPath = (authenticated: boolean) => authenticated ? '/admin' : '/admin/login';
