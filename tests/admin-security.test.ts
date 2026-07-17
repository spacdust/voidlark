import assert from 'node:assert/strict';
import test from 'node:test';
import { adminEntryPath, csrfTokenFromRequest, createAdminSecurity, shouldRejectCrossSite } from '../src/admin/security.js';

const security = createAdminSecurity({ password: 'correct horse battery staple', secureCookie: false });

test('uses a browser-compatible cookie name for local HTTP', () => {
    assert.equal(security.cookieName, 'voidlark_admin');
    const production = createAdminSecurity({ password: 'correct horse battery staple', secureCookie: true });
    assert.equal(production.cookieName, '__Host-voidlark_admin');
    assert.equal(production.cookieOptions.secure, true);
});

test('rejects invalid login and creates a session for valid credentials', () => {
    assert.equal(security.login('wrong').ok, false);
    const login = security.login('correct horse battery staple');
    assert.equal(login.ok, true);
    assert.ok(login.session?.id);
    assert.ok(login.session?.csrfToken);
    assert.equal(security.isAuthenticated(login.session?.id || ''), true);
});

test('requires matching csrf token for authenticated mutations', () => {
    const login = security.login('correct horse battery staple');
    assert.equal(security.verifyCsrf(login.session?.id || '', 'wrong'), false);
    assert.equal(security.verifyCsrf(login.session?.id || '', login.session?.csrfToken || ''), true);
});

test('expires sessions and invalidates logout', () => {
    const login = security.login('correct horse battery staple');
    security.logout(login.session?.id || '');
    assert.equal(security.isAuthenticated(login.session?.id || ''), false);
});

test('uses constant-shape generic login failure', () => {
    assert.deepEqual(security.login('wrong'), { ok: false, error: 'LOGIN_FAILED' });
});

test('rejects browser requests explicitly marked cross-site', () => {
    assert.equal(shouldRejectCrossSite('cross-site'), true);
    assert.equal(shouldRejectCrossSite('same-origin'), false);
    assert.equal(shouldRejectCrossSite('same-site'), false);
    assert.equal(shouldRejectCrossSite('none'), false);
    assert.equal(shouldRejectCrossSite(undefined), false);
});

test('routes the domain root by session state', () => {
    assert.equal(adminEntryPath(false), '/admin/login');
    assert.equal(adminEntryPath(true), '/admin');
});

test('extracts CSRF from multipart-safe query/header and never trusts fetch metadata alone', () => {
    assert.equal(csrfTokenFromRequest({ body: {}, query: { _csrf: 'query-token' }, headers: {} }), 'query-token');
    assert.equal(csrfTokenFromRequest({ body: {}, query: {}, headers: { 'x-csrf-token': 'header-token' } }), 'header-token');
    assert.equal(csrfTokenFromRequest({ body: { _csrf: 'body-token' }, query: {}, headers: {} }), 'body-token');
    assert.equal(csrfTokenFromRequest({ body: {}, query: {}, headers: {}, fetchSite: 'same-origin' } as any), '');
});
