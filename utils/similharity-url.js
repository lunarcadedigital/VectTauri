/**
 * VectTauri - Similharity Transport
 *
 * Single choke point for every Similharity plugin request. There is exactly
 * one transport: the built-in shim (utils/builtin-similharity.js), which
 * serves the plugin contract in-WebView — vectors via native /api/vector/*
 * (Rust, on-device), rich metadata via the TT store API. No network, no TLS,
 * no CORS, no configuration.
 *
 * VectTauri ships to TauriTavern users; SillyTavern users install VectFox.
 */

import { builtinFetch, isBuiltinRoute } from "./builtin-similharity.js";

/**
 * Resolves the request path as-is (kept for compatibility with existing
 * callers and tests that mock this function).
 * @param {string} path
 * @returns {string}
 */
export function getPluginUrl(path) {
    return path;
}

/**
 * Single entry point replacing `fetch(getPluginUrl(path), init)` for all
 * Similharity calls. Serves every known plugin route from the built-in shim.
 * Unknown routes get a synthetic 404 — no network request is ever made.
 *
 * @param {string} path - Plugin path, e.g. '/api/plugins/similharity/health'
 * @param {RequestInit} [init]
 * @returns {Promise<Response>} Response-like object from the shim
 */
export async function similharityFetch(path, init) {
    if (isBuiltinRoute(path)) {
        return builtinFetch(path, init);
    }
    return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ success: false, error: `builtin: no route for ${path}` }),
        text: async () => JSON.stringify({ success: false, error: `builtin: no route for ${path}` }),
    };
}
