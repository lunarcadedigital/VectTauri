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
    });

    it('percent-encodes ":" and other disallowed ASCII', () => {
        const out = sanitizeStoreComponent('vf_eventbase:Seraphina:abc-123');
        expect(out).toBe('vf_eventbase%3aSeraphina%3aabc-123'); // '_' is legal, ':' encoded
        expect(out).toMatch(/^[A-Za-z0-9_.%-]+$/);
        expect(out).not.toContain(':');
    });

    it('never produces a leading dot', () => {
        expect(sanitizeStoreComponent('.hidden').startsWith('.')).toBe(false);
        expect(sanitizeStoreComponent('..x').startsWith('.')).toBe(false);
    });

    it('is injective: ":" and a literal "%3a" sanitize differently', () => {
        const colon = sanitizeStoreComponent('a:b');
        const literal = sanitizeStoreComponent('a%3ab');
        expect(colon).toBe('a%3ab'); // ':' encoded
        expect(literal).toBe('a%253ab'); // literal '%' encoded as %25
        expect(colon).not.toBe(literal);
    });

    it('round-trips through unescapeStoreComponent', () => {
        const raw = 'vf_eventbase:Seraphina:abc-123';
        expect(unescapeStoreComponent(sanitizeStoreComponent(raw))).toBe(raw);
    });

    it('encodes non-ASCII (CJK) deterministically', () => {
        const raw = 'コレクション';
        const out = sanitizeStoreComponent(raw);
        expect(out).toMatch(/^[A-Za-z0-9_.%-]+$/);
        expect(sanitizeStoreComponent(raw)).toBe(out); // deterministic
        expect(unescapeStoreComponent(out)).toBe(raw); // reversible
        expect(out).toContain('%'); // each CJK char becomes a %XX hex token
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
        expect(keys[0]).not.toContain(':'); // stored key is encoded
        // and it decodes back to the raw key
        expect(unescapeStoreComponent(keys[0])).toBe('hash:with:colons');
    });
});
