/**
 * VectTauri - Built-in Similharity Shim
 *
 * Implements the subset of the Similharity plugin's HTTP contract that
 * VectTauri actually consumes (see plan §3), running entirely inside the
 * WebView. Vector data goes through SillyTavern's native /api/vector/* endpoints
 * (in TauriTavern these are answered by the Rust backend: redb storage +
 * on-device candle embeddings). Rich chunk metadata (importance, keywords,
 * conditions, ...) lives in the built-in store, keyed by collection + hash.
 *
 * The public surface is similharityFetch(path, init): a drop-in replacement for
 * the `fetch(getPluginUrl(path), init)` calls that every consumer already uses.
 * It returns a synthetic Response-like object so consumers need zero changes.
 */

import { getRequestHeaders } from '../../../../../script.js';
import { log } from '../core/log.js';
import { applyKeywordBoosts, getOverfetchAmount } from '../core/keyword-boost.js';
import {
    storeSetJson,
    storeGetJson,
    storeDeleteJson,
    storeListKeys,
    storeDropNamespace,
    globalSetJson,
    globalGetJson,
    globalDeleteJson,
    globalListKeys,
} from './builtin-store.js';

export const BUILTIN_PLUGIN_VERSION = '1.0.0-builtin';

const CHUNK_NS_PREFIX = 'chunkmeta::';
const REGISTRY_NS = '__vecttauri_registry';

// ---------------------------------------------------------------------------
// Response helper — mimics the subset of `fetch` Response consumers rely on:
// ok / status / statusText / json() / text()
// ---------------------------------------------------------------------------

function shimResponse(status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => JSON.parse(text),
        text: async () => text,
    };
}

function ok(body) {
    return shimResponse(200, body ?? { success: true });
}

function fail(status, message) {
    return shimResponse(status, { success: false, error: message });
}

// ---------------------------------------------------------------------------
// Metadata store helpers
// ---------------------------------------------------------------------------

function chunkNamespace(collectionId) {
    return CHUNK_NS_PREFIX + collectionId;
}

/**
 * Reads the collection registry entry (model info, counts, timestamps).
 * The registry is GLOBAL (visible from every chat), so it always lives in
 * extension_settings via the global* store functions — TT's store.* is
 * per-chat and would hide collections created in other chats.
 */
async function getRegistryEntry(collectionId) {
    return (await globalGetJson(REGISTRY_NS, collectionId)) ?? null;
}

async function setRegistryEntry(collectionId, entry) {
    await globalSetJson(REGISTRY_NS, collectionId, entry);
}

async function updateRegistryOnInsert(collectionId, model, source) {
    const entry = (await getRegistryEntry(collectionId)) ?? {
        id: collectionId,
        createdAt: Date.now(),
    };
    entry.lastUsed = Date.now();
    entry.model = model || entry.model || null;
    entry.source = source || entry.source || 'transformers';
    await setRegistryEntry(collectionId, entry);
}

// ---------------------------------------------------------------------------
// Native /api/vector/* bridge (works in both ST and TauriTavern)
// ---------------------------------------------------------------------------

async function nativeVector(endpoint, body) {
    const response = await fetch(`/api/vector/${endpoint}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
        const errBody = await response.text().catch(() => '(no body)');
        throw new Error(`/api/vector/${endpoint} failed: ${response.status} ${errBody.slice(0, 200)}`);
    }
    return response.json();
}

// ---------------------------------------------------------------------------
// Endpoint implementations
// ---------------------------------------------------------------------------

/**
 * POST /chunks/insert
 * Body: { backend, collectionId, items: [{hash, text, index, vector, metadata}] }
 * Vectors go to the native API; rich metadata goes to the built-in store.
 */
async function handleInsert(body) {
    const { collectionId, items, source, model } = body ?? {};
    if (!collectionId || !Array.isArray(items)) {
        return fail(400, 'chunks/insert: collectionId and items[] are required');
    }

    try {
        // Native insert stores {hash, text, index} (+ vector under transformers).
        await nativeVector('insert', {
            collectionId,
            source: source || 'transformers',
            model,
            items: items.map(it => ({ hash: it.hash, text: it.text || '', index: it.index ?? 0 })),
        });

        // Rich metadata: keep the vector here too, so builtin query can score
        // even when the native query path lacks the same model subfolder.
        const ns = chunkNamespace(collectionId);
        for (const it of items) {
            const existing = (await storeGetJson(ns, it.hash)) ?? {};
            await storeSetJson(ns, it.hash, {
                ...existing,
                hash: it.hash,
                text: it.text || '',
                index: it.index ?? 0,
                vector: Array.isArray(it.vector) ? it.vector : existing.vector,
                metadata: { ...(existing.metadata ?? {}), ...(it.metadata ?? {}) },
            });
        }

        await updateRegistryOnInsert(collectionId, model, source);
        return ok({ success: true, inserted: items.length });
    } catch (e) {
        log.error(`[builtin] insert failed for ${collectionId}: ${e.message}`);
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/list
 * Body: { backend, collectionId, source, model, offset, limit, includeVectors }
 * Consumers accept {items|chunks|results: [...]}.
 */
async function handleList(body) {
    const { collectionId, offset = 0, limit = 100, includeVectors = false } = body ?? {};
    if (!collectionId) return fail(400, 'chunks/list: collectionId is required');

    try {
        const ns = chunkNamespace(collectionId);
        const keys = await storeListKeys(ns);
        const sorted = keys.slice().sort();
        const page = sorted.slice(offset, offset + limit);

        const items = [];
        for (const hash of page) {
            const rec = await storeGetJson(ns, hash);
            if (!rec) continue;
            items.push({
                hash: rec.hash ?? hash,
                text: rec.text ?? '',
                index: rec.index ?? 0,
                vector: includeVectors ? (rec.vector ?? null) : undefined,
                metadata: rec.metadata ?? {},
            });
        }
        return ok({ success: true, total: sorted.length, items });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * Cosine similarity for dense vectors (client-side scoring for builtin mode).
 */
function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * POST /chunks/query
 * Body: { backend, collectionId, topK, threshold, source, model, queryVector?, searchText? }
 * Returns { success, results: [{hash, score, text, metadata}] }.
 *
 * Strategy (hybrid, client-side):
 *  1. Dense scoring — cosine against stored vectors (queryVector) or via the
 *     native on-device embedding query (searchText).
 *  2. Keyword boost — the same additive keyword-boost math used by bridge mode
 *     (core/keyword-boost.js): chunk keywords matched against the query text
 *     lift their score, with diminishing returns and a per-keyword cap.
 *  3. Merge + rank — boosted scores re-sorted before the topK cut.
 */
async function handleQuery(body) {
    const { collectionId, topK = 10, threshold = 0, queryVector, searchText, source, model } = body ?? {};
    if (!collectionId) return fail(400, 'chunks/query: collectionId is required');

    try {
        const ns = chunkNamespace(collectionId);
        const keys = await storeListKeys(ns);
        const records = [];
        for (const hash of keys) {
            const rec = await storeGetJson(ns, hash);
            if (rec) records.push(rec);
        }

        let results = [];

        if (Array.isArray(queryVector) && queryVector.length > 0) {
            // Fully client-side dense scoring.
            for (const rec of records) {
                const score = cosine(queryVector, rec.vector);
                if (score >= threshold) {
                    results.push({
                        hash: rec.hash ?? null,
                        score,
                        text: rec.text ?? '',
                        metadata: rec.metadata ?? {},
                    });
                }
            }
            results.sort((a, b) => b.score - a.score);
        } else if (searchText) {
            // Native query embeds searchText on-device and returns hashes/scores.
            // Overfetch so keyword-boosted items below the cut can resurface.
            const overfetch = getOverfetchAmount(topK);
            const native = await nativeVector('query', {
                collectionId,
                source: source || 'transformers',
                model,
                searchText,
                topK: overfetch,
                threshold,
            });
            const nativeResults = Array.isArray(native) ? native : (native.results ?? native.hashes ?? []);
            const byHash = new Map(records.map(r => [r.hash, r]));
            for (const r of nativeResults) {
                const hash = typeof r === 'string' ? r : r.hash;
                const rec = byHash.get(hash);
                if (!rec) continue;
                results.push({
                    hash,
                    score: typeof r === 'object' ? (r.score ?? 0) : 0,
                    text: rec.text ?? '',
                    metadata: rec.metadata ?? {},
                });
            }
        } else {
            return fail(400, 'chunks/query: queryVector or searchText is required');
        }

        // Hybrid stage: keyword boost against the query text, then topK cut.
        const queryText = searchText || body?.query || '';
        if (queryText && results.length > 0) {
            try {
                results = applyKeywordBoosts(results, queryText, topK);
            } catch (boostErr) {
                // Boost is an enhancement — a failure must not break retrieval.
                log.warn(`[builtin] keyword boost skipped: ${boostErr.message}`);
            }
        }

        results = results.slice(0, topK);
        return ok({ success: true, count: results.length, results });
    } catch (e) {
        log.error(`[builtin] query failed for ${collectionId}: ${e.message}`);
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/delete — native delete + drop stored metadata per hash.
 */
async function handleDelete(body) {
    const { collectionId, hashes, source, model } = body ?? {};
    if (!collectionId || !Array.isArray(hashes)) {
        return fail(400, 'chunks/delete: collectionId and hashes[] are required');
    }
    try {
        await nativeVector('delete', { collectionId, source: source || 'transformers', model, hashes });
        const ns = chunkNamespace(collectionId);
        for (const hash of hashes) {
            await storeDeleteJson(ns, hash);
        }
        return ok({ success: true, deleted: hashes.length });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/purge — native purge + drop the whole metadata namespace.
 */
async function handlePurge(body) {
    const { collectionId, source, model } = body ?? {};
    if (!collectionId) return fail(400, 'chunks/purge: collectionId is required');
    try {
        await nativeVector('purge', { collectionId, source: source || 'transformers', model });
        await storeDropNamespace(chunkNamespace(collectionId));
        await globalDeleteJson(REGISTRY_NS, collectionId);
        return ok({ success: true });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * POST /purge-all — wipes every builtin namespace and the native vectors.
 */
async function handlePurgeAll() {
    try {
        await nativeVector('purge-all', {});
        const regKeys = await globalListKeys(REGISTRY_NS);
        for (const collectionId of regKeys) {
            await storeDropNamespace(chunkNamespace(collectionId));
        }
        for (const id of regKeys) {
            await globalDeleteJson(REGISTRY_NS, id);
        }
        return ok({ success: true });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/stats — aggregates from the metadata store.
 * Consumers read `data.stats`.
 */
async function handleStats(body) {
    const { collectionId } = body ?? {};
    if (!collectionId) return fail(400, 'chunks/stats: collectionId is required');
    try {
        const ns = chunkNamespace(collectionId);
        const keys = await storeListKeys(ns);
        let totalSize = 0;
        for (const hash of keys) {
            const rec = await storeGetJson(ns, hash);
            if (rec?.text) totalSize += rec.text.length;
        }
        const reg = await getRegistryEntry(collectionId);
        return ok({
            success: true,
            stats: {
                collectionId,
                chunkCount: keys.length,
                totalSize,
                model: reg?.model ?? null,
                source: reg?.source ?? 'transformers',
                exists: keys.length > 0,
            },
        });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/collection-metadata
 * Consumers read fields like totalChunks / models.
 */
async function handleCollectionMetadata(body) {
    const { collectionId } = body ?? {};
    if (!collectionId) return fail(400, 'collection-metadata: collectionId is required');
    try {
        const keys = await storeListKeys(chunkNamespace(collectionId));
        const reg = await getRegistryEntry(collectionId);
        return ok({
            success: true,
            exists: keys.length > 0,
            info: {
                id: collectionId,
                exists: keys.length > 0,
                totalChunks: keys.length,
                models: reg?.model ? [{ name: reg.model, size: null }] : [],
            },
        });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * GET /collections — unified collection list from the registry.
 * Consumers read {success, collections:[{id, source, backend, chunkCount, modelCount}]}.
 */
async function handleCollections() {
    try {
        const ids = await globalListKeys(REGISTRY_NS);
        const collections = [];
        for (const id of ids) {
            const reg = await getRegistryEntry(id);
            const chunkCount = (await storeListKeys(chunkNamespace(id))).length;
            collections.push({
                id,
                source: reg?.source ?? 'transformers',
                backend: 'builtin',
                chunkCount,
                modelCount: reg?.model ? 1 : 0,
            });
        }
        return ok({ success: true, count: collections.length, collections });
    } catch (e) {
        return fail(500, e.message);
    }
}

/**
 * POST /chunks/ensure-eventbase-indexes — no-op in builtin mode
 * (the metadata store needs no manual index creation).
 */
async function handleEnsureIndexes() {
    return ok({ success: true });
}

/**
 * POST /get-embedding
 * Builtin mode has no standalone embedding route; consumers that can pass a
 * pre-computed queryVector should do so. Return a clear error otherwise.
 */
async function handleGetEmbedding() {
    return fail(501, 'get-embedding is not available in builtin mode; pass queryVector instead');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const POST_ROUTES = [
    { match: p => p === '/api/plugins/similharity/chunks/insert', handler: handleInsert },
    { match: p => p === '/api/plugins/similharity/chunks/list', handler: handleList },
    { match: p => p === '/api/plugins/similharity/chunks/query', handler: handleQuery },
    { match: p => p === '/api/plugins/similharity/chunks/delete', handler: handleDelete },
    { match: p => p === '/api/plugins/similharity/chunks/purge', handler: handlePurge },
    { match: p => p === '/api/plugins/similharity/chunks/stats', handler: handleStats },
    { match: p => p === '/api/plugins/similharity/chunks/collection-metadata', handler: handleCollectionMetadata },
    { match: p => p === '/api/plugins/similharity/chunks/ensure-eventbase-indexes', handler: handleEnsureIndexes },
    { match: p => p === '/api/plugins/similharity/purge-all', handler: handlePurgeAll },
    { match: p => p === '/api/plugins/similharity/get-embedding', handler: handleGetEmbedding },
];

/**
 * True when the request targets a Similharity path this shim can serve.
 * @param {string} path
 * @returns {boolean}
 */
export function isBuiltinRoute(path) {
    if (typeof path !== 'string') return false;
    if (path === '/api/plugins/similharity/health') return true;
    if (path === '/api/plugins/similharity/collections') return true;
    return POST_ROUTES.some(r => r.match(path));
}

/**
 * Handles a request inside the builtin shim.
 * @param {string} path - e.g. '/api/plugins/similharity/chunks/query'
 * @param {RequestInit|undefined} init - original fetch init (body is parsed)
 * @returns {Promise<object>} Synthetic Response-like object
 */
export async function builtinFetch(path, init) {
    // Health: always green in builtin mode.
    if (path === '/api/plugins/similharity/health') {
        return ok({
            status: 'ok',
            plugin: 'similharity-builtin',
            version: BUILTIN_PLUGIN_VERSION,
            features: ['builtin-metadata', 'native-vector', 'collection-browser'],
        });
    }

    if (path === '/api/plugins/similharity/collections') {
        return handleCollections();
    }

    let body = {};
    if (init?.body) {
        try {
            body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        } catch {
            return fail(400, 'invalid JSON body');
        }
    }

    for (const route of POST_ROUTES) {
        if (route.match(path)) {
            return route.handler(body);
        }
    }

    return fail(404, `builtin shim: no route for ${path}`);
}
