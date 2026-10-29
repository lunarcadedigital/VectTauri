/**
 * VectTauri - Built-in Store
 *
 * Key-value storage abstraction for built-in Similharity mode.
 *
 * In TauriTavern: uses the host's per-chat persistent KV API
 * (`window.__TAURITAVERN__.api.chat` → store.setJson/getJson/listKeys/deleteJson).
 * Outside TauriTavern (desktop ST / tests): falls back to a namespaced tree in
 * `extension_settings.vecttauri.builtinStores` so unit tests and standard ST
 * installs keep working.
 *
 * Data layout:
 *   - Chunk metadata (per-chat): namespace `chunkmeta::<collectionId>`, key = hash
 *     → TT store.* in TauriTavern, settings fallback elsewhere.
 *   - Collection registry (global/cross-chat): namespace `__vecttauri_registry`
 *     → always settings-backed (TT store is per-chat, registry must be visible
 *     from every chat) via the global* functions.
 */

import { extension_settings } from "../../../../extensions.js";

const SETTINGS_FALLBACK_KEY = 'builtinStores';
const GLOBAL_SETTINGS_KEY = 'builtinGlobal';

/** @type {object|null} Lazily-resolved TauriTavern chat API handle */
let ttApi = null;
/** @type {boolean|null} tri-state: null = not probed yet */
let ttProbeAttempted = false;

/**
 * Resolves the TauriTavern chat API handle once per session.
 * The handle is chat-scoped: callers must key namespaces by collectionId and
 * accept that metadata lives per chat (global registry goes to settings).
 * @returns {object|null} The TauriTavern chat API, or null outside TT.
 */
function getTTApi() {
    if (ttProbeAttempted) return ttApi;
    ttProbeAttempted = true;
    try {
        ttApi = window?.__TAURITAVERN__?.api?.chat ?? null;
    } catch {
        ttApi = null;
    }
    return ttApi;
}

/** Test hook: forces re-probe of the TT environment. */
export function resetBuiltinStoreProbe() {
    ttApi = null;
    ttProbeAttempted = false;
}

/**
 * True when the built-in store is backed by TauriTavern's persistent KV.
 * @returns {boolean}
 */
export function isTTBacked() {
    return getTTApi() !== null;
}

// ---------------------------------------------------------------------------
// Settings fallback (non-TT environments)
// ---------------------------------------------------------------------------

function getFallbackTree() {
    if (!extension_settings.vecttauri) extension_settings.vecttauri = {};
    if (!extension_settings.vecttauri[SETTINGS_FALLBACK_KEY]) {
        extension_settings.vecttauri[SETTINGS_FALLBACK_KEY] = {};
    }
    return extension_settings.vecttauri[SETTINGS_FALLBACK_KEY];
}

// ---------------------------------------------------------------------------
// Public KV API
// ---------------------------------------------------------------------------

/**
 * Writes a JSON value under a namespace/key.
 * @param {string} namespace
 * @param {string} key
 * @param {*} value - JSON-serializable value
 * @returns {Promise<void>}
 */
export async function storeSetJson(namespace, key, value) {
    const tt = getTTApi();
    if (tt) {
        await tt.store.setJson({ namespace, key, value });
        return;
    }
    const tree = getFallbackTree();
    if (!tree[namespace]) tree[namespace] = {};
    tree[namespace][key] = value;
}

/**
 * Reads a JSON value from a namespace/key.
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<*|null>} The stored value, or null when absent.
 */
export async function storeGetJson(namespace, key) {
    const tt = getTTApi();
    if (tt) {
        const v = await tt.store.getJson({ namespace, key });
        return v ?? null;
    }
    return getFallbackTree()[namespace]?.[key] ?? null;
}

/**
 * Deletes a key from a namespace.
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function storeDeleteJson(namespace, key) {
    const tt = getTTApi();
    if (tt) {
        await tt.store.deleteJson({ namespace, key });
        return;
    }
    const tree = getFallbackTree();
    if (tree[namespace]) delete tree[namespace][key];
}

/**
 * Lists all keys in a namespace.
 * @param {string} namespace
 * @returns {Promise<string[]>}
 */
export async function storeListKeys(namespace) {
    const tt = getTTApi();
    if (tt) {
        const res = await tt.store.listKeys({ namespace });
        return Array.isArray(res) ? res : [];
    }
    return Object.keys(getFallbackTree()[namespace] ?? {});
}

/**
 * Drops an entire namespace (used by purge flows).
 * TT has no dropNamespace, so this enumerates and deletes keys.
 * @param {string} namespace
 * @returns {Promise<void>}
 */
export async function storeDropNamespace(namespace) {
    const keys = await storeListKeys(namespace);
    for (const key of keys) {
        await storeDeleteJson(namespace, key);
    }
}

// ---------------------------------------------------------------------------
// Global (cross-chat) storage — settings-backed everywhere
// ---------------------------------------------------------------------------
// TT's store.* is per-chat, so anything that must be visible from every chat
// (collection registry, per-collection model info) lives in
// extension_settings.vecttauri instead. Small JSON values only.

function getGlobalTree() {
    if (!extension_settings.vecttauri) extension_settings.vecttauri = {};
    if (!extension_settings.vecttauri[GLOBAL_SETTINGS_KEY]) {
        extension_settings.vecttauri[GLOBAL_SETTINGS_KEY] = {};
    }
    return extension_settings.vecttauri[GLOBAL_SETTINGS_KEY];
}

/**
 * Writes a JSON value to global (cross-chat) storage.
 * @param {string} namespace
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function globalSetJson(namespace, key, value) {
    const tree = getGlobalTree();
    if (!tree[namespace]) tree[namespace] = {};
    tree[namespace][key] = value;
}

/**
 * Reads a JSON value from global (cross-chat) storage.
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<*|null>}
 */
export async function globalGetJson(namespace, key) {
    return getGlobalTree()[namespace]?.[key] ?? null;
}

/**
 * Deletes a key from global (cross-chat) storage.
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function globalDeleteJson(namespace, key) {
    const tree = getGlobalTree();
    if (tree[namespace]) delete tree[namespace][key];
}

/**
 * Lists keys in a global namespace.
 * @param {string} namespace
 * @returns {Promise<string[]>}
 */
export async function globalListKeys(namespace) {
    return Object.keys(getGlobalTree()[namespace] ?? {});
}
