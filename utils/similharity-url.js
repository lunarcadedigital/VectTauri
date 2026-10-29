/**
 * VectTauri - Similharity Bridge URL Helper
 * 
 * Returns the configurable base URL for the Similharity plugin bridge.
 * Users set this in VectTauri Settings → Similharity Bridge URL.
 * Default: https://localhost:8443
 */

import { extension_settings } from "../../../../extensions.js";

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
