/**
 * VectTauri - Similharity Transport Router
 *
 * Single choke point for every Similharity plugin request. Three transports:
 *
 *  - 'builtin'    — TauriTavern detected (window.__TAURITAVERN__) and the user
 *                   has not forced a bridge URL. Requests are served by the
 *                   in-WebView shim (utils/builtin-similharity.js): vectors via
 *                   native /api/vector/* (Rust, on-device), rich metadata via
 *                   the TT store API. No network, no TLS, no CORS.
 *  - 'bridge'     — user configured an external bridge URL (Termux/Qdrant setups).
 *  - 'st-plugin'  — desktop SillyTavern with the plugin installed; relative
 *                   paths hit ST's own /api/plugins/similharity/* routes.
 *
 * Mode resolution (settings.similharity_mode):
 *  - 'auto' (default): TT present → builtin unless a bridge URL is set;
 *                      no TT → st-plugin unless a bridge URL is set.
 *  - 'builtin'/'bridge': force that transport (bridge still needs a URL).
 */

import { extension_settings } from "../../../../extensions.js";
import { builtinFetch, isBuiltinRoute } from "./builtin-similharity.js";

/**
 * Detects the TauriTavern host environment.
 * @returns {boolean} True when running inside TauriTavern.
 */
export function isTauriTavern() {
    try {
        return typeof window !== 'undefined' && !!window.__TAURITAVERN__;
    } catch {
        return false;
    }
}

/**
 * Returns the user's bridge mode preference.
 * @returns {'auto'|'builtin'|'bridge'}
 */
function getModePreference() {
    return extension_settings?.vecttauri?.similharity_mode || 'auto';
}

/**
 * Resolves which transport handles Similharity requests this session.
 * @returns {'builtin'|'bridge'|'st-plugin'}
 */
export function getSimilharityMode() {
    const pref = getModePreference();
    const base = getSimilharityBaseUrl();
    if (pref === 'bridge') return base ? 'bridge' : 'st-plugin';
    if (pref === 'builtin') return 'builtin';
    // auto
    if (base) return 'bridge';
    return isTauriTavern() ? 'builtin' : 'st-plugin';
}

export function getSimilharityBaseUrl() {
    const url = extension_settings?.vecttauri?.similharity_url || "";
    // Strip trailing slash
    return url.replace(/\/+$/, "");
}

export function getPluginUrl(path) {
    const base = getSimilharityBaseUrl();
    // If no base URL configured, use relative path (works when plugin is installed in ST)
    if (!base) return path;
    return base + path;
}

/**
 * Single entry point replacing `fetch(getPluginUrl(path), init)` for all
 * Similharity calls. Routes to the builtin shim when appropriate; otherwise
 * performs a real fetch exactly like before.
 *
 * @param {string} path - Plugin path, e.g. '/api/plugins/similharity/health'
 * @param {RequestInit} [init]
 * @returns {Promise<Response>} Real or Response-like object
 */
export async function similharityFetch(path, init) {
    const mode = getSimilharityMode();
    if (mode === 'builtin' && isBuiltinRoute(path)) {
        return builtinFetch(path, init);
    }
    return fetch(getPluginUrl(path), init);
}
