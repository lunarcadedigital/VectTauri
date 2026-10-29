/**
 * Built-in Similharity shim contract tests.
 *
 * These pin the response shapes that VectTauri consumers rely on (see
 * D:\Kilo Projects\VectTauri-Builtin-Mode-Plan.md §3). The shim is exercised
 * through builtinFetch() with the settings fallback store (no TauriTavern).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock host modules before importing the shim
vi.mock('../../../../../script.js', () => ({
    getRequestHeaders: vi.fn(() => ({
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-token',
    })),
}));

vi.mock('../../../../extensions.js', () => ({
    extension_settings: {
        vecttauri: {},
    },
}));

import { builtinFetch, isBuiltinRoute, BUILTIN_PLUGIN_VERSION } from '../utils/builtin-similharity.js';
import { resetBuiltinStoreProbe } from '../utils/builtin-store.js';

const H = '/api/plugins/similharity';

function post(path, body) {
    return builtinFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

describe('builtin shim routing', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('routes health to a green builtin response', async () => {
        const r = await builtinFetch(`${H}/health`, { method: 'GET' });
        expect(r.ok).toBe(true);
        const data = await r.json();
        expect(data.status).toBe('ok');
        expect(data.version).toBe(BUILTIN_PLUGIN_VERSION);
        expect(data.features).toContain('native-vector');
    });

    it('recognizes all consumed plugin paths as builtin routes', () => {
        const paths = [
            `${H}/health`,
            `${H}/collections`,
            `${H}/chunks/insert`,
            `${H}/chunks/list`,
            `${H}/chunks/query`,
            `${H}/chunks/delete`,
            `${H}/chunks/purge`,
            `${H}/chunks/stats`,
            `${H}/chunks/collection-metadata`,
            `${H}/chunks/ensure-eventbase-indexes`,
            `${H}/purge-all`,
            `${H}/get-embedding`,
        ];
        for (const p of paths) {
            expect(isBuiltinRoute(p)).toBe(true);
        }
        expect(isBuiltinRoute('/api/vector/insert')).toBe(false);
        expect(isBuiltinRoute('/api/plugins/other/health')).toBe(false);
    });

    it('returns 404 for unknown plugin routes', async () => {
        const r = await post(`${H}/chunks/nonexistent`, {});
        expect(r.ok).toBe(false);
        expect(r.status).toBe(404);
    });
});

describe('builtin shim chunks contract', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('insert validates required fields', async () => {
        const r = await post(`${H}/chunks/insert`, {});
        expect(r.status).toBe(400);
    });

    it('insert → list round-trips metadata with paging', async () => {
        // insert calls native /api/vector/insert via global fetch — stub it.
        const nativeCalls = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            nativeCalls.push({ url, init });
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        };
        try {
            const items = [
                { hash: 'h2', text: 'two', index: 1, vector: [0, 1], metadata: { importance: 150, keywords: ['b'] } },
                { hash: 'h1', text: 'one', index: 0, vector: [1, 0], metadata: { importance: 100, keywords: ['a'] } },
                { hash: 'h3', text: 'three', index: 2, vector: [1, 1], metadata: {} },
            ];
            const ins = await post(`${H}/chunks/insert`, {
                backend: 'vectra', collectionId: 'similharity_chat_A', items,
                source: 'transformers', model: 'Xenova/test-model',
            });
            expect(ins.ok).toBe(true);
            const insData = await ins.json();
            expect(insData.success).toBe(true);
            expect(insData.inserted).toBe(3);
            expect(nativeCalls.some(c => String(c.url).includes('/api/vector/insert'))).toBe(true);

            const list = await post(`${H}/chunks/list`, {
                backend: 'vectra', collectionId: 'similharity_chat_A', offset: 0, limit: 2,
            });
            const listData = await list.json();
            expect(listData.success).toBe(true);
            expect(listData.total).toBe(3);
            expect(listData.items).toHaveLength(2);
            // deterministic ordering (sorted by hash)
            expect(listData.items.map(i => i.hash)).toEqual(['h1', 'h2']);
            expect(listData.items[1].metadata.importance).toBe(150);

            const page2 = await post(`${H}/chunks/list`, {
                backend: 'vectra', collectionId: 'similharity_chat_A', offset: 2, limit: 2, includeVectors: true,
            });
            const page2Data = await page2.json();
            expect(page2Data.items).toHaveLength(1);
            expect(page2Data.items[0].vector).toEqual([1, 1]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('query scores client-side from queryVector and honors threshold + topK', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-q', source: 'transformers', model: 'm',
                items: [
                    { hash: 'a', text: 'alpha', index: 0, vector: [1, 0], metadata: { importance: 100 } },
                    { hash: 'b', text: 'beta', index: 1, vector: [0, 1], metadata: { importance: 100 } },
                    { hash: 'c', text: 'gamma', index: 2, vector: [0.9, 0.1], metadata: { importance: 100 } },
                ],
            });

            const r = await post(`${H}/chunks/query`, {
                collectionId: 'c-q', topK: 2, threshold: 0.5, queryVector: [1, 0],
            });
            const data = await r.json();
            expect(data.success).toBe(true);
            expect(data.count).toBe(2);
            expect(data.results[0].hash).toBe('a');
            expect(data.results[0].score).toBeCloseTo(1, 5);
            expect(data.results[0].text).toBe('alpha');
            expect(data.results[1].hash).toBe('c');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('query requires queryVector or searchText', async () => {
        const r = await post(`${H}/chunks/query`, { collectionId: 'c-x' });
        expect(r.status).toBe(400);
    });

    it('delete, purge and stats operate on the metadata store', async () => {
        const realFetch = globalThis.fetch;
        const nativeCalls = [];
        globalThis.fetch = async (url, init) => {
            nativeCalls.push({ url: String(url), init });
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        };
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-del', source: 'transformers', model: 'm',
                items: [
                    { hash: 'h1', text: 'x', index: 0, vector: [1], metadata: { importance: 5 } },
                    { hash: 'h2', text: 'y', index: 1, vector: [1], metadata: {} },
                ],
            });

            const del = await post(`${H}/chunks/delete`, { collectionId: 'c-del', hashes: ['h1'] });
            expect(del.ok).toBe(true);
            expect(nativeCalls.some(c => c.url.includes('/api/vector/delete'))).toBe(true);

            const stats1 = await post(`${H}/chunks/stats`, { collectionId: 'c-del' });
            const stats1Data = await stats1.json();
            expect(stats1Data.stats.chunkCount).toBe(1);

            const purge = await post(`${H}/chunks/purge`, { collectionId: 'c-del' });
            expect(purge.ok).toBe(true);
            expect(nativeCalls.some(c => c.url.includes('/api/vector/purge'))).toBe(true);

            const stats2 = await post(`${H}/chunks/stats`, { collectionId: 'c-del' });
            const stats2Data = await stats2.json();
            expect(stats2Data.stats.chunkCount).toBe(0);
            expect(stats2Data.stats.exists).toBe(false);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('collections lists registered collections with counts', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'similharity_global', source: 'qdrant', model: 'm',
                items: [{ hash: 'k1', text: 't', index: 0, vector: [0], metadata: {} }],
            });
            const r = await builtinFetch(`${H}/collections`, { method: 'GET' });
            const data = await r.json();
            expect(data.success).toBe(true);
            const entry = data.collections.find(c => c.id === 'similharity_global');
            expect(entry).toBeTruthy();
            expect(entry.backend).toBe('builtin');
            expect(entry.chunkCount).toBe(1);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('collection-metadata reports chunk totals', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-meta', source: 'transformers', model: 'Xenova/m',
                items: [{ hash: 'z', text: 'text-here', index: 0, vector: [0], metadata: {} }],
            });
            const r = await post(`${H}/chunks/collection-metadata`, { collectionId: 'c-meta' });
            const data = await r.json();
            expect(data.success).toBe(true);
            expect(data.info.totalChunks).toBe(1);
            expect(data.info.models[0].name).toBe('Xenova/m');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('eventbase indexes is a no-op success', async () => {
        const r = await post(`${H}/chunks/ensure-eventbase-indexes`, {});
        const data = await r.json();
        expect(data.success).toBe(true);
    });

    it('get-embedding returns a clear 501 in builtin mode', async () => {
        const r = await post(`${H}/get-embedding`, { text: 'hello' });
        expect(r.status).toBe(501);
    });
});
