/**
 * Store component sanitization tests — TT's extension store validates BOTH
 * namespace and key against [A-Za-z0-9_.-] with no leading dot
 * (file_extension_store_repository.rs validate_component). Collection IDs
 * contain ':' (vf_eventbase:<char>:<uuid>) and previously crashed inserts
 * with "Invalid extension store namespace".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../extensions.js', () => ({
    extension_settings: { vecttauri: {} },
}));

import {
    sanitizeStoreComponent,
    unescapeStoreComponent,
    storeSetJson,
    storeListKeys,
    resetBuiltinStoreProbe,
} from '../utils/builtin-store.js';

describe('sanitizeStoreComponent — TT store contract [A-Za-z0-9_.-]', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('passes through already-valid components unchanged', () => {
        expect(sanitizeStoreComponent('my-ext')).toBe('my-ext');
        expect(sanitizeStoreComponent('chunkmeta_.abc-123')).toBe('chunkmeta_.abc-123');
        expect(sanitizeStoreComponent('aBcD.12-3_4')).toBe('aBcD.12-3_4');
    });

    it('hex-encodes namespaces containing ":" into a %-FREE value', () => {
        const out = sanitizeStoreComponent('vf_eventbase:Seraphina:abc-123');
        // The %-based encoder previously emitted '%', which TT itself rejects.
        expect(out).not.toContain('%');
        expect(out).not.toContain(':');
        expect(out).toMatch(/^hex_[0-9a-f]+$/);
    });

    it('never produces a leading dot', () => {
        expect(sanitizeStoreComponent('.hidden').startsWith('.')).toBe(false);
        expect(sanitizeStoreComponent('..x').startsWith('.')).toBe(false);
    });

    it('round-trips through unescapeStoreComponent exactly', () => {
        for (const raw of [
            'vf_eventbase:Seraphina:abc-123',
            'chunkmeta::vf_chat_A_1',
            'コレクション:名前',
            'hash:with:colons',
            'plain-valid_key.123',
        ]) {
            expect(unescapeStoreComponent(sanitizeStoreComponent(raw))).toBe(raw);
        }
    });

    it('is injective: distinct ids never collapse to one encoded form', () => {
        const a = sanitizeStoreComponent('vf_eventbase:A:123');
        const b = sanitizeStoreComponent('vf_eventbase:B:123');
        const c = sanitizeStoreComponent('vf_eventbase:A:124');
        expect(new Set([a, b, c]).size).toBe(3);
    });

    it('maps empty/whitespace to a safe placeholder', () => {
        expect(sanitizeStoreComponent('   ')).toBe('_empty');
        expect(sanitizeStoreComponent('')).toBe('_empty');
    });
});

describe('store functions sanitize transparently (write then list round-trip)', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('a collection id with colons round-trips through set/list without rejection', async () => {
        const ns = 'chunkmeta::vf_eventbase:Seraphina:abc-123';
        await storeSetJson(ns, 'hash:with:colons', { text: 'x', metadata: { importance: 120 } });

        const keys = await storeListKeys(ns);
        expect(keys.length).toBe(1);
        expect(keys[0]).not.toContain(':');
        expect(keys[0]).not.toContain('%');
        expect(unescapeStoreComponent(keys[0])).toBe('hash:with:colons');
    });
});