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
/** @type {boolean|null} tri-state: null = not probed yet */
let ttProbeAttempted = false;

/**
 * Resolves the TT GLOBAL extension store handle once per session.
 *
 * Correct store per types.d.ts (2026-10-30): `window.__TAURITAVERN__.api`
 * is TauriTavernHostApi → **`api.extension.store`** is the GLOBAL
 * extension KV (TauriTavernExtensionStoreApi — setJson/getJson/tryGetJson/
 * listKeys/deleteJson, table-aware). Collections live in the native redb
 * vector store which is GLOBAL, so chunk metadata must be global too —
 * storing it in the per-chat `api.chat→handle.store` made Database Browser
 * "View chunks" read from a different scope than insert wrote to
 * ("No chunks found in this collection" bug).
 *
 * Ponytail rules: resolve whatever shape is present (api.chat may be a
 * factory), verify the methods exist, and on ANY mismatch return null so
 * callers fall back to the settings tree. Preference order:
 *   1. api.extension.store  (global — correct)
 *   2. api.chat() handle     (per-chat — legacy fallback, still better
 *                             than losing data to the settings tree)
 * @returns {Promise<object|null>} A verified store handle, or null.
 */
async function getTTStore() {
    const candidates = [];
    try {
        const root = window?.__TAURITAVERN__?.api;
        if (!root) return null;
        if (root.extension?.store) candidates.push(root.extension.store);
        let chatHandle = root.chat;
        if (typeof chatHandle === 'function') chatHandle = await chatHandle();
        if (chatHandle?.store) candidates.push(chatHandle.store);
    } catch {
        return null;
    }
    for (const store of candidates) {
        if (store && typeof store.setJson === 'function' && typeof store.getJson === 'function') {
            return store;
        }
    }
    return null;
}

/** @type {object|null} resolved store handle (null = not resolved or unavailable) */
let ttStore = null;
/** @type {Promise<object|null>|null} in-flight resolution */
let ttStorePromise = null;

/**
 * Awaits the verified store handle (single-flight).
 * @returns {Promise<object|null>}
 */
async function ttStoreOrFallback() {
    if (ttStore) return ttStore;
    if (!ttStorePromise) {
        ttStorePromise = getTTStore().then(s => { ttStore = s; return s; });
    }
    return ttStorePromise;
}

/** Test hook: forces re-probe of the TT environment. */
export function resetBuiltinStoreProbe() {
    ttStore = null;
    ttStorePromise = null;
}

/**
 * True when the built-in store is backed by TauriTavern's persistent KV.
 * @returns {boolean}
 */
export async function isTTBacked() {
    return (await ttStoreOrFallback()) !== null;
}

// ---------------------------------------------------------------------------
// Component sanitization — TT store contract (file_extension_store_repository.rs)
// ---------------------------------------------------------------------------
// TT validates BOTH namespace and key against [A-Za-z0-9_.-] with no leading
// dot (validate_component). Collection IDs routinely contain ':' and other
// characters (vf_eventbase:<char>:<uuid>), so raw use of them as a namespace
// fails with "Invalid extension store namespace". Sanitize at THIS single
// choke point — every caller (shim, registry, DB browser) goes through these
// functions, so no call site needs to remember the rule.

/**
 * Sanitizes a namespace or key to TT's store component contract
 * ([A-Za-z0-9_.-], no leading dot — file_extension_store_repository.rs).
 *
 * The previous %-escaped scheme still emitted `%`, which TT itself REJECTS
 * (it is not in [A-Za-z0-9_.-]) — so sanitized namespaces kept failing with
 * "Invalid extension store namespace". Correction: use HEX ONLY.
 *
 * Rules (injective for the data this extension actually produces):
 *  - already-valid components pass through unchanged;
 *  - anything else becomes `hex_` + lowercase hex of its UTF-8 bytes, so the
 *    output alphabet is pure [0-9a-f] (+ the 'hex_' prefix, whose 'h'/'x' are
 *    NOT hex digits and therefore can never collide with a raw chunk hash key).
 *    Namespaces in this codebase ALWAYS contain "::", so they ALWAYS take the
 *    encoded branch and never collide with the raw branch.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeStoreComponent(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return '_empty';
    if (/^[A-Za-z0-9_.-]+$/.test(value) && !value.startsWith('.')) {
        return value;
    }
    const bytes = new TextEncoder().encode(value);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return `hex_${hex}`;
}

/**
 * Reverses sanitizeStoreComponent (used to turn listKeys output back into
 * raw keys before passing them to delete/get — those re-sanitize internally).
 * @param {string} encoded
 * @returns {string}
 */
export function unescapeStoreComponent(encoded) {
    const value = String(encoded ?? '');
    if (!value.startsWith('hex_')) return value;
    const hex = value.slice(4);
    if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return value;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(bytes);
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
    namespace = sanitizeStoreComponent(namespace);
    key = sanitizeStoreComponent(key);
    const store = await ttStoreOrFallback();
    if (store) {
        await store.setJson({ namespace, key, value });
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
    namespace = sanitizeStoreComponent(namespace);
    key = sanitizeStoreComponent(key);
    const store = await ttStoreOrFallback();
    if (store) {
        // Prefer tryGetJson (global store shape): returns {found, value} and
        // never throws for a missing key. getJson on the same store may throw
        // or reject for absent keys depending on the backend table.
        if (typeof store.tryGetJson === 'function') {
            try {
                const res = await store.tryGetJson({ namespace, key });
                return res?.found ? (res.value ?? null) : null;
            } catch { /* fall through to getJson */ }
        }
        try {
            const v = await store.getJson({ namespace, key });
            return v ?? null;
        } catch {
            return null; // missing key — treated as absent, not an error
        }
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
    namespace = sanitizeStoreComponent(namespace);
    key = sanitizeStoreComponent(key);
    const store = await ttStoreOrFallback();
    if (store) {
        await store.deleteJson({ namespace, key });
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
    namespace = sanitizeStoreComponent(namespace);
    const store = await ttStoreOrFallback();
    if (store) {
        const res = await store.listKeys({ namespace });
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
    // NOTE: no sanitize here — storeListKeys/storeDeleteJson sanitize the raw
    // namespace themselves, and pre-sanitizing would double-encode (%3a → %253a)
    // and read/delete a namespace that was never written.
    const encodedKeys = await storeListKeys(namespace);
    for (const encoded of encodedKeys) {
        const rawKey = unescapeStoreComponent(encoded);
        await storeDeleteJson(namespace, rawKey);
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
