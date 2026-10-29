/**
 * VectTauri - LLM Config Mirror Store
 *
 * Durable, SYNCHRONOUS mirror of the LLM connection settings (chat_provider,
 * chat_model, chat_vllm_url, agent provider fields, model parameter style).
 *
 * Why this exists: chat-side LLM config was previously persisted only through
 * ST's debounced settings save. On mobile (TauriTavern app-switching, quick
 * "fill config → hit Vectorize" flows) the debounce can be starved or the
 * in-memory settings object can be re-merged from a stale copy, and the user
 * gets "Summarization / EventBase extraction model is not set" even though
 * they just filled everything in (2026-10-29 bug report). This store is the
 * llm-verify pattern: write-through on every change, read-through on every
 * read, no async, no debounce in the hot path.
 *
 * Scope note: API keys are deliberately NOT stored here — they live in ST's
 * secret_state (server-side, masked) via writeSecret(). Only non-secret
 * connection fields are mirrored. localStorage in a Tauri WebView is
 * per-app, per-origin private storage — same trust level as settings.json.
 */

const MIRROR_KEY = 'vecttauri_llm_config_mirror_v1';

/** Fields mirrored. Keep in sync with index.js defaultSettings chat_* keys. */
const MIRRORED_FIELDS = Object.freeze([
    'chat_provider',
    'chat_model',
    'chat_vllm_url',
    'should_send_temperature',
    'should_use_max_completion_tokens',
    'should_disable_thinking',
    'agent_provider',
    'agent_model',
    'agent_vllm_url',
    'reformat_provider',
    'reformat_model',
    'reformat_vllm_url',
]);

/** @type {object|null} lazily-loaded in-memory copy */
let cache = null;
/** @type {boolean|null} tri-state probe memo */
let storageAvailable = null;

/**
 * Synchronous localStorage availability probe (memoized). JSDOM/vitest and
 * hardened WebViews can throw on access; treat that as "unavailable" and let
 * callers fall back to extension_settings only.
 * @returns {boolean}
 */
function hasLocalStorage() {
    if (storageAvailable !== null) return storageAvailable;
    try {
        const probeKey = `${MIRROR_KEY}__probe`;
        window.localStorage.setItem(probeKey, '1');
        window.localStorage.removeItem(probeKey);
        storageAvailable = true;
    } catch {
        storageAvailable = false;
    }
    return storageAvailable;
}

/**
 * Loads and caches the mirror. Returns {} when absent or unreadable.
 * @returns {object}
 */
function loadMirror() {
    if (cache) return cache;
    cache = {};
    if (!hasLocalStorage()) return cache;
    try {
        const raw = window.localStorage.getItem(MIRROR_KEY);
        if (!raw) return cache;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            // Only accept known fields — defends against a corrupted or
            // hand-edited mirror injecting arbitrary settings keys.
            for (const field of MIRRORED_FIELDS) {
                if (parsed[field] !== undefined) cache[field] = parsed[field];
            }
        }
    } catch {
        cache = {};
    }
    return cache;
}

/**
 * Persists the in-memory cache synchronously.
 */
function persistMirror() {
    if (!hasLocalStorage()) return;
    try {
        window.localStorage.setItem(MIRROR_KEY, JSON.stringify(cache));
    } catch {
        // Quota/exotic WebView failure — mirror is best-effort. The primary
        // persistence (extension_settings + debounced save) still applies.
    }
}

/**
 * Test hook: clears the in-memory cache so the next read reloads from storage.
 */
export function resetLlmConfigMirrorCache() {
    cache = null;
}

/**
 * Wipes the mirror entirely (used by full-purge flows and tests).
 */
export function clearLlmConfigMirror() {
    cache = {};
    if (hasLocalStorage()) {
        try {
            window.localStorage.removeItem(MIRROR_KEY);
        } catch { /* best-effort */ }
    }
}

/**
 * Saves one or more LLM config fields synchronously.
 * @param {object} fields - subset of MIRRORED_FIELDS → value
 * @returns {void}
 */
export function saveLlmConfigFields(fields) {
    if (!fields || typeof fields !== 'object') return;
    const mirror = loadMirror();
    let changed = false;
    for (const field of MIRRORED_FIELDS) {
        if (fields[field] !== undefined) {
            mirror[field] = fields[field];
            changed = true;
        }
    }
    if (changed) persistMirror();
}

/**
 * Reads one mirrored field.
 * @param {string} field
 * @returns {*|undefined} value or undefined when never mirrored
 */
export function readLlmConfigField(field) {
    return loadMirror()[field];
}

/**
 * Returns the mirrored config as a plain object (only fields actually set).
 * @returns {object}
 */
export function readLlmConfigMirror() {
    return { ...loadMirror() };
}

/**
 * Overlay helper for read sites: applies the mirror on top of a base object.
 * Mirror values win ONLY when the base value is missing or an empty string —
 * a deliberately-set global (user edited the field, debounce flushed) should
 * not be resurrected from an older mirror snapshot.
 *
 * @param {object} base - settings object to overlay onto (mutated copy returned)
 * @returns {object} new object with mirror fallbacks applied
 */
export function applyLlmConfigMirrorFallback(base) {
    const out = { ...(base ?? {}) };
    const mirror = loadMirror();
    for (const field of MIRRORED_FIELDS) {
        const current = out[field];
        const isEmpty = current === undefined || current === null || (typeof current === 'string' && current.trim() === '');
        if (isEmpty && mirror[field] !== undefined) {
            out[field] = mirror[field];
        }
    }
    return out;
}
