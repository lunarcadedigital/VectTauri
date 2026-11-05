/**
 * ============================================================================
 * OPENAI-COMPATIBLE EMBEDDINGS (client-side)
 * ============================================================================
 * Client-side embedding for any endpoint that speaks the OpenAI
 * `POST {base}/embeddings` contract — Electron Hub, and any custom
 * gateway/LM Studio/self-hosted endpoint the user points at.
 *
 * Why client-side: VectTauri's vector store is a generic sink. Making the
 * store learn each provider's base URL + secret would mean a new storage-side
 * code path per provider, and a provider the store does not know would fail
 * every insert. Embedding here instead means any OpenAI-compatible endpoint
 * works with zero storage-side changes: we send finished vectors, and the
 * store only has to keep them.
 *
 * Response contract (OpenAI):
 *   { object: "list", data: [{ object: "embedding", embedding: [..], index: 0 }],
 *     model: "...", usage: { ... } }
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import { log } from './log.js';

/** Electron Hub's fixed API root (their docs: https://api.electronhub.ai/v1). */
export const ELECTRON_HUB_BASE_URL = 'https://api.electronhub.ai/v1';

/** Texts per HTTP call. Providers cap batch size; 32 is safe for all of them. */
const EMBEDDING_BATCH_SIZE = 32;

/**
 * Resolves the base URL for an OpenAI-compatible provider.
 *
 * Trailing `/embeddings` and `/v1` handling: users paste whatever their
 * provider's dashboard shows — `https://x/v1`, `https://x/v1/embeddings`, or
 * `https://x`. All three must work, so the endpoint is normalized once here
 * instead of at every call site.
 *
 * @param {object} settings - VectTauri settings
 * @returns {string} Base URL ending in `/v1` (no trailing slash), or '' when unset.
 */
export function resolveOpenAiCompatibleBaseUrl(settings) {
    const provider = settings?.embedding_provider;
    const raw = provider === 'electronhub'
        ? (String(settings?.embedding_electronhub_url || '').trim() || ELECTRON_HUB_BASE_URL)
        : String(settings?.embedding_custom_url || '').trim();

    if (!raw) return '';

    return raw
        .replace(/\/+$/, '')
        .replace(/\/embeddings$/i, '')
        .replace(/\/+$/, '');
}

/**
 * The API key for the active OpenAI-compatible provider.
 *
 * Electron Hub keys are prefixed `ek-` and have no SillyTavern secret slot, so
 * both providers keep their key in VectTauri settings. This is the single read
 * point; UI writes `embedding_electronhub_api_key` / `embedding_custom_api_key`.
 *
 * @param {object} settings - VectTauri settings
 * @returns {string}
 */
export function getOpenAiCompatibleApiKey(settings) {
    const provider = settings?.embedding_provider;
    const key = provider === 'electronhub'
        ? settings?.embedding_electronhub_api_key
        : settings?.embedding_custom_api_key;
    return String(key || '').trim();
}

/**
 * True when a `/models` entry can actually produce embeddings.
 *
 * A `/models` listing usually carries NO "this is an embedding model" flag.
 * Three independent signals are checked, in order of trust:
 *   1. `endpoints` — an Electron Hub / OpenRouter-style model object lists the
 *      route it serves (`/v1/embeddings` for embedding models). Most reliable.
 *   2. `architecture.output_modalities` — some gateways tag modality explicitly.
 *   3. the id/name itself (`text-embedding-3-small`, `nomic-embed-text`,
 *      `bge-m3-embed`) — the ecosystem's conventional naming.
 * A non-match is never fatal: the picker falls back to manual model entry.
 *
 * @param {object} entry - One element of a `/models` response
 * @returns {boolean}
 */
export function isEmbeddingModelEntry(entry) {
    // 1. Explicit route list — the authoritative "what does this model serve".
    const endpoints = entry?.endpoints;
    if (Array.isArray(endpoints) && endpoints.length > 0) {
        return endpoints.some(e => /embedding/i.test(String(e)));
    }

    // 2. Explicit modality tag.
    const mods = entry?.architecture?.output_modalities;
    if (Array.isArray(mods) && mods.length > 0) return mods.includes('embeddings');

    // 3. Naming convention fallback.
    return /embed/i.test(String(entry?.id || entry?.name || ''));
}

/**
 * Lists the embedding-capable models a given endpoint exposes.
 *
 * `/models` alone answers the wrong question: gateways that support the
 * `output_modalities` filter answer with embedding models only, while the rest
 * ignore the parameter and return chat models — so the response is filtered
 * again client-side. Returns [] rather than throwing when the endpoint has no
 * usable listing; callers then let the user type the id.
 *
 * @param {string} baseUrl - Resolved base URL (see resolveOpenAiCompatibleBaseUrl)
 * @param {string} apiKey
 * @returns {Promise<string[]>} Sorted model ids
 */
export async function listOpenAiCompatibleEmbeddingModels(baseUrl, apiKey) {
    if (!baseUrl) return [];
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

    const fetchList = async (url) => {
        try {
            const resp = await fetch(url, { method: 'GET', headers });
            if (!resp.ok) return null;
            const data = await resp.json();
            return Array.isArray(data) ? data
                 : Array.isArray(data?.data) ? data.data
                 : null;
        } catch {
            return null;
        }
    };

    const entries = (await fetchList(`${baseUrl}/models?output_modalities=embeddings`))
        ?? (await fetchList(`${baseUrl}/models`))
        ?? [];

    return entries
        .filter(e => e && (e.id || e.name))
        .filter(isEmbeddingModelEntry)
        .map(e => String(e.id || e.name))
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Embeds texts through an OpenAI-compatible `/embeddings` endpoint.
 *
 * @param {string[]} texts - Texts to embed
 * @param {object} settings - VectTauri settings
 * @param {object} [opts]
 * @param {AbortSignal|null} [opts.signal] - Abort signal for Stop
 * @param {Function|null} [opts.onProgress] - (embedded, total) => void
 * @returns {Promise<Record<string, number[]>>}
 */
export async function createOpenAiCompatibleEmbeddings(texts, settings, { signal = null, onProgress = null } = {}) {
    const result = /** @type {Record<string, number[]>} */ ({});
    if (!Array.isArray(texts) || texts.length === 0) return result;

    const provider = settings?.embedding_provider;
    const baseUrl = resolveOpenAiCompatibleBaseUrl(settings);
    const apiKey = getOpenAiCompatibleApiKey(settings);
    const model = String(
        provider === 'electronhub'
            ? settings?.embedding_electronhub_model
            : settings?.embedding_custom_model,
    '').trim() || (provider === 'electronhub' ? 'text-embedding-3-small' : '');

    if (!baseUrl) {
        throw new Error(`${provider}: embeddings URL is not set — fill in the endpoint before vectorizing.`);
    }
    if (!apiKey) {
        throw new Error(`${provider}: API key is not set — paste the key before vectorizing.`);
    }
    if (!model) {
        throw new Error(`${provider}: embedding model is not set — name the model before vectorizing.`);
    }

    const endpoint = `${baseUrl}/embeddings`;
    let embedded = 0;

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
        if (signal?.aborted) {
            throw Object.assign(new Error('Vectorization stopped by user'), { name: 'AbortError' });
        }

        const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ input: batch, model, encoding_format: 'float' }),
            signal: signal || undefined,
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '(no body)');
            throw new Error(
                `${provider} embeddings failed: ${response.status} ${response.statusText} — ${errorBody.slice(0, 300)}`,
            );
        }

        const data = await response.json().catch(() => null);
        const rows = Array.isArray(data?.data) ? data.data : null;
        if (!rows) {
            throw new Error(`${provider} embeddings returned an unexpected body (no "data" array).`);
        }
        if (rows.length !== batch.length) {
            throw new Error(
                `${provider} embeddings returned ${rows.length} vector(s) for ${batch.length} input(s).`,
            );
        }

        // Providers are not required to preserve order; `index` is the contract.
        rows.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));

        for (let j = 0; j < rows.length; j++) {
            const vector = rows[j]?.embedding;
            if (!Array.isArray(vector) || vector.length === 0) {
                throw new Error(`${provider} embeddings returned an empty vector for one input.`);
            }
            result[batch[j]] = vector;
        }

        embedded += batch.length;
        if (onProgress) onProgress(Math.min(embedded, texts.length), texts.length);
        log.verbose(`[VectTauri] ${provider}: embedded ${embedded}/${texts.length} (dim=${rows[0]?.embedding?.length ?? 'n/a'})`);
    }

    return result;
}