import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessPrompt, getBusinessConfig } from '../src/config/business.js';

test('business prompt uses optional per-number persona without changing global config', () => {
    const defaultName = getBusinessConfig().csName;
    const prompt = buildBusinessPrompt('Rara');
    assert.match(prompt, /Nama CS virtual: Rara/);
    assert.match(prompt, /Kamu adalah Rara/);
    assert.equal(getBusinessConfig().csName, defaultName);
});
