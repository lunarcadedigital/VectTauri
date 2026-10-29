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

describe('builtin shim cross-chat scoping', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('registry is global: collections registered in one chat context are listed from another', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            // Register a collection (registry writes go to extension_settings — global).
            await post(`${H}/chunks/insert`, {
                collectionId: 'vf_chat_A_1', source: 'transformers', model: 'm',
                items: [{ hash: 'x1', text: 't', index: 0, vector: [0], metadata: {} }],
            });

            // Simulate switching chats: chunk metadata store is per-chat in TT,
            // but the registry namespace must survive the switch. Verify the
            // registry data physically lives in extension_settings (global).
            const { extension_settings } = await import('../../../../extensions.js');
            const globalTree = extension_settings.vecttauri.builtinGlobal;
            expect(globalTree.__vecttauri_registry.vf_chat_A_1).toBeTruthy();

            // Collections listing reads the global registry, not a chat store.
            const r = await builtinFetch(`${H}/collections`, { method: 'GET' });
            const data = await r.json();
            const entry = data.collections.find(c => c.id === 'vf_chat_A_1');
            expect(entry).toBeTruthy();
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('chunk metadata is keyed per collection, so distinct chats never mix', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'vf_chat_A_1', source: 'transformers', model: 'm',
                items: [{ hash: 'onlyA', text: 'chat A chunk', index: 0, vector: [1], metadata: {} }],
            });
            await post(`${H}/chunks/insert`, {
                collectionId: 'vf_chat_B_2', source: 'transformers', model: 'm',
                items: [{ hash: 'onlyB', text: 'chat B chunk', index: 0, vector: [1], metadata: {} }],
            });

            const listA = await post(`${H}/chunks/list`, { collectionId: 'vf_chat_A_1' });
            const a = (await listA.json()).items.map(i => i.hash);
            expect(a).toContain('onlyA');
            expect(a).not.toContain('onlyB');
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});

describe('builtin shim hybrid keyword boost', () => {
    beforeEach(() => {
        resetBuiltinStoreProbe();
    });

    it('keyword match lifts a weaker dense result above a stronger one', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            // Unit vectors chosen so dense scores are 0.9 and 0.85 pre-boost.
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-hybrid', source: 'transformers', model: 'm',
                items: [
                    {
                        // Dense winner (0.9), but no keyword overlap with the query.
                        hash: 'dense-win', text: 'the weather was pleasant', index: 0,
                        vector: [0.9, 0.43589], metadata: { importance: 100, keywords: ['weather'] },
                    },
                    {
                        // Dense runner-up (0.85); one keyword match → 1.15x boost
                        // (1 + 0.5 contribution × 0.3 single-match scale) → 0.9775.
                        hash: 'kw-win', text: 'a dragon attacked the village', index: 1,
                        vector: [0.85, 0.52678], metadata: { importance: 100, keywords: ['dragon'] },
                    },
                ],
            });

            const r = await post(`${H}/chunks/query`, {
                collectionId: 'c-hybrid', topK: 2, threshold: 0,
                queryVector: [1, 0], searchText: 'dragon attack on the village',
            });
            const data = await r.json();
            expect(data.success).toBe(true);
            expect(data.results[0].hash).toBe('kw-win');
            expect(data.results[0].keywordBoosted).toBe(true);
            expect(data.results[0].originalScore).toBeCloseTo(0.85, 2);
            expect(data.results[0].score).toBeGreaterThan(data.results[1].score);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('query without searchText skips boosting (pure dense)', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-pure', source: 'transformers', model: 'm',
                items: [
                    { hash: 'a', text: 'alpha', index: 0, vector: [1, 0], metadata: { keywords: ['alpha'] } },
                    { hash: 'b', text: 'beta', index: 1, vector: [0.9, 0.1], metadata: { keywords: [] } },
                ],
            });

            const r = await post(`${H}/chunks/query`, {
                collectionId: 'c-pure', topK: 2, threshold: 0, queryVector: [1, 0],
            });
            const data = await r.json();
            for (const res of data.results) {
                expect(res.keywordBoosted).toBeFalsy();
                expect(res.originalScore).toBeUndefined();
            }
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('forwards provider fields (apiUrl) to the native insert for URL-based sources', async () => {
        // TT's Rust backend validates apiUrl for vllm/ollama/llamacpp sources;
        // dropping it produced "Bad request: apiUrl is required" mid-vectorization.
        const nativeBodies = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (String(url).includes('/api/vector/insert')) {
                nativeBodies.push(JSON.parse(init.body));
                return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
            }
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        };
        try {
            const r = await post(`${H}/chunks/insert`, {
                backend: 'vectra', collectionId: 'c-url', source: 'vllm', model: 'my-model',
                apiUrl: 'http://192.168.88.251:8000/v1',
                items: [{ hash: 'u1', text: 'chunk', index: 0, vector: [1], metadata: {} }],
            });
            expect(r.ok).toBe(true);
            expect(nativeBodies).toHaveLength(1);
            expect(nativeBodies[0].source).toBe('vllm');
            expect(nativeBodies[0].apiUrl).toBe('http://192.168.88.251:8000/v1');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('forwards apiUrl to the native query for URL-based sources', async () => {
        const nativeBodies = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (String(url).includes('/api/vector/query')) {
                nativeBodies.push(JSON.parse(init.body));
                return { ok: true, status: 200, json: async () => ({ hashes: [] }), text: async () => '' };
            }
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        };
        try {
            await post(`${H}/chunks/insert`, {
                collectionId: 'c-url-q', source: 'vllm', model: 'my-model', apiUrl: 'http://host:8000/v1',
                items: [{ hash: 'q1', text: 'chunk', index: 0, vector: [1], metadata: {} }],
            });
            await post(`${H}/chunks/query`, {
                collectionId: 'c-url-q', topK: 5, threshold: 0,
                searchText: 'hello', source: 'vllm', model: 'my-model', apiUrl: 'http://host:8000/v1',
            });
            expect(nativeBodies[nativeBodies.length - 1].apiUrl).toBe('http://host:8000/v1');
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('treats a successful native insert with an EMPTY body as success (TT empty_response)', async () => {
        // TT answers successful insert/delete/purge with Response(null). Parsing
        // that as JSON threw SyntaxError, which the shim reported as a 500 —
        // turning successful writes into "insert failed after 3 retries".
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            // Mimic a Response(null) body: empty text, and json() that throws.
            text: async () => '',
            json: async () => { throw new SyntaxError('Unexpected end of input'); },
        });
        try {
            const r = await post(`${H}/chunks/insert`, {
                collectionId: 'c-empty', source: 'ollama', model: 'embeddinggemma', apiUrl: 'http://127.0.0.1:11434',
                items: [{ hash: 'e1', text: 'chunk', index: 0, vector: [1], metadata: {} }],
            });
            expect(r.ok).toBe(true);
            const data = await r.json();
            expect(data.success).toBe(true);
            expect(data.inserted).toBe(1);
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
