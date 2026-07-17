import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminSecurity } from '../src/admin/security.js';
import { assertProductionAdminPassword } from '../src/admin/security.js';
import { resolveLogLevel } from '../src/config/logger.js';

test('production admin configuration fails closed without a password', () => {
    const security = createAdminSecurity({ password: '', secureCookie: true });
    assert.equal(security.login('').ok, false);
    assert.equal(security.login('admin-dev-only').ok, false);
    assert.equal(security.cookieName, '__Host-voidlark_admin');
    assert.deepEqual(
        { httpOnly: security.cookieOptions.httpOnly, secure: security.cookieOptions.secure, sameSite: security.cookieOptions.sameSite, path: security.cookieOptions.path },
        { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
    );
});

test('logger configuration accepts known levels and rejects unsafe values', () => {
    assert.equal(resolveLogLevel('debug', 'production'), 'debug');
    assert.equal(resolveLogLevel('trace', 'development'), 'trace');
    assert.equal(resolveLogLevel('verbose', 'production'), 'info');
    assert.equal(resolveLogLevel(undefined, 'development'), 'debug');
    assert.equal(resolveLogLevel(undefined, 'production'), 'info');
});

test('production rejects missing, known-default, and weak admin passwords', () => {
    for (const password of [
        '', 'change-me-before-production', 'admin-dev-only', 'password123',
        'password-password-2026', 'abcdefghijklmnop', '1234567890123456',
        'qwertyuiopasdfghj', 'abcabcabcabcabcabc', 'Welcome-to-admin-2026',
    ]) {
        assert.throws(() => assertProductionAdminPassword(password), /ADMIN_PASSWORD/);
    }
    assert.doesNotThrow(() => assertProductionAdminPassword('S7!long-production-secret-2026'));
    assert.doesNotThrow(() => assertProductionAdminPassword('correct horse battery staple'));
});

test('development-only default remains usable by session authentication', () => {
    const development = createAdminSecurity({ password: 'admin-dev-only', secureCookie: false });
    assert.equal(development.login('admin-dev-only').ok, true);
});
