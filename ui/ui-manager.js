/**
 * ============================================================================
 * VectTauri UI MANAGER
 * ============================================================================
 * Handles ALL UI rendering and event binding
 * Keeps index.js clean and lean
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import { saveSettingsDebounced, getCurrentChatId, eventSource, event_types, getRequestHeaders } from '../../../../../script.js';
import { extension_settings, openThirdPartyExtensionMenu, getContext } from '../../../../extensions.js';
import { writeSecret, deleteSecret, SECRET_KEYS, secret_state, readSecretState } from '../../../../secrets.js';
import {
    getOpenRouterApiKey,
    getCustomApiKey,
    getQdrantApiKey,
    fetchQdrantApiKeyPresence,
} from '../core/api-keys.js';
import { getWebLlmProvider as getSharedWebLlmProvider } from '../providers/webllm.js';
import StringUtils from '../utils/string-utils.js';
import { openVisualizer } from './chunk-visualizer.js';
import { openDatabaseBrowser } from './database-browser.js';
import { openContentVectorizer } from './content-vectorizer.js';
import { openSearchDebugModal, openQueryTestModal, getLastSearchDebug } from './search-debug.js';
import { openTextCleaningManager } from './text-cleaning-manager.js';
import { progressTracker } from './progress-tracker.js';
import { resetBackendHealth } from '../backends/backend-manager.js';
import { runNetworkStartup } from '../core/network-startup.js';
import { isVectTauriEnabled } from '../core/feature-gate.js';
import { clearInterceptorPrompts } from '../core/chat-vectorization.js';
import { clearLorebookPrompt } from '../core/world-info-integration.js';
import { refreshWorldInfoEntryDepthCache } from '../core/summarizer-injection.js';
import { getHealthIndicatorHtml, getHealthModalHtml, initializeHealthDashboard, refreshIndicator as refreshHealthIndicator } from './health-dashboard.js';
import { doesChatHaveVectors, getCollectionRegistry, getCollectionListing, checkPluginAvailable } from '../core/collection-loader.js';
import { getCollectionMeta } from '../core/collection-metadata.js';
import { parseRegistryKey } from '../core/collection-ids.js';
import { getModelField } from '../core/providers.js';
import { getChunkingStrategies } from '../core/content-types.js';
import { CJK_TOKENIZER_MODES, setCjkTokenizerMode, ensureJiebaTokenizerLoaded, ensureJiebaTwLoaded } from '../core/bm25-scorer.js';
import { LANGUAGE_MODES } from '../core/language-modes.js';
import {
    RETRIEVAL_TIMEOUT_DEFAULT_MS,
    RETRIEVAL_TIMEOUT_MIN_MS,
    RETRIEVAL_TIMEOUT_MAX_MS,
    AGENTIC_PLANNER_TIMEOUT_DEFAULT_MS,
    AGENTIC_QUERY_TIMEOUT_DEFAULT_MS,
    AGENTIC_TIMEOUT_MIN_MS,
    AGENTIC_TIMEOUT_MAX_MS,
    AGENTIC_MAX_TOKENS_DEFAULT,
    AGENTIC_MAX_TOKENS_MIN,
    AGENTIC_MAX_TOKENS_MAX,
} from '../core/constants.js';
import {
    resolveRetrievalTimeoutMs,
    resolveAgenticPlannerTimeoutMs,
    resolveAgenticQueryTimeoutMs,
    resolveAgenticMaxTokens,
} from '../core/retrieval-budget.js';
import { log } from '../core/log.js';
import { getPluginUrl, similharityFetch } from '../utils/similharity-url.js';
import { saveLlmConfigFields } from '../utils/llm-config-store.js';

/**
 * Renders the VectTauri settings UI
 * @param {string} containerId - The container element ID to render into
 * @param {object} settings - VectTauri settings object
 * @param {object} callbacks - Object containing callback functions
 * @param {Function} callbacks.onVectorizeAll - Called when "Vectorize All" is clicked
 * @param {Function} callbacks.onPurge - Called when "Purge" is clicked
 * @param {Function} callbacks.onCleanupCorrupted - Called when "Cleanup Corrupted" is clicked
 * @param {Function} callbacks.onRunDiagnostics - Called when "Run Diagnostics" is clicked
 */
export function renderSettings(containerId, settings, callbacks) {
    log.lifecycle('VectTauri UI: Rendering settings...');

    // Ensure extension_settings.vecttauri exists before any UI event handlers fire
    if (!extension_settings.vecttauri) {
        extension_settings.vecttauri = {};
    }

    const html = `
        <div id="VectTauri_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>VectTauri - Advanced RAG</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">

                    <!-- Master switch — global enable/disable for all VectTauri runtime work -->
                    <div class="vecttauri-master-switch">
                        <label class="checkbox_label" for="VectTauri_master_enabled" style="font-weight: 600;">
                            <input type="checkbox" id="VectTauri_master_enabled" />
                            <span>Enable VectTauri</span>
                        </label>
                        <small class="VectTauri_hint" id="VectTauri_master_hint">Master switch. When off, VectTauri stops all automatic retrieval injection, auto-sync, and lorebook injection. Manual tools (Database Browser, Vectorize Content) stay available.</small>
                    </div>

                    <!-- Tab Navigation -->
                    <div class="vecttauri-tabs">
                        <div class="vecttauri-tab-nav-row">
                            <button class="vecttauri-tab-btn active" data-tab="action">Action</button>
                            <button class="vecttauri-tab-btn" data-tab="core">Core</button>
                            <button class="vecttauri-tab-btn" data-tab="eventbase">EventBase</button>
                            <button class="vecttauri-tab-btn" data-tab="weight">ChunkBase</button>
                        </div>
                        <div class="vecttauri-tab-nav-row">
                            <button class="vecttauri-tab-btn" data-tab="autosync">AutoSync</button>
                            <button class="vecttauri-tab-btn" data-tab="worldinfo">WorldInfo</button>
                            <button class="vecttauri-tab-btn" data-tab="rag">RAG</button>
                            <button class="vecttauri-tab-btn" data-tab="agentmode">AgentMode</button>
                        </div>
                    </div>

                    <!-- Core Settings Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="core">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon">
                                    <i class="fa-solid fa-cog"></i>
                                </span>
                                Core Settings
                            </h3>
                            <p class="vecttauri-card-subtitle">Shared settings for embedding, retrieval, and EventBase extraction.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 1: Vector Storage                                -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-database"></i></span>
                                        Vector Storage
                                    </h3>
                                    <p class="vecttauri-card-subtitle">Vector database backend</p>
                                </div>

                                <label for="VectTauri_vector_backend">
                                    <small>Vector Backend</small>
                                </label>
                                <!--
                                    MAINTAINERS: the "standard" backend (ST's Vectra via similharity plugin)
                                    has a concurrency problem on the PLUGIN side — concurrent POSTs to
                                    /api/plugins/similharity/chunks/insert corrupt the Vectra index file
                                    (the plugin doesn't synchronize per-collection writes). Observed
                                    2026-05-30 under parallel-split + hedge: variable-position
                                    truncated-JSON 500s back to the client.

                                    SOLUTION (shipped 2026-05-30): serialize per-collection writes on the
                                    CLIENT side inside backends/standard.js#_vectraWriteQueues. The Map
                                    keys are collectionId; each new insertVectorItems call chains onto the
                                    previous one for the same collection. Result: the plugin only ever
                                    sees one in-flight insert per collection, no matter how many concurrent
                                    callers (parallel-split, hedge duplicates, pipelined batches) we have.

                                    Effect on the new features:
                                      - hedge: STILL ENABLED, but duplicates queue instead of racing →
                                        only useful when primary FAILS (then hedge runs after primary
                                        clears), not when primary is slow
                                      - parallel-split: STILL ENABLED, but writes serialize → behaves like
                                        a per-event retry budget rather than true parallelism
                                      - pipelined: STILL ENABLED, extract can still run while previous
                                        batch's insert is being serialized through the queue

                                    Trade-off accepted because the alternative (force-disable all three on
                                    standard) is worse than serial-queue with all three enabled — see the
                                    "Vector backend selection" change handler below.

                                    Qdrant backend uses a different plugin endpoint (/qdrant/...) with
                                    different code paths and does NOT need the queue.
                                -->
                                <select id="VectTauri_vector_backend" class="vecttauri-select">
                                    <option value="standard">Standard (ST's Vectra - file-based)</option>
                                    <option value="qdrant">Qdrant (production vector search)</option>
                                </select>
                                <small class="vecttauri-help-text" style="display: block; margin-top: -8px; margin-bottom: 16px; opacity: 0.7; font-size: 0.85em; line-height: 1.5;">
                                    • Standard: ST's built-in Vectra (best for &lt;100k vectors)<br>
                                    • Qdrant: Production-grade with HNSW, filtering, cloud support
                                </small>
                                <!-- Persistent notice shown whenever the Similharity plugin is absent,
                                     explaining why the Qdrant option is disabled. Distinct from the
                                     transient red revert alert below. -->
                                <small id="VectTauri_qdrant_plugin_notice" class="VectTauri_hint" style="display:none; color:#e0a44a; font-weight:600; margin-top:-8px; margin-bottom:16px; line-height:1.5;">
                                    ⚠ Similharity plugin not detected. <a href="https://github.com/KritBlade/VectTauri/tree/Similharity-Plugin#step-2-install-plugin-via-git-recommended" target="_blank" rel="noopener noreferrer">Install</a> the plugin for Qdrant backend.
                                </small>
                                <small id="VectTauri_qdrant_plugin_error" class="VectTauri_hint" style="display:none; color:#e04a4a; font-weight:600; margin-top:-8px; margin-bottom:16px; line-height:1.5;">
                                    ⚠ Qdrant requires the Similharity server plugin, which is not installed. Install the plugin to use this backend, or switch to Standard.
                                </small>

                                <!-- Qdrant Settings (shown only when Qdrant backend is selected) -->
                                <div id="VectTauri_qdrant_settings" style="display: none;">
                                    <label class="checkbox_label">
                                        <input type="checkbox" id="VectTauri_qdrant_use_cloud" />
                                        <span>Use Qdrant Cloud</span>
                                    </label>

                                    <!-- Local Qdrant Settings -->
                                    <div id="VectTauri_qdrant_local_settings">
                                        <label for="VectTauri_qdrant_host">
                                            <small>Qdrant Host:</small>
                                        </label>
                                        <input type="text" id="VectTauri_qdrant_host" class="vecttauri-input" placeholder="127.0.0.1" />

                                        <label for="VectTauri_qdrant_port">
                                            <small>Qdrant Port:</small>
                                        </label>
                                        <input type="number" id="VectTauri_qdrant_port" class="vecttauri-input" placeholder="6333" />
                                    </div>

                                    <!-- Cloud Qdrant Settings -->
                                    <div id="VectTauri_qdrant_cloud_settings" style="display: none;">
                                        <label for="VectTauri_qdrant_url">
                                            <small>Qdrant Cloud URL:</small>
                                        </label>
                                        <input type="text" id="VectTauri_qdrant_url" class="vecttauri-input" placeholder="https://xxx.cloud.qdrant.io" />

                                        <label for="VectTauri_qdrant_api_key">
                                            <small>API Key:</small>
                                        </label>
                                        <input type="password" id="VectTauri_qdrant_api_key" class="vecttauri-input" placeholder="Your Qdrant Cloud API key" />
                                    </div>

                                    <!-- Qdrant Multitenancy Setting -->
                                    <div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                                        <label class="checkbox_label" title="When enabled, uses a single Qdrant collection with content_type filtering (multitenancy). When disabled, creates separate collections for each content type (better isolation).">
                                            <input type="checkbox" id="VectTauri_qdrant_multitenancy" />
                                            <span>Use Multitenancy (Single Collection)</span>
                                        </label>
                                        <small class="VectTauri_hint" style="display: block; margin-top: 4px;">
                                            <strong>Multitenancy ON:</strong> Single collection with filtering (saves resources)<br>
                                            <strong>Multitenancy OFF:</strong> Separate collections per content type (better isolation)
                                        </small>
                                    </div>
                                </div>
                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 2: Embedding                                     -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-microchip"></i></span>
                                        Embedding
                                    </h3>
                                    <p class="vecttauri-card-subtitle">Embedding provider and model</p>
                                </div>

                                <div style="margin: 4px 0 12px 0; padding: 8px 10px; border: 1px solid var(--crimson, #c0392b); border-left-width: 3px; border-radius: 4px; background: rgba(192, 57, 43, 0.08);">
                                    <small style="color: var(--crimson, #e74c3c); font-weight: 600;">
                                        <i class="fa-solid fa-triangle-exclamation"></i>
                                        Do NOT change the embedding provider or model after a collection's first vectorization.
                                    </small>
                                    <small style="display: block; margin-top: 4px; opacity: 0.85;">
                                        Existing vectors were built with the original model — mixing models in one collection breaks retrieval. To switch, re-vectorize the collection from scratch.
                                    </small>
                                </div>

                                <label for="VectTauri_source">
                                    <small>Embedding Provider</small>
                                </label>
                                <select id="VectTauri_source" class="vecttauri-select">
                                    <option value="transformers">Transformers (Local)</option>
                                    <option value="ollama">Ollama</option>
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="vllm">vLLM</option>
                                </select>

                                <!-- Provider-Specific Settings -->
                                <div id="VectTauri_provider_settings">

                                    <!-- Ollama Settings -->
                                    <div class="VectTauri_provider_setting" data-provider="ollama">
                                        <label class="checkbox_label">
                                            <input type="checkbox" id="VectTauri_ollama_use_alt_endpoint" />
                                            <span>Use Alternative Endpoint</span>
                                        </label>
                                        <input type="text" id="VectTauri_ollama_alt_endpoint_url" class="vecttauri-input" placeholder="http://127.0.0.1:11434" />
                                        <small class="VectTauri_hint">Override default Ollama API URL</small>
                                        <label for="VectTauri_ollama_model" style="margin-top: 8px;">
                                            <small>Ollama Model:</small>
                                        </label>
                                        <input type="text" id="VectTauri_ollama_model" class="vecttauri-input" placeholder="mxbai-embed-large" />
                                        <label class="checkbox_label" style="margin-top: 6px;">
                                            <input type="checkbox" id="VectTauri_ollama_keep" />
                                            <span>Keep Model in Memory</span>
                                        </label>
                                        <small class="VectTauri_hint">Enter the model name from your Ollama installation</small>
                                    </div>

                                    <!-- vLLM Settings -->
                                    <div class="VectTauri_provider_setting" data-provider="vllm">
                                        <label class="checkbox_label">
                                            <input type="checkbox" id="VectTauri_vllm_use_alt_endpoint" />
                                            <span>Use Alternative Endpoint</span>
                                        </label>
                                        <input type="text" id="VectTauri_vllm_alt_endpoint_url" class="vecttauri-input" placeholder="http://127.0.0.1:8000" />
                                        <small class="VectTauri_hint">Override default vLLM API URL</small>
                                        <label for="VectTauri_vllm_model" style="margin-top: 8px;">
                                            <small>vLLM Model:</small>
                                        </label>
                                        <input type="text" id="VectTauri_vllm_model" class="vecttauri-input" placeholder="Model name" />
                                        <small class="VectTauri_hint">Enter the model name from your vLLM deployment</small>
                                        <label for="VectTauri_vllm_api_key" style="margin-top: 8px;">
                                            <small>vLLM API Key (optional):</small>
                                        </label>
                                        <input type="password" id="VectTauri_vllm_api_key" class="vecttauri-input" placeholder="Leave blank for local / no-auth deployments" autocomplete="off" />
                                        <button type="button" id="VectTauri_vllm_api_key_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                                    </div>

                                    <!-- OpenRouter Model -->
                                    <div class="VectTauri_provider_setting" data-provider="openrouter">
                                        <label for="VectTauri_openrouter_model">
                                            <small>OpenRouter Model:</small>
                                        </label>
                                        <div style="display: flex; gap: 6px; align-items: stretch;">
                                            <input type="text" id="VectTauri_openrouter_model" class="vecttauri-input" style="flex: 1;" placeholder="openai/text-embedding-3-large" />
                                            <button id="VectTauri_openrouter_model_choose" class="menu_button" type="button" title="Browse OpenRouter's model list (filtered to embedding models)">
                                                <i class="fa-solid fa-list"></i> Choose
                                            </button>
                                        </div>
                                        <select id="VectTauri_openrouter_model_list" class="vecttauri-select" style="display:none; margin-top:6px;"></select>
                                        <small class="VectTauri_hint">Enter OpenRouter-compatible model ID, or click <b>Choose</b> to browse. List defaults to embedding models — toggle <i>Show all</i> if you need to pick a non-embedding one.</small>
                                        <label for="VectTauri_openrouter_apikey" style="margin-top: 8px;">
                                            <small>OpenRouter API Key:</small>
                                        </label>
                                        <input type="password" id="VectTauri_openrouter_apikey" class="vecttauri-input" placeholder="Paste key here to save..." autocomplete="off" />
                                        <button type="button" id="VectTauri_openrouter_apikey_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                                    </div>

                                </div>

                                <!-- Embedding API Rate Limiting -->
                                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--grey30);">
                                    <label>
                                        <small>Embedding API Rate Limiting (0 to disable)</small>
                                    </label>
                                    <div style="display: flex; gap: 10px;">
                                        <div style="flex: 1;">
                                            <label for="VectTauri_rate_limit_calls" style="display: block; margin-bottom: 4px;">
                                                <small>Max Calls</small>
                                            </label>
                                            <input type="number" id="VectTauri_rate_limit_calls" class="vecttauri-input" min="0" placeholder="5" />
                                        </div>
                                        <div style="flex: 1;">
                                            <label for="VectTauri_rate_limit_interval" style="display: block; margin-bottom: 4px;">
                                                <small>Interval (sec)</small>
                                            </label>
                                            <input type="number" id="VectTauri_rate_limit_interval" class="vecttauri-input" min="1" placeholder="60" />
                                        </div>
                                    </div>
                                    <small class="VectTauri_hint">Limit embedding API requests per time interval. Local Transformers, Ollama and llama.cpp are not limited.</small>
                                </div>

                                <!-- Summarizer / Agent Mode Rate Limiting -->
                                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--grey30);">
                                    <label>
                                        <small>Summarizer / Agent Mode Rate Limiting (0 to disable)</small>
                                    </label>
                                    <div style="display: flex; gap: 10px;">
                                        <div style="flex: 1;">
                                            <label for="VectTauri_generation_rate_limit_calls" style="display: block; margin-bottom: 4px;">
                                                <small>Max Calls</small>
                                            </label>
                                            <input type="number" id="VectTauri_generation_rate_limit_calls" class="vecttauri-input" min="0" placeholder="0" />
                                        </div>
                                        <div style="flex: 1;">
                                            <label for="VectTauri_generation_rate_limit_interval" style="display: block; margin-bottom: 4px;">
                                                <small>Interval (sec)</small>
                                            </label>
                                            <input type="number" id="VectTauri_generation_rate_limit_interval" class="vecttauri-input" min="1" placeholder="60" />
                                        </div>
                                    </div>
                                    <small class="VectTauri_hint">Throttle summarization (EventBase) and Agent Mode LLM calls (chat-completions) — separate from embeddings above. Prevents 429s when many windows extract at once. 0 = unlimited.</small>
                                </div>

                                <div class="vecttauri-form-group" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_vector_group_embedding_call">
                                        <input type="checkbox" id="VectTauri_vector_group_embedding_call" />
                                        <span>Group embedding calls</span>
                                    </label>
                                    <small class="VectTauri_hint">Default (checked): if unchecked, each item becomes its own embedding HTTP call, fired in parallel. One stuck upstream worker blocks only that item; the rest still succeed. More HTTP calls per batch. If checked, send all items in ONE batched call — cheaper (saves API call count) but less robust: ONE stuck item hangs the whole batch.</small>
                                </div>

                                <div class="vecttauri-form-group" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_vector_hedge_enabled">
                                        <input type="checkbox" id="VectTauri_vector_hedge_enabled" />
                                        <span>Hedge slow embedding calls</span>
                                    </label>
                                    <small class="VectTauri_hint">Default (checked): when an embedding HTTP call hasn't returned within 15 seconds, fire a duplicate request on a fresh connection. Whichever returns first wins. Cuts routing-stall recovery from 120s (ST's timeout) to under 20s when the upstream gateway fails. Applies only to OpenRouter and vLLM.</small>
                                </div>
                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 3: LLM / EventBase Extraction                   -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon">
                                            <i class="fa-solid fa-file-lines"></i>
                                        </span>
                                        LLM Summarization &amp; EventBase Extraction
                                    </h3>
                                    <p class="vecttauri-card-subtitle">LLM for EventBase event extraction</p>
                                </div>

                                <label for="VectTauri_summarize_provider">
                                    <small>Summarization Provider</small>
                                </label>
                                <select id="VectTauri_summarize_provider" class="vecttauri-select">
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="vllm">vLLM</option>
                                    <option value="custom">Custom (OpenAI-compatible)</option>
                                </select>
                                <small class="VectTauri_hint">Provider required for summarization / EventBase extraction LLM calls. "Custom" targets any OpenAI-compatible /v1/chat/completions endpoint (OpenAI, Gemini via proxy, LiteLLM, siliconflow, etc.)</small>

                                <div id="VectTauri_summarize_settings" style="display:none; margin-top:12px;">

                                    <div id="VectTauri_summarize_openrouter_row" style="display:none; margin-bottom:10px;">
                                        <label for="VectTauri_summarize_openrouter_apikey">
                                            <small>OpenRouter API Key</small>
                                        </label>
                                        <input type="password" id="VectTauri_summarize_openrouter_apikey" class="vecttauri-input"
                                            placeholder="Paste key here to save..." autocomplete="off" />
                                        <button type="button" id="VectTauri_summarize_openrouter_apikey_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                                        <small class="VectTauri_hint">Stored in VectTauri settings (separate from the embedding key)</small>
                                    </div>

                                    <div id="VectTauri_summarize_vllm_url_row" style="display:none; margin-bottom:10px;">
                                        <label for="VectTauri_summarize_vllm_url">
                                            <small>Base URL (vLLM / Custom OpenAI-compatible)</small>
                                        </label>
                                        <input type="text" id="VectTauri_summarize_vllm_url" class="vecttauri-input"
                                            placeholder="http://127.0.0.1:8000/v1" />
                                        <small class="VectTauri_hint">OpenAI-compatible base URL — include /v1 (e.g. http://127.0.0.1:8000/v1, https://api.example.com/v1)</small>
                                        <label for="VectTauri_summarize_vllm_apikey" style="margin-top:8px;">
                                            <small>API Key <span style="opacity:0.6;">(optional — leave blank if not required)</span></small>
                                        </label>
                                        <input type="password" id="VectTauri_summarize_vllm_apikey" class="vecttauri-input"
                                            placeholder="Paste key here to save..." autocomplete="off" />
                                        <button type="button" id="VectTauri_summarize_vllm_apikey_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                                    </div>

                                    <label for="VectTauri_summarize_model">
                                        <small>Summarization / EventBase Model</small>
                                    </label>
                                    <div style="display: flex; gap: 6px; align-items: stretch;">
                                        <input type="text" id="VectTauri_summarize_model" class="vecttauri-input" style="flex: 1;"
                                            placeholder="e.g. google/gemini-flash-1.5-8b" />
                                        <button id="VectTauri_summarize_model_choose" class="menu_button" type="button" title="Fetch available models from the configured provider">
                                            <i class="fa-solid fa-list"></i> Choose
                                        </button>
                                    </div>
                                    <select id="VectTauri_summarize_model_list" class="vecttauri-select" style="display:none; margin-top:6px;"></select>
                                    <small class="VectTauri_hint">Model ID used for EventBase extraction (separate from embedding model). Required. Click <b>Choose</b> to browse the provider's model list.</small>

                                </div>

                                <div class="vecttauri-form-group" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_should_send_temperature">
                                        <input type="checkbox" id="VectTauri_should_send_temperature" />
                                        <span>Send temperature</span>
                                    </label>
                                    <small class="VectTauri_hint">Default (checked). Uncheck for reasoning models (gpt-5.x, o1/o3/o4 and hosted builds on them), which accept only their own default temperature and reject anything else with <i>"Unsupported value: 'temperature' does not support 0.2 with this model"</i>. Unchecked = the parameter is left out of the request; the model's default applies. Affects every LLM call: summarization, EventBase, Auto-Reformat, Agent Mode.</small>
                                </div>

                                <div class="vecttauri-form-group" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_should_use_max_completion_tokens">
                                        <input type="checkbox" id="VectTauri_should_use_max_completion_tokens" />
                                        <span>Use max_completion_tokens</span>
                                    </label>
                                    <small class="VectTauri_hint">Default (unchecked) sends the classic <code>max_tokens</code>. Check it for the same reasoning models, which reject that key with <i>"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead"</i>. The token limit itself is unchanged — only the parameter name. Affects every LLM call.</small>
                                </div>

                                <div class="vecttauri-form-group" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_should_disable_thinking">
                                        <input type="checkbox" id="VectTauri_should_disable_thinking" />
                                        <span>Turn off model thinking</span>
                                    </label>
                                    <small class="VectTauri_hint">Default (checked) sends <code>reasoning_effort: "none"</code>, so a reasoning model answers without thinking first — much faster, and it can't spend the whole token limit thinking and return nothing. <b>Uncheck this if your model returns <i>"Bad Request"</i> on every call</b> — newer Gemini (3.5-flash-lite, 3.5-flash, 3.8-flash) cannot have thinking switched off and rejects <code>"none"</code> outright. Unchecked sends <code>reasoning_effort: "minimal"</code> instead, which those models accept and which still keeps thinking out of the output budget. Affects every LLM call.</small>
                                </div>
                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 4: Retrieval                                     -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-magnifying-glass"></i></span>
                                        Retrieval
                                    </h3>
                                    <p class="vecttauri-card-subtitle">Shared retrieval settings (EventBase + ChunkBase)</p>
                                </div>

                                <label for="VectTauri_query_depth" style="margin-top: 4px;">
                                    <small>Query Depth: <span id="VectTauri_query_depth_value">2</span> messages</small>
                                </label>
                                <input type="range" id="VectTauri_query_depth" class="vecttauri-slider" min="1" max="20" step="1" />
                                <small class="VectTauri_hint">How many recent messages to include in the search query</small>

                                <label for="VectTauri_min_chat_length" style="margin-top: 12px;">
                                    <small>Minimum Messages Before Injection</small>
                                </label>
                                <input type="number" id="VectTauri_min_chat_length" class="vecttauri-input" min="0" max="100" step="1" placeholder="0" />
                                <small class="VectTauri_hint">Minimum number of messages in chat before RAG injection starts (0 = inject immediately)</small>

                                <label for="VectTauri_deduplication_depth" style="margin-top: 12px;">
                                    <small>Skip Already-Visible Events: <span id="VectTauri_deduplication_depth_value">0</span> messages</small>
                                </label>
                                <input type="range" id="VectTauri_deduplication_depth" class="vecttauri-slider" min="0" max="500" step="10" />
                                <small class="VectTauri_hint">Drop candidate events whose source window is in the last N messages of the chat (assumption: the LLM can already see them in raw context). <b>0 = OFF (recommended)</b> — never skip on this basis. Real raw-context visibility is usually only ~3-6 messages (depends on context budget), so larger values tend to over-filter. Independent from "Dedup Window Gap" below, which is about removing near-duplicate events from the candidate pool.</small>

                                <label for="VectTauri_eventbase_dedup_window_gap" style="margin-top: 12px;">
                                    <small>Dedup Window Gap: <span id="VectTauri_eventbase_dedup_window_gap_val">10</span> messages</small>
                                </label>
                                <input type="range" id="VectTauri_eventbase_dedup_window_gap" class="vecttauri-slider" min="0" max="200" step="1" />
                                <small class="VectTauri_hint">EventBase only. Minimum source-window distance at which two same-type/same-cast events are considered <b>distinct</b> (kept). <b>0 = OFF</b> (no temporal-proximity dedup; even same-window duplicates kept). <b>1</b> = only same-window duplicates suppressed. <b>10</b> (default) = events within 9 messages dedup'd; 10+ apart kept. Higher = more aggressive dedup.</small>

                                <label for="VectTauri_eventbase_anchor_boost" style="margin-top: 12px;">
                                    <small>Anchor Boost: <span id="VectTauri_eventbase_anchor_boost_val">0.20</span></small>
                                </label>
                                <input type="range" id="VectTauri_eventbase_anchor_boost" class="vecttauri-slider" min="0" max="0.5" step="0.05" />
                                <small class="VectTauri_hint">EventBase only. Flat additive bonus when an event's stored keyword appears verbatim in your last message. Rescues historically-distant events the user explicitly asks about. 0 = disabled. Range 0.00-0.50, default 0.20.</small>

                                <div id="VectTauri_eventbase_native_rerank_wrapper" style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_eventbase_native_rerank">
                                        <input id="VectTauri_eventbase_native_rerank" type="checkbox" />
                                        <span>Push EventBase re-rank to Qdrant</span>
                                    </label>
                                    <small class="VectTauri_hint">A3 (Qdrant) only. Computes importance/persist/recency weighted scoring inside Qdrant via a formula query, in the same /query call as the dense+sparse hybrid. Anchor boost and pairwise dedup still run locally. Requires Qdrant 1.13+; falls back gracefully when unavailable. Re-tune the cosine weight if recall changes — see plans/qdrant-native-eventbase-rerank-formula.md.</small>
                                </div>

                                <label for="VectTauri_retrieval_timeout_ms" style="margin-top: 12px;">
                                    <small>Retrieval Timeout (ms)</small>
                                </label>
                                <input type="number" id="VectTauri_retrieval_timeout_ms" class="vecttauri-input" min="${RETRIEVAL_TIMEOUT_MIN_MS}" max="${RETRIEVAL_TIMEOUT_MAX_MS}" step="1000" />
                                <small class="VectTauri_hint">How long one turn may wait for a lookup — EventBase, chunks, lorebook and summarizer injection alike — before the message sends <b>without</b> that memory. Default <b>${RETRIEVAL_TIMEOUT_DEFAULT_MS} ms (${RETRIEVAL_TIMEOUT_DEFAULT_MS / 1000}s)</b>, range ${RETRIEVAL_TIMEOUT_MIN_MS / 1000}–${RETRIEVAL_TIMEOUT_MAX_MS / 1000}s. Raise it if you see "retrieval timed out" on a provider you know is just slow rather than broken. Cost of raising it: a genuinely hung provider stalls your turn for that much longer. <b>Agent Mode is already accounted for</b> — its planner and per-query timeouts are added on top of this, so you do not need to inflate this value for it.</small>

                                <div style="margin-top: 12px;">
                                    <label class="checkbox_label" for="VectTauri_retrieval_popup_on_start">
                                        <input id="VectTauri_retrieval_popup_on_start" type="checkbox" />
                                        <span>Popup: show when backend retrieval starts</span>
                                    </label>
                                    <label class="checkbox_label" for="VectTauri_retrieval_popup_on_result" style="margin-top: 6px; display: flex;">
                                        <input id="VectTauri_retrieval_popup_on_result" type="checkbox" />
                                        <span>Popup: show retrieved result count</span>
                                    </label>
                                </div>
                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 5: Injection                                     -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-arrow-right-to-bracket"></i></span>
                                        Injection
                                    </h3>
                                    <p class="vecttauri-card-subtitle">Prompt injection position</p>
                                </div>

                                <label style="margin-top: 4px;">
                                    <small>Injection Position</small>
                                </label>
                                <select id="VectTauri_injection_position" class="vecttauri-select">
                                    <option value="2">Before Main Prompt</option>
                                    <option value="0">After Main Prompt</option>
                                    <option value="1">In-Chat @ Depth</option>
                                </select>
                                <small class="VectTauri_hint">Where every VectTauri block goes — memory, summarizer and lorebook. Their text changes every turn: Before/After Main Prompt puts it near the top of the prompt, so the provider's prompt cache can't reuse anything after it. <strong>In-Chat</strong> keeps everything above the chat history cacheable.</small>

                                <div id="VectTauri_injection_depth_row" style="margin-top: 12px; display: none;">
                                    <label for="VectTauri_injection_depth">
                                        <small>Injection Depth: <span id="VectTauri_injection_depth_value">2</span></small>
                                    </label>
                                    <input type="range" id="VectTauri_injection_depth" class="vecttauri-slider" min="0" max="50" step="1" />
                                    <small class="VectTauri_hint">Messages from end of chat to insert at</small>
                                </div>
                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 6: Hybrid Search & BM25                          -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-bolt"></i></span>
                                        Hybrid Search &amp; BM25
                                    </h3>
                                    <p class="vecttauri-card-subtitle">Keyword scoring and result fusion</p>
                                </div>

                                <!-- Keyword Scoring Method (hidden when native hybrid active) -->
                                <div id="VectTauri_keyword_method_section" style="margin-top: 8px;">
                                    <label>
                                        <small>Keyword Scoring Method</small>
                                    </label>
                                    <select id="VectTauri_keyword_scoring_method" class="vecttauri-select">
                                        <option value="bm25">BM25 (fast re-rank of top-K)</option>
                                        <option value="hybrid">Hybrid (vector candidates + BM25 fusion)</option>
                                    </select>
                                    <small class="VectTauri_hint">BM25 re-ranks the vector top-K candidates. Hybrid expands the vector candidate window, scores those candidates with BM25, then fuses both signals. It is broader than BM25 mode, but not a true full-corpus keyword scan.</small>
                                </div>

                                <!-- Shown instead of above when native hybrid (A3) is active -->
                                <div id="VectTauri_native_hybrid_info" style="display: none; margin-top: 16px;">
                                    <small class="VectTauri_hint"><i class="fa-solid fa-bolt"></i> Native Qdrant hybrid active: dense ANN + sparse BM25 (global IDF) fused server-side via RRF. The CJK Tokenizer Mode below is locked into each collection at upsert.</small>
                                </div>

                                <!-- BM25 Parameters (visible when client-side BM25 logic runs — A1 or A2) -->
                                <div id="VectTauri_bm25_params" style="margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.1); border-radius: 8px;">
                                    <label for="VectTauri_bm25_k1">
                                        <small>BM25 k1 (TF saturation): <span id="VectTauri_bm25_k1_value">1.5</span></small>
                                    </label>
                                    <input type="range" id="VectTauri_bm25_k1" class="vecttauri-slider" min="0.5" max="3.0" step="0.1" />
                                    <small class="VectTauri_hint">Controls term frequency saturation (1.2-2.0 typical)</small>

                                    <label for="VectTauri_bm25_b" style="margin-top: 8px;">
                                        <small>BM25 b (Length norm): <span id="VectTauri_bm25_b_value">0.75</span></small>
                                    </label>
                                    <input type="range" id="VectTauri_bm25_b" class="vecttauri-slider" min="0" max="1" step="0.05" />
                                    <small class="VectTauri_hint">Controls document length normalization (0.75 typical)</small>

                                    <label class="checkbox_label" style="margin-top: 12px;">
                                        <input type="checkbox" id="VectTauri_bm25_use_corpus_idf" />
                                        <span>Corpus-wide IDF for BM25 scoring &nbsp;<small style="opacity:0.7;">(recommended — default ON)</small></span>
                                    </label>
                                    <small class="VectTauri_hint">
                                        <strong>What it does:</strong> Makes BM25 use rarity statistics (IDF weights) computed over <em>every</em> chunk in the collection, so rare keywords keep their discriminative power. Builds once per session per collection and caches in memory. <br><br>
                                        <strong>What it does NOT do:</strong> It does <em>not</em> search the full corpus. BM25 still only scores the candidates the vector layer surfaced — this just gives those candidates better <em>scoring weights</em>, not more candidates. For true full-corpus retrieval, switch to the Qdrant backend (A3 path). Disable if comptuer slow down.<br><br>
                                    </small>
                                </div>

                                <!-- Hybrid Search params (visible in A2 hybrid mode and A3 native) -->
                                <div style="margin-top: 16px; padding: 12px; background: rgba(0,100,200,0.1); border-radius: 8px; border: 1px solid rgba(0,100,200,0.2);">
                                    <div id="VectTauri_hybrid_params" style="margin-top: 4px;">
                                        <label style="margin-top: 8px;">
                                            <small>Fusion Method</small>
                                        </label>
                                        <select id="VectTauri_hybrid_fusion_method" class="vecttauri-select">
                                            <option value="rrf">RRF (Reciprocal Rank Fusion)</option>
                                            <option value="weighted">Weighted Linear Combination</option>
                                        </select>
                                        <small class="VectTauri_hint">RRF is parameter-free and robust; Weighted allows fine-tuning</small>

                                        <div id="VectTauri_hybrid_weights" style="display: none; margin-top: 12px;">
                                            <label for="VectTauri_hybrid_vector_weight">
                                                <small>Vector Weight: <span id="VectTauri_hybrid_vector_weight_value">0.5</span></small>
                                            </label>
                                            <input type="range" id="VectTauri_hybrid_vector_weight" class="vecttauri-slider" min="0" max="1" step="0.1" />

                                            <label for="VectTauri_hybrid_text_weight" style="margin-top: 8px;">
                                                <small>Text Weight: <span id="VectTauri_hybrid_text_weight_value">0.5</span></small>
                                            </label>
                                            <input type="range" id="VectTauri_hybrid_text_weight" class="vecttauri-slider" min="0" max="1" step="0.1" />
                                        </div>

                                        <div id="VectTauri_hybrid_rrf_settings" style="margin-top: 12px;">
                                            <label for="VectTauri_hybrid_rrf_k">
                                                <small>RRF K Constant: <span id="VectTauri_hybrid_rrf_k_value">60</span></small>
                                            </label>
                                            <input type="range" id="VectTauri_hybrid_rrf_k" class="vecttauri-slider" min="1" max="100" step="1" />
                                            <small class="VectTauri_hint">Higher K = more weight to top-ranked results (60 is typical)</small>
                                        </div>
                                    </div>
                                </div>

                            </div>

                            <!-- ═══════════════════════════════════════════════════════ -->
                            <!-- GROUP 7: Keyword Extraction                            -->
                            <!-- ═══════════════════════════════════════════════════════ -->
                            <div class="vecttauri-subsection" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grey30);">
                                <div class="vecttauri-card-header" style="padding: 0 0 8px 0;">
                                    <h3 class="vecttauri-card-title" style="font-size: 0.95em;">
                                        <span class="vecttauri-icon"><i class="fa-solid fa-tags"></i></span>
                                        Keyword Extraction
                                    </h3>
                                    <p class="vecttauri-card-subtitle">CJK tokenizer and stopwords for BM25</p>
                                </div>

                                <label for="VectTauri_cjk_tokenizer_mode">
                                    <small><b>CJK Tokenizer Mode</b></small>
                                </label>
                                <select id="VectTauri_cjk_tokenizer_mode" class="vecttauri-select" style="margin-top: 4px;">
                                    ${LANGUAGE_MODES.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
                                </select>
                                <small class="VectTauri_hint">Default mode uses Intl.Segmenter — supports Korean, Chinese, and any Latin-script language (English, French, etc.) with no extra downloads. Jieba WASM loads only when selected. Traditional Chinese also downloads a TW dictionary (~2–5 MB, one-time). TinySegmenter is used for kana-containing Japanese text.</small>
                            </div>

                            <div style="margin-top: 12px; padding: 12px; background: rgba(100,100,100,0.1); border-radius: 8px;">
                                <label for="VectTauri_custom_stopwords">
                                    <small><b>Custom Stopwords</b></small>
                                </label>
                                <textarea id="VectTauri_custom_stopwords" class="vecttauri-textarea" rows="2"
                                    placeholder="{{char}}, {{user}}, character, scene, location..."
                                    style="margin-top: 4px;"></textarea>
                                <small class="VectTauri_hint">Words to exclude from keyword extraction. Supports ST macros: {{char}}, {{user}}, {{charIfNotGroup}}, etc.</small>
                            </div>

                        </div>
                    </div>

                    <!-- ChunkBase Settings Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="weight">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon">
                                    <i class="fa-solid fa-layer-group"></i>
                                </span>
                                ChunkBase Settings
                            </h3>
                            <p class="vecttauri-card-subtitle">Settings on this tab apply to chunk-based content: <b>Lorebook / World Info</b>, <b>Character Cards</b>, <b>URLs / web pages</b>, <b>custom documents</b>, <b>wiki pages</b>, and <b>YouTube transcripts</b>. Chat history is handled separately under EventBase.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <!-- Ingestion -->
                            <p class="vecttauri-section-label" style="font-weight:600; margin-bottom:8px;">Ingestion</p>
                            <label for="VectTauri_insert_batch_size">
                                <small>Insert Batch Size: <span id="VectTauri_insert_batch_size_value">50</span></small>
                            </label>
                            <input type="range" id="VectTauri_insert_batch_size" class="vecttauri-slider" min="10" max="100" step="10" />
                            <small class="VectTauri_hint">Chunks per insert batch (50-100 recommended for faster bulk operations). Local Transformers, Ollama and llama.cpp always send one chunk per request.</small>

                            <label class="checkbox_label" for="VectTauri_document_glossary_injection" style="margin-top:12px;">
                                <input type="checkbox" id="VectTauri_document_glossary_injection" />
                                <span>Acronym Glossary Injection (Documents)</span>
                            </label>
                            <small class="VectTauri_hint">When vectorizing a <b>Document</b>, scan it once for "Full Name (ACRONYM)" definitions and prepend the matching definition to any chunk that references the bare acronym without it. Fixes retrieval handing the model an ungrounded acronym it then has to guess at.</small>

                            <!-- Auto-Reformat (LLM) -->
                            <p class="vecttauri-section-label" style="font-weight:600; margin-top:16px; margin-bottom:8px;">Auto-Reformat (LLM)</p>
                            <small class="VectTauri_hint" style="display:block; margin-bottom:8px;">
                                Optional, per-item LLM pass offered in <b>Vectorize Content</b> for Document/URL/Wiki sources. Reads the source, splits it into clean per-entity/per-topic entries, and uses those as the final chunks — you review and accept every entry before anything is stored. Leave Provider/Model blank to inherit from <b>Summarize Before Store</b> settings.
                            </small>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_reformat_provider"><small>Provider</small></label>
                                <select id="VectTauri_reformat_provider" class="vecttauri-select">
                                    <option value="">(Inherit from summarizer)</option>
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="vllm">vLLM</option>
                                </select>
                            </div>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_reformat_model"><small>Model</small></label>
                                <input type="text" id="VectTauri_reformat_model" class="vecttauri-input"
                                    placeholder="(empty → inherit summarizer model)" />
                            </div>

                            <div class="vecttauri-form-group" id="VectTauri_reformat_vllm_row" style="display:none;">
                                <label for="VectTauri_reformat_vllm_url"><small>vLLM Base URL</small></label>
                                <input type="text" id="VectTauri_reformat_vllm_url" class="vecttauri-input"
                                    placeholder="(empty → inherit summarize URL)" />
                                <small class="VectTauri_hint">API key is shared with Embedding/Summarize/AgentMode — set it in Core → LLM Summarization.</small>
                            </div>

                            <label for="VectTauri_reformat_batch_chars">
                                <small>Batch Size: <span id="VectTauri_reformat_batch_chars_val">6000</span> chars</small>
                            </label>
                            <input type="range" id="VectTauri_reformat_batch_chars" class="vecttauri-slider" min="2000" max="12000" step="500" />
                            <small class="VectTauri_hint">Target input size per LLM call. Long documents are split into multiple batches at header boundaries; lower this if a section is so dense the model truncates its output.</small>

                            <label for="VectTauri_reformat_max_body_chars" style="margin-top:10px; display:block;">
                                <small>Max Entry Size: <span id="VectTauri_reformat_max_body_chars_val">2000</span> chars</small>
                            </label>
                            <input type="range" id="VectTauri_reformat_max_body_chars" class="vecttauri-slider" min="500" max="5000" step="250" />
                            <small class="VectTauri_hint">Entries longer than this are sub-chunked with the same adaptive splitter used elsewhere, so one oversized entity doesn't become one giant chunk.</small>

                            <label for="VectTauri_reformat_name_fuzzy_threshold" style="margin-top:10px; display:block;">
                                <small>Hallucination Guard Sensitivity: <span id="VectTauri_reformat_name_fuzzy_threshold_val">0.8</span></small>
                            </label>
                            <input type="range" id="VectTauri_reformat_name_fuzzy_threshold" class="vecttauri-slider" min="0.5" max="1" step="0.05" />
                            <small class="VectTauri_hint">Minimum name-match confidence before the review screen flags an entry as possibly invented by the model. Higher = stricter (more flags, some false positives on close paraphrases).</small>

                            <label for="VectTauri_reformat_concurrency" style="margin-top:10px; display:block;">
                                <small>Parallel Batches: <span id="VectTauri_reformat_concurrency_val">2</span></small>
                            </label>
                            <input type="range" id="VectTauri_reformat_concurrency" class="vecttauri-slider" min="1" max="6" step="1" />
                            <small class="VectTauri_hint">How many LLM calls run at once when a document needs multiple batches.</small>

                            <label for="VectTauri_reformat_timeout_ms" style="margin-top:10px; display:block;">
                                <small>Timeout (ms)</small>
                            </label>
                            <input id="VectTauri_reformat_timeout_ms" type="number" class="vecttauri-input" min="10000" step="1000" style="width:140px;" />

                            <label for="VectTauri_reformat_custom_prompt" style="margin-top:10px; display:block;">
                                <small>Custom Extraction Prompt (advanced)</small>
                            </label>
                            <textarea id="VectTauri_reformat_custom_prompt" class="vecttauri-input" rows="3"
                                placeholder="Leave blank to use the built-in prompt. Must instruct the model to output a JSON array with entry_type/name/aliases/affiliation/traits/relationships/keywords/body fields."
                                style="margin-top:4px;"></textarea>

                            <!-- Query (ChunkBase-only) -->
                            <p class="vecttauri-section-label" style="font-weight:600; margin-top:16px; margin-bottom:8px;">Query</p>
                            <div style="margin-top:4px; display:flex; gap:8px; align-items:center;">
                                <label for="VectTauri_topk" style="margin:0; white-space:nowrap;"><small>Top K</small></label>
                                <input id="VectTauri_topk" type="number" class="vecttauri-input" min="1" style="width:90px;" />
                                <small class="VectTauri_hint" style="margin-left:8px;">Up to this many results per collection (may be fewer after filtering/dedup)</small>
                            </div>

                            <!-- Retrieval Gating (ChunkBase-only) -->
                            <p class="vecttauri-section-label" style="font-weight:600; margin-top:16px; margin-bottom:8px;">Retrieval Gating</p>
                            <label for="VectTauri_score_threshold" style="margin-top:12px;">
                                <small>Similarity Threshold: <span id="VectTauri_threshold_value">0.25</span></small>
                            </label>
                            <input type="range" id="VectTauri_score_threshold" class="vecttauri-slider" min="0" max="1" step="0.05" />
                            <small class="VectTauri_hint">Minimum relevance score for retrieval</small>

                            <!-- Keyword Budget (chunk-only; visible only in A1 Standard+BM25 mode) -->
                            <p class="vecttauri-section-label" style="font-weight:600; margin-top:16px; margin-bottom:8px;">Keyword Budget</p>
                            <small class="VectTauri_hint" style="display: block; margin-bottom: 8px;">
                                Chunk-path-only setting. Other hybrid/BM25 knobs live under <b>Core → Hybrid Search &amp; BM25</b>.
                            </small>
                            <div id="VectTauri_hybrid_keyword_budget_wrapper" style="margin-top: 8px;">
                                <label>
                                    <small>Query Keyword Budget</small>
                                </label>
                                <select id="VectTauri_hybrid_keyword_level" class="vecttauri-select">
                                    <option value="minimal">30</option>
                                    <option value="balance">50</option>
                                    <option value="maximum">70</option>
                                </select>
                                <small class="VectTauri_hint">Max keywords extracted from your query for BM25 scoring (CJK priority; +10 English overflow when CJK fills budget). Used only when Standard backend + BM25 mode is active.</small>
                            </div>

                        </div>
                    </div>

                    <!-- RAG Context Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="rag">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon">
                                    <i class="fa-solid fa-quote-left"></i>
                                </span>
                                RAG Context
                            </h3>
                            <p class="vecttauri-card-subtitle">Retrieval-Augmented Generation injection settings — XML tag wrapping, prompt template, injection depth and position. Applies to retrieved results from any path.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <label for="VectTauri_rag_context">
                                <small>Global Context Prompt</small>
                            </label>
                            <textarea id="VectTauri_rag_context" class="vecttauri-textarea" rows="3" placeholder="e.g., The following information may be relevant to your conversation with {{user}}:"></textarea>
                            <small class="VectTauri_hint">Shown before all RAG content. Supports {{user}} and {{char}} variables.</small>

                            <label for="VectTauri_rag_xml_tag" style="margin-top: 12px;">
                                <small>Global XML Tag (optional)</small>
                            </label>
                            <input type="text" id="VectTauri_rag_xml_tag" class="vecttauri-input" placeholder="e.g., retrieved_context" />
                            <small class="VectTauri_hint">Wraps all RAG content in &lt;tag&gt;...&lt;/tag&gt;. Leave empty for no wrapping.</small>

                            <div class="VectTauri_info" style="margin-top: 16px; padding: 8px 12px; border-radius: 4px; background: var(--SmartThemeBlurTintColor); font-size: 0.85em;">
                                <i class="fa-solid fa-info-circle"></i>
                                <span>Collection and chunk-level context can be set in the Database Browser and Chunk Visualizer respectively.</span>
                            </div>

                        </div>
                        </div>

                        <!-- World Info Settings Card -->
                        <div class="vecttauri-card" data-vecttauri-tab="worldinfo">
                            <div class="vecttauri-card-header">
                                <h3 class="vecttauri-card-title">
                                    <span class="vecttauri-icon">
                                        <i class="fa-solid fa-globe"></i>
                                    </span>
                                    World Info settings
                                </h3>
                                <p class="vecttauri-card-subtitle">Semantic World Info / Lorebook activation — uses vector similarity instead of keyword matching to decide which entries to inject. Operates on chunk-based lorebook collections.</p>
                            </div>
                            <div class="vecttauri-card-body">
                                <label class="checkbox_label" for="VectTauri_enabled_world_info">
                                    <input id="VectTauri_enabled_world_info" type="checkbox" class="checkbox">
                                    <span>Enable Semantic WI Activation</span>
                                </label>
                                <small class="VectTauri_hint">Activates lorebook entries based on meaning, not just keywords — so relevant lore shows up even when the exact words aren't mentioned.</small>
                                <div id="VectTauri_wi_status" style="margin-top: 6px; font-size: 0.82em;"></div>

                                <div id="VectTauri_world_info_settings" style="margin-top:10px; display:none;">
                                    <small style="display:block; margin-bottom:8px; opacity:0.85;">
                                        Activates World Info entries from <strong>vectorized lorebooks</strong> based on semantic similarity to recent chat messages. Complements keyword-based activation.
                                    </small>

                                    <div style="display:flex; gap:12px;">
                                        <div style="flex:1;">
                                            <label for="VectTauri_world_info_threshold"><small>Score Threshold</small></label>
                                            <input id="VectTauri_world_info_threshold" type="number" class="vecttauri-input" min="0" max="1" step="0.01" />
                                        </div>
                                        <div style="flex:1;">
                                            <label for="VectTauri_world_info_top_k"><small>Top-K per Lorebook</small></label>
                                            <input id="VectTauri_world_info_top_k" type="number" class="vecttauri-input" min="1" max="20" />
                                        </div>
                                        <div style="flex:1;">
                                            <label for="VectTauri_world_info_query_depth"><small>Query Depth</small></label>
                                            <input id="VectTauri_world_info_query_depth" type="number" class="vecttauri-input" min="1" max="10" />
                                        </div>
                                    </div>

                                    <div style="margin-top:10px;">
                                        <label for="VectTauri_wi_test_input"><small>Test Messages (one per line)</small></label>
                                        <textarea id="VectTauri_wi_test_input" class="vecttauri-textarea" rows="3" placeholder="Enter test messages, one per line..."></textarea>
                                        <div style="display:flex; gap:8px; margin-top:8px;">
                                            <button id="VectTauri_wi_test_btn" class="vecttauri-btn-secondary">Test Semantic WI</button>
                                            <button id="VectTauri_wi_dump_registry" class="vecttauri-btn-secondary">Dump Registry</button>
                                            <button id="VectTauri_wi_apply_first" class="vecttauri-btn-primary">Apply First Semantic Hit</button>
                                        </div>
                                    </div>

                                    <div style="margin-top:10px; display:flex; gap:12px; align-items:center;">
                                        <label class="checkbox_label" for="VectTauri_enabled_for_all">
                                            <input id="VectTauri_enabled_for_all" type="checkbox" />
                                            <span>Enabled for all entries</span>
                                        </label>
                                        <div style="flex:1"></div>
                                        <div style="width:160px;">
                                            <label for="VectTauri_max_entries"><small>Max Entries</small></label>
                                            <input id="VectTauri_max_entries" type="number" class="vecttauri-input" min="1" max="9999" />
                                        </div>
                                    </div>

                                    <div class="vecttauri-form-group" style="margin-top:10px;">
                                        <label class="checkbox_label" for="VectTauri_world_info_retrieval_popup">
                                            <input type="checkbox" id="VectTauri_world_info_retrieval_popup" />
                                            <span>Popup: show when lorebook entries are retrieved</span>
                                        </label>
                                        <small class="VectTauri_hint">Show a notification toast each time semantic WI activation retrieves lorebook entries.</small>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Chat Auto-Sync Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="autosync">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon">
                                    <i class="fa-solid fa-comments"></i>
                                </span>
                                Chat Auto-Sync
                            </h3>
                            <p class="vecttauri-card-subtitle">Configure automatic synchronization between the active chat and its vector collection. Per-chat toggle, behavior on new messages, and conflict resolution.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <label class="checkbox_label" for="VectTauri_autosync_enabled">
                                <input type="checkbox" id="VectTauri_autosync_enabled" />
                                <span>Enable Auto-Sync</span>
                            </label>
                            <small id="VectTauri_autosync_hint" class="VectTauri_hint">Auto-Sync new messages (requires initial vectorization)</small>
                            <div id="VectTauri_autosync_status" style="margin-top: 6px; font-size: 0.82em;"></div>

                            <div class="vecttauri-form-group" style="margin-top: 12px;">
                                <label class="vecttauri-label">
                                    Auto-sync window: <span id="VectTauri_eventbase_autosync_window_turns_val">1</span> turn(s)
                                    <span class="VectTauri_hint" id="VectTauri_autosync_window_msg_equiv" style="margin-left:4px;">(= 2 messages)</span>
                                </label>
                                <input type="range" id="VectTauri_eventbase_autosync_window_turns" min="1" max="20" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">Independent of the EventBase "Window Size". 1 turn = 2 messages (1 user + 1 AI reply). Auto-sync extracts a window every this-many turns of new chat.</small>
                            </div>

                            <!-- Summarizer Injection (Feature B). Whole group hidden on standard+no-plugin. -->
                            <div class="vecttauri-form-group" id="VectTauri_summarizer_injection_group" style="margin-top: 12px;">
                                <label class="checkbox_label" for="VectTauri_summarizer_injection_enabled">
                                    <input type="checkbox" id="VectTauri_summarizer_injection_enabled" />
                                    <span>Summarizer Injection</span>
                                </label>
                                <small class="VectTauri_hint">Inject the most recent N EventBase summaries into the prompt every turn (wrapped in &lt;VectTauriSummarizer&gt; tags), in addition to semantic retrieval. Enables word-for-word-ish memory of the last few turns. <strong>Turns on auto-sync and forces its window to 1 turn while on</strong> (so the latest reply is always extracted before the next injection).</small>
                                <div class="vecttauri-form-group" id="VectTauri_summarizer_injection_count_group" style="margin-top: 8px;">
                                    <label class="vecttauri-label">Inject last <span id="VectTauri_summarizer_injection_count_val">20</span> turn(s)</label>
                                    <input type="range" id="VectTauri_summarizer_injection_count" min="1" max="50" step="1" class="vecttauri-slider" />
                                </div>
                                <label class="checkbox_label" for="VectTauri_summarizer_injection_full_detail" style="margin-top: 8px;">
                                    <input type="checkbox" id="VectTauri_summarizer_injection_full_detail" />
                                    <span>Include full event detail</span>
                                </label>
                                <small class="VectTauri_hint">Add each event's structured fields (cause, result, characters, locations, items, time, concepts, keywords, open threads, message index) beneath its summary. Off = summary only.</small>
                                <label for="VectTauri_summarizer_injection_max_chars" style="margin-top: 8px; display:block;"><small>Max injection size (characters, 0 = no cap)</small></label>
                                <input type="number" id="VectTauri_summarizer_injection_max_chars" class="vecttauri-input" min="0" max="100000" step="500" />
                                <small class="VectTauri_hint">Safety cap on the whole &lt;VectTauriSummarizer&gt; block. If the events exceed it, the OLDEST are dropped (newest always kept) — prevents a huge injection from overflowing the model's context.</small>

                                <!-- Ghosting: wipe oldest N vectorized messages from the OUTGOING prompt only. -->
                                <div class="vecttauri-form-group" id="VectTauri_eventbase_ghost_group" style="margin-top: 12px; border-top: 1px dashed var(--SmartThemeBorderColor); padding-top: 10px;">
                                    <label class="checkbox_label" for="VectTauri_eventbase_ghost_enabled">
                                        <input type="checkbox" id="VectTauri_eventbase_ghost_enabled" />
                                        <span>Ghost vectorized messages (token saver)</span>
                                    </label>
                                    <small class="VectTauri_hint">Keep the most recent messages raw and blank ALL older already-vectorized messages from the prompt sent to the AI. The chat UI and saved file are <strong>untouched</strong>, and it resets every turn. The wiped turns rely on EventBase memory (the injection above + semantic retrieval) instead of their raw text — so check your recall quality as you <strong>lower</strong> the slider. Scales to any chat length. Requires Summarizer Injection.</small>
                                    <div class="vecttauri-form-group" id="VectTauri_eventbase_ghost_keep_recent_group" style="margin-top: 8px;">
                                        <label class="vecttauri-label">Keep last <span id="VectTauri_eventbase_ghost_keep_recent_val">10</span> message(s) verbatim</label>
                                        <input type="range" id="VectTauri_eventbase_ghost_keep_recent" min="0" max="100" step="1" class="vecttauri-slider" />
                                        <small class="VectTauri_hint">Everything older than this that's been vectorized is wiped (never the recent un-synced tail). Lower = more aggressive (more tokens saved). Even at <strong>0</strong>, ghosting always keeps the current turn and your World Info scan window verbatim — so it never breaks keyword triggers and never sends an empty prompt. "<strong>0</strong>" means "wipe as much as is safe," not literally everything.</small>
                                    </div>
                                    <div id="VectTauri_eventbase_ghost_readout" class="VectTauri_hint" style="margin-top: 8px; display:block; padding: 6px 8px; border-radius: 6px; background: rgba(127,127,127,0.12);">Last turn: no generation yet.</div>
                                </div>
                            </div>

                            <!-- Collection lock moved to Database Browser (per-collection settings) -->

                            <div class="vecttauri-form-group" style="margin-top: 12px;">
                                <label class="checkbox_label" for="VectTauri_autosync_popup">
                                    <input type="checkbox" id="VectTauri_autosync_popup" />
                                    <span>Popup: show when auto-sync is extracting</span>
                                </label>
                                <small class="VectTauri_hint">Show a notification toast each time auto-sync triggers a new EventBase extraction window.</small>
                            </div>

                            <div class="vecttauri-form-group" style="margin-top: 8px;">
                                <label class="checkbox_label" for="VectTauri_autosync_show_progress_modal">
                                    <input type="checkbox" id="VectTauri_autosync_show_progress_modal" />
                                    <span>Show progress modal during auto-sync</span>
                                </label>
                                <small class="VectTauri_hint">When unchecked, auto-sync runs silently in the background without opening the progress popup. The Vectorizing Content page always shows the progress modal regardless.</small>
                            </div>

                            <small class="VectTauri_hint" style="display:block; margin-top: 8px;">
                                Chat Auto-Sync follows the EventBase extraction settings. Legacy chat chunking controls are hidden because chat history no longer uses the old chunk-based retrieval path.
                            </small>

                        </div>
                    </div>

                    <!-- Actions Card -->
                    <div class="vecttauri-card vecttauri-tab-active" data-vecttauri-tab="action">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon">
                                    <i class="fa-solid fa-bolt"></i>
                                </span>
                                Actions
                            </h3>
                            <p class="vecttauri-card-subtitle">Run vectorization, sync chat with collections, browse the database, and run diagnostics. Operates on whatever path is currently active (Chunk or EventBase).</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <div class="vecttauri-actions-grid">
                                <button id="VectTauri_vectorize_content" class="vecttauri-action-btn vecttauri-btn-primary vecttauri-action-featured">
                                    <i class="fa-solid fa-plus-circle"></i>
                                    <span>Vectorize Content</span>
                                </button>
                                <button id="VectTauri_vectorize_all" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-sync"></i>
                                    <span>Sync Chat</span>
                                </button>
                                <button id="VectTauri_database_browser" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-folder-open"></i>
                                    <span>Database Browser</span>
                                </button>
                                <button id="VectTauri_run_diagnostics" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-stethoscope"></i>
                                    <span>Diagnostics</span>
                                </button>
                                <button id="VectTauri_view_results" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-bug"></i>
                                    <span>Debug Query</span>
                                </button>
                                <button id="VectTauri_debug_summarizer" class="vecttauri-action-btn vecttauri-btn-secondary" title="Preview the exact <VectTauriSummarizer> block that would be injected into the prompt this turn (without injecting it).">
                                    <i class="fa-solid fa-eye"></i>
                                    <span>Debug Summarizer</span>
                                </button>
                                <button id="VectTauri_purge" class="vecttauri-action-btn vecttauri-btn-danger-outline">
                                    <i class="fa-solid fa-trash"></i>
                                    <span>Purge</span>
                                </button>
                                <button id="VectTauri_cleanup_corrupted" class="vecttauri-action-btn vecttauri-btn-danger-outline" title="Delete corrupted prefix-stacked collections and ST-native file_* attachments from disk. Irreversible.">
                                    <i class="fa-solid fa-broom"></i>
                                    <span>Cleanup Corrupted</span>
                                </button>
                                <button id="VectTauri_text_cleaning" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-broom"></i>
                                    <span>Text Cleaning</span>
                                </button>
                                <button id="VectTauri_reopen_progress" class="vecttauri-action-btn vecttauri-btn-secondary">
                                    <i class="fa-solid fa-chart-line"></i>
                                    <span>Progress</span>
                                </button>
                                ${getHealthIndicatorHtml()}
                            </div>

                            <label class="checkbox_label" for="VectTauri_debug_verbosity" style="margin-top: 20px; display:block;">
                                <span>Console verbosity</span>
                            </label>
                            <select id="VectTauri_debug_verbosity" class="text_pole" style="width: 100%; margin-top: 4px;">
                                <option value="off">Off — silence (default)</option>
                                <option value="lifecycle">Lifecycle — major events only (~50 lines / 100 windows)</option>
                                <option value="verbose">Verbose — + per-batch/window timing (~300 lines / 100 windows)</option>
                                <option value="trace">Trace — + per-item detail (~700 lines / 100 windows)</option>
                            </select>
                            <small class="VectTauri_hint">Single noise floor for all EventBase / vectorization / insert logging. Errors and warnings always log regardless. Replaces the old Debug Logging + Vectorizing toggles.</small>

                            <label class="checkbox_label" for="VectTauri_injection_debug_logging" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_injection_debug_logging" />
                                <span>Debug Injection Logging</span>
                            </label>
                            <small class="VectTauri_hint">Log injection details (ChunkBase + EventBase) to the browser console (useful for diagnosing retrieval/injection issues)</small>

                            <label class="checkbox_label" for="VectTauri_debug_domain_raw_llm" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_debug_domain_raw_llm" />
                                <span>Raw LLM reply (deep-dive)</span>
                            </label>
                            <small class="VectTauri_hint">Log the raw LLM reply and parser candidate-array diagnostics per window. Very noisy — use only when investigating extraction/parse problems. Independent of the verbosity dropdown.</small>

                            <label class="checkbox_label" for="VectTauri_eventbase_debug_qdrant_backend" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_eventbase_debug_qdrant_backend" />
                                <span>Debug Qdrant backend</span>
                            </label>
                            <small class="VectTauri_hint">Log native hybrid backend keyword/fusion diagnostics from the Similharity Qdrant backend. Turn this off when not actively debugging to avoid noisy console output.</small>

                            <label class="checkbox_label" for="VectTauri_agentic_debug" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_agentic_debug" />
                                <span>Debug Agent Mode</span>
                            </label>
                            <small class="VectTauri_hint">Log [VectTauri-Agentic] details: mode marker, narrative context preview (~50 words per turn), LLM round-trip ms, planner output JSON, Qdrant fanout ms, total agent overhead ms, per-query hit counts. Only fires when Agent Mode is enabled (AgentMode tab).</small>

                            <label class="checkbox_label" for="VectTauri_eventbase_compare_rerank" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_eventbase_compare_rerank" />
                                <span>Compare native vs JS re-rank (debug)</span>
                            </label>
                            <small class="VectTauri_hint">Requires native re-rank ON and Debug Logging ON. Runs the JS pipeline in parallel for each (collection, queryText) and logs top-K overlap + Spearman ρ + timings. Doubles per-collection cost — debug only.</small>

                            <label class="checkbox_label" for="VectTauri_eventbase_compare_rerank_verbose" style="margin-top: 12px;">
                                <input type="checkbox" id="VectTauri_eventbase_compare_rerank_verbose" />
                                <span>Verbose compare logs (per-event breakdown)</span>
                            </label>
                            <small class="VectTauri_hint">Adds per-event score-component breakdowns for events present in both top-K lists. Verbose — enable only when investigating a specific divergence.</small>

                        </div>
                    </div>

                    <!-- EventBase Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="eventbase">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon"><i class="fa-solid fa-database"></i></span>
                                EventBase
                            </h3>
                            <p class="vecttauri-card-subtitle">Settings on this tab apply to chat content: <b>Current Chat history</b> and <b>uploaded Archive Chat history (.jsonl)</b>. AI-extracted structured events are stored for semantic retrieval.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <!-- Extraction settings -->
                            <p class="vecttauri-section-label"><strong>Extraction</strong></p>

                            <!-- Window Size / Window Overlap moved to the Vectorize Content panel
                                 (Feature A): after the independent auto-sync window, these two only
                                 affect one-off Vectorize Content / backfill, so they live next to it. -->

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Min Importance to Store <span id="VectTauri_eventbase_min_importance_store_val">3</span></label>
                                <input type="range" id="VectTauri_eventbase_min_importance_store" min="1" max="10" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">Events below this importance threshold are discarded before writing to Qdrant.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Max Events per Window <span id="VectTauri_eventbase_max_events_per_window_val">3</span></label>
                                <input type="range" id="VectTauri_eventbase_max_events_per_window" min="1" max="10" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">Hard cap per LLM call. AI is instructed to return fewer (or zero) for filler / 日常 nichijou / non-narrative scenes.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Temperature</label>
                                <input type="number" id="VectTauri_eventbase_temperature" class="vecttauri-input" min="0" max="2" step="0.05" style="width:100px;" />
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Max Output Tokens</label>
                                <input type="number" id="VectTauri_eventbase_max_tokens" class="vecttauri-input" min="256" max="32768" step="64" style="width:120px;" />
                                <small class="VectTauri_hint">
                                    Raise this if extraction fails with "used its entire token limit without
                                    answering" — a thinking model spends this budget before it writes anything.
                                </small>
                            </div>

                            <div class="vecttauri-form-group">
                                <p class="vecttauri-section-label" style="margin-bottom:4px;"><strong>LLM Call Timeouts</strong></p>
                                <small class="VectTauri_hint" style="display:block; margin-bottom:8px;">
                                    Two independent per-call timeouts, both on the same configured model. <strong>Extraction</strong> bounds each end-to-end EventBase extraction call (a window of messages in → finished structured events out). <strong>Summarization</strong> bounds each single "Summarize Before Store" call (one chunk in → its summary out). Raise either if a slow local model gets cut off.
                                </small>

                                <label class="vecttauri-label">Extraction Timeout (ms)</label>
                                <input type="number" id="VectTauri_eventbase_timeout_ms" class="vecttauri-input" min="5000" max="300000" step="1000" style="width:130px;" />

                                <label class="vecttauri-label" style="margin-top:8px;">Summarization Timeout (ms)</label>
                                <input type="number" id="VectTauri_summarize_timeout_ms" class="vecttauri-input" min="5000" max="300000" step="1000" style="width:130px;" />
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="checkbox_label" for="VectTauri_eventbase_disable_pipeline">
                                    <input type="checkbox" id="VectTauri_eventbase_disable_pipeline" />
                                    <span>Serial extract→insert</span>
                                </label>
                                <small class="VectTauri_hint">Default (unchecked): extract and insert overlap for ~35% faster throughput. Check to make each batch finish embedding before the next batch starts extracting — safer on slower vector DB backends.</small>
                            </div>

                            <hr style="margin: 16px 0; opacity:0.2;" />

                            <!-- Retrieval settings -->
                            <p class="vecttauri-section-label"><strong>Retrieval</strong></p>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Retrieve Top-K <span id="VectTauri_eventbase_retrieval_top_k_val">10</span></label>
                                <input type="range" id="VectTauri_eventbase_retrieval_top_k" min="1" max="32" step="1" class="vecttauri-slider" />
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Min Importance for Retrieval <span id="VectTauri_eventbase_retrieval_min_importance_val">1</span></label>
                                <input type="range" id="VectTauri_eventbase_retrieval_min_importance" min="1" max="10" step="1" class="vecttauri-slider" />
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Injection Format</label>
                                <select id="VectTauri_eventbase_injection_format" class="vecttauri-select">
                                    <option value="jsonarray">JSONArray</option>
                                    <option value="densetext">DenseText</option>
                                    <option value="summaryonly">Summary Only</option>
                                </select>
                                <small class="VectTauri_hint">JSONArray keeps full structured JSON. DenseText uses compact key/value blocks. Summary Only injects only summary + DateTime — minimum prompt footprint.</small>
                            </div>

                            <!-- Re-rank weights -->
                            <p style="margin: 12px 0 4px; font-size:0.85em; font-weight:600;">Re-rank Weights</p>
                            <small class="VectTauri_hint">Weights are normalized to sum to 1.0 on save. Defaults are tuned for long-form SillyTavern RP.</small>
                            <small id="VectTauri_eventbase_cosine_plugin_warning" class="VectTauri_hint" style="display:none; color:#c08a3a; margin-top:4px;">
                                ⚠ Cosine weight inactive — native Standard backend without the Similharity plugin returns no vector scores. Its share is auto-redistributed to Importance / Persist / Recency at query time.
                            </small>

                            <div class="vecttauri-rerank-weights" style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                                <div class="vecttauri-form-group" id="VectTauri_eventbase_cosine_group">
                                    <label class="vecttauri-label">Cosine (semantic)</label>
                                    <input type="number" id="VectTauri_eventbase_rerank_w_cosine" class="vecttauri-input" min="0" max="1" step="0.05" style="width:80px;" />
                                </div>
                                <div class="vecttauri-form-group">
                                    <label class="vecttauri-label">Importance</label>
                                    <input type="number" id="VectTauri_eventbase_rerank_w_importance" class="vecttauri-input" min="0" max="1" step="0.05" style="width:80px;" />
                                </div>
                                <div class="vecttauri-form-group">
                                    <label class="vecttauri-label">Persist bonus</label>
                                    <input type="number" id="VectTauri_eventbase_rerank_w_persist" class="vecttauri-input" min="0" max="1" step="0.05" style="width:80px;" />
                                </div>
                                <div class="vecttauri-form-group">
                                    <label class="vecttauri-label">Recency decay</label>
                                    <input type="number" id="VectTauri_eventbase_rerank_w_recency" class="vecttauri-input" min="0" max="1" step="0.05" style="width:80px;" />
                                </div>
                            </div>
                            <button id="VectTauri_eventbase_reset_weights" class="vecttauri-btn vecttauri-btn-secondary" style="margin-top:6px; font-size:0.8em;">Reset to defaults</button>

                            <hr style="margin: 16px 0; opacity:0.2;" />

                            <hr style="margin: 16px 0; opacity:0.2;" />

                            <!-- Extraction Prompt -->
                            <div class="vecttauri-setting-row" style="flex-direction:column; align-items:flex-start; gap:6px;">
                                <label style="font-weight:600;">Extraction Prompt</label>
                                <small class="VectTauri_hint">Full prompt sent to the LLM for each window. Use <code>{{text}}</code> where the excerpt goes and <code>{{maxCount}}</code> for the event cap. Leave empty to use the built-in default.</small>
                                <div style="display:flex; gap:6px; width:100%; margin-bottom:4px;">
                                    <button id="VectTauri_eventbase_prompt_reset" class="vecttauri-action-btn vecttauri-btn-secondary" style="font-size:11px; padding:3px 10px;">Reset to Default</button>
                                </div>
                                <textarea id="VectTauri_eventbase_custom_prompt"
                                    class="vecttauri-input"
                                    rows="12"
                                    style="width:100%; font-family:monospace; font-size:11px; resize:vertical;"
                                    placeholder="Leave empty to use the built-in default prompt…"></textarea>
                            </div>

                        </div>
                    </div>

                    <!-- AgentMode Card -->
                    <div class="vecttauri-card" data-vecttauri-tab="agentmode">
                        <div class="vecttauri-card-header">
                            <h3 class="vecttauri-card-title">
                                <span class="vecttauri-icon"><i class="fa-solid fa-robot"></i></span>
                                AgentMode — Agentic Retrieval
                            </h3>
                            <p class="vecttauri-card-subtitle">An optional LLM-planner step that runs between pre-search and re-rank. It reads recent chat context plus pre-search candidates, then fans out 1-4 follow-up queries in parallel against Qdrant. Purely additive — never replaces the normal flow.</p>
                        </div>
                        <div class="vecttauri-card-body">

                            <!-- Master toggle -->
                            <div class="vecttauri-form-group">
                                <label class="checkbox_label" for="VectTauri_agentic_retrieval_enabled">
                                    <input id="VectTauri_agentic_retrieval_enabled" type="checkbox" />
                                    <span><b>Enable AgentMode</b></span>
                                </label>
                                <small class="VectTauri_hint" style="display:block; margin-top:6px;">
                                    Requires Qdrant backend (A3). Adds ~$0.0002 and ~300ms per turn. Always merged with normal search — never replaces it. Falls back gracefully on any failure.
                                </small>
                            </div>

                            <!-- LLM Provider (inheritance from summarizer) -->
                            <p class="vecttauri-section-label" style="margin-top:16px;"><strong>LLM Provider</strong></p>
                            <small class="VectTauri_hint" style="display:block; margin-bottom:8px;">
                                Leave any field blank to inherit from <b>Summarize Before Store</b> settings. Use a cheaper model here (e.g. <code>anthropic/claude-haiku-4-5</code>) to save cost.
                            </small>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_agentic_provider"><small>Provider</small></label>
                                <select id="VectTauri_agentic_provider" class="vecttauri-select">
                                    <option value="">(Inherit from summarizer)</option>
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="vllm">vLLM</option>
                                </select>
                            </div>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_agentic_model"><small>Model</small></label>
                                <input type="text" id="VectTauri_agentic_model" class="vecttauri-input"
                                    placeholder="(empty → inherit summarizer model)" />
                                <small class="VectTauri_hint">e.g. <code>anthropic/claude-haiku-4-5</code> for OpenRouter.</small>
                            </div>

                            <div class="vecttauri-form-group" id="VectTauri_agentic_openrouter_row">
                                <label for="VectTauri_agentic_openrouter_apikey"><small>OpenRouter API Key</small></label>
                                <input type="password" id="VectTauri_agentic_openrouter_apikey" class="vecttauri-input"
                                    placeholder="(empty → inherit summarize key)" autocomplete="off" />
                                <button type="button" id="VectTauri_agentic_openrouter_apikey_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                            </div>

                            <div class="vecttauri-form-group" id="VectTauri_agentic_vllm_row" style="display:none;">
                                <label for="VectTauri_agentic_vllm_url"><small>vLLM Base URL</small></label>
                                <input type="text" id="VectTauri_agentic_vllm_url" class="vecttauri-input"
                                    placeholder="(empty → inherit summarize URL)" />
                                <label for="VectTauri_agentic_vllm_apikey" style="margin-top:8px;"><small>vLLM API Key</small></label>
                                <input type="password" id="VectTauri_agentic_vllm_apikey" class="vecttauri-input"
                                    placeholder="(empty → inherit summarize key)" autocomplete="off" />
                                <button type="button" id="VectTauri_agentic_vllm_apikey_clear" class="menu_button" style="margin-top:4px; width:auto; white-space:nowrap;"><i class="fa-solid fa-trash-can"></i> Clear saved key</button>
                            </div>

                            <!-- Retrieval Tuning -->
                            <p class="vecttauri-section-label" style="margin-top:16px;"><strong>Retrieval Tuning</strong></p>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Past chat turns sent to planner: <span id="VectTauri_agentic_chat_depth_val">3</span></label>
                                <input type="range" id="VectTauri_agentic_chat_depth" min="1" max="10" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">How many recent non-system chat turns are included as narrative context for the planner. Lower = faster + cheaper LLM call; higher = more story context for the planner to reason about.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Candidates shown to planner: <span id="VectTauri_agentic_candidates_val">12</span></label>
                                <input type="range" id="VectTauri_agentic_candidates" min="5" max="20" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">How many top pre-search events the planner sees when deciding what extra queries to run.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label class="vecttauri-label">Max planner queries: <span id="VectTauri_agentic_max_queries_val">6</span></label>
                                <input type="range" id="VectTauri_agentic_max_queries" min="1" max="6" step="1" class="vecttauri-slider" />
                                <small class="VectTauri_hint">Hard ceiling on how many follow-up queries the planner can emit. Each query is one Qdrant call per live collection.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_agentic_timeout"><small>Planner LLM Timeout (ms)</small></label>
                                <input type="number" id="VectTauri_agentic_timeout" class="vecttauri-input" min="${AGENTIC_TIMEOUT_MIN_MS}" max="${AGENTIC_TIMEOUT_MAX_MS}" step="1000" />
                                <small class="VectTauri_hint">Hard timeout for the planner call. Default <b>${AGENTIC_PLANNER_TIMEOUT_DEFAULT_MS} ms (${AGENTIC_PLANNER_TIMEOUT_DEFAULT_MS / 1000}s)</b>. On timeout, agent mode falls back to pre-search only. Increase if your planner model is slow (large models / free-tier providers often take 10-20s on a 1500-token prompt). This time is <b>added to</b> "Retrieval Timeout" on the Core tab for the EventBase lookup, so raising it here is not capped by that setting.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_agentic_max_tokens"><small>Planner Max Output Tokens</small></label>
                                <input type="number" id="VectTauri_agentic_max_tokens" class="vecttauri-input" min="${AGENTIC_MAX_TOKENS_MIN}" max="${AGENTIC_MAX_TOKENS_MAX}" step="256" />
                                <small class="VectTauri_hint">Output-token cap for the planner call. Default <b>${AGENTIC_MAX_TOKENS_DEFAULT}</b>, range ${AGENTIC_MAX_TOKENS_MIN}–${AGENTIC_MAX_TOKENS_MAX}. The planner only returns a short JSON object, so the default is ample for a model that answers directly. <b>Raise it if your planner model reasons</b> — thinking tokens are charged against this same cap, so a reasoning model can spend the whole budget before writing any JSON, and agent mode then falls back to pre-search. "Disable thinking" on the Core tab only <i>asks</i> the model not to reason; many models ignore it.</small>
                            </div>

                            <div class="vecttauri-form-group">
                                <label for="VectTauri_agentic_query_timeout"><small>Per-query Timeout (ms)</small></label>
                                <input type="number" id="VectTauri_agentic_query_timeout" class="vecttauri-input" min="${AGENTIC_TIMEOUT_MIN_MS}" max="${AGENTIC_TIMEOUT_MAX_MS}" step="1000" />
                                <small class="VectTauri_hint">Hard timeout for each parallel fanout query. Default <b>${AGENTIC_QUERY_TIMEOUT_DEFAULT_MS} ms (${AGENTIC_QUERY_TIMEOUT_DEFAULT_MS / 1000}s)</b>. Queries run in parallel, so the turn waits on the slowest one — this drops a straggling query (e.g. an embedding-provider latency spike) so a single slow call can't stall retrieval. The remaining queries still count. Like the planner timeout above, this is <b>added to</b> "Retrieval Timeout" on the Core tab rather than capped by it.</small>
                            </div>

                            <!-- Apply planner filters (Phase 1.5) -->
                            <div class="vecttauri-form-group">
                                <label class="checkbox_label" for="VectTauri_agentic_filters_enabled">
                                    <input id="VectTauri_agentic_filters_enabled" type="checkbox" />
                                    <span><b>Apply planner filters</b></span>
                                </label>
                                <small class="VectTauri_hint" style="display:block; margin-top:6px;">
                                    When on, the planner's character / location / concept / importance filters narrow each Qdrant query. Turn off to run all queries without filters (useful for A/B comparison). Has no effect on the pre-search. Qdrant only.
                                </small>
                            </div>

                        </div>
                    </div>

                </div>
            </div>
        </div>

        <!-- Diagnostics Modal -->
        <div id="VectTauri_diagnostics_modal" class="vecttauri-modal" style="display: none;">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content vecttauri-diagnostics-modal">
                <div class="vecttauri-modal-header">
                    <h3>
                        <i class="fa-solid fa-stethoscope"></i>
                        <span id="VectTauri_diagnostics_title">Run Diagnostics</span>
                    </h3>
                    <button class="vecttauri-modal-close" id="VectTauri_diagnostics_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecttauri-modal-body">
                    <!-- Phase 1: Category Selection -->
                    <div id="VectTauri_diagnostics_selection" class="vecttauri-diagnostics-phase">
                        <p class="vecttauri-diagnostics-intro">Select which diagnostic categories to run:</p>

                        <div class="vecttauri-diagnostics-categories">
                            <label class="vecttauri-diagnostics-category-option">
                                <input type="checkbox" id="VectTauri_diag_infrastructure" checked>
                                <div class="vecttauri-diagnostics-category-card">
                                    <i class="fa-solid fa-server"></i>
                                    <div class="vecttauri-diagnostics-category-info">
                                        <strong>Infrastructure</strong>
                                        <span>Backend connections, plugins, API endpoints</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecttauri-diagnostics-category-option">
                                <input type="checkbox" id="VectTauri_diag_configuration" checked>
                                <div class="vecttauri-diagnostics-category-card">
                                    <i class="fa-solid fa-sliders"></i>
                                    <div class="vecttauri-diagnostics-category-info">
                                        <strong>Configuration</strong>
                                        <span>Settings validation, chunk size, thresholds</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecttauri-diagnostics-category-option">
                                <input type="checkbox" id="VectTauri_diag_visualizer" checked>
                                <div class="vecttauri-diagnostics-category-card">
                                    <i class="fa-solid fa-eye"></i>
                                    <div class="vecttauri-diagnostics-category-info">
                                        <strong>Visualizer</strong>
                                        <span>Chunk editing, deletion, summary vectors</span>
                                    </div>
                                </div>
                            </label>

                            <label class="vecttauri-diagnostics-category-option">
                                <input type="checkbox" id="VectTauri_diag_production">
                                <div class="vecttauri-diagnostics-category-card">
                                    <i class="fa-solid fa-vial"></i>
                                    <div class="vecttauri-diagnostics-category-info">
                                        <strong>Production Tests</strong>
                                        <span>Live embedding, storage, retrieval tests</span>
                                    </div>
                                </div>
                            </label>
                        </div>

                        <div class="vecttauri-diagnostics-actions">
                            <button class="vecttauri-btn-secondary" id="VectTauri_diag_cancel">Cancel</button>
                            <button class="vecttauri-btn-primary" id="VectTauri_diag_run">
                                <i class="fa-solid fa-play"></i> Run Diagnostics
                            </button>
                        </div>
                    </div>

                    <!-- Phase 2: Running -->
                    <div id="VectTauri_diagnostics_running" class="vecttauri-diagnostics-phase" style="display: none;">
                        <div class="vecttauri-diagnostics-spinner">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <span>Running diagnostics...</span>
                        </div>
                    </div>

                    <!-- Phase 3: Results -->
                    <div id="VectTauri_diagnostics_results" class="vecttauri-diagnostics-phase" style="display: none;">
                        <div id="VectTauri_diagnostics_content"></div>
                        <div class="vecttauri-diagnostics-footer">
                            <button class="vecttauri-btn-secondary" id="VectTauri_diag_back">
                                <i class="fa-solid fa-arrow-left"></i> Run Again
                            </button>
                            <button class="vecttauri-btn-secondary" id="VectTauri_diag_copy">
                                <i class="fa-solid fa-copy"></i> Copy Report
                            </button>
                            <button class="vecttauri-btn-danger" id="VectTauri_diag_fix_all" style="display: none;">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Fix All Issues
                            </button>
                            <button class="vecttauri-btn-primary" id="VectTauri_diag_done">Done</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Chunk Visualizer Modal -->
        <div id="VectTauri_visualizer_modal" class="vecttauri-modal" style="display: none;">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content vecttauri-visualizer-content">
                <div class="vecttauri-modal-header">
                    <h3>
                        <i class="fa-solid fa-cubes"></i>
                        Chunk Visualizer
                    </h3>
                    <button class="vecttauri-modal-close" id="VectTauri_visualizer_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
                <div class="vecttauri-visualizer-toolbar">
                    <input type="text" id="VectTauri_visualizer_search"
                           class="vecttauri-visualizer-search"
                           placeholder="Search chunks by text, keywords, or name...">
                    <div class="vecttauri-visualizer-stats">
                        <span id="VectTauri_visualizer_count">0 chunks</span>
                        <span id="VectTauri_visualizer_tiers"></span>
                    </div>
                </div>
                <div class="vecttauri-modal-body">
                    <div id="VectTauri_visualizer_content"></div>
                </div>
                <div class="vecttauri-modal-footer">
                    <button class="vecttauri-btn-secondary" id="VectTauri_visualizer_done">Done</button>
                </div>
            </div>
        </div>

        ${getHealthModalHtml()}
    `;

    // Sanity debug: confirm the generated HTML contains the lock button marker
    try {
        log.trace(`VectTauri: renderSettings built HTML contains lock marker:`, String(html).indexOf('VectTauri_lock_collection') >= 0);
        const target = document.getElementById(containerId);
        log.trace(`VectTauri: renderSettings target container exists:`, !!target, 'containerId=', containerId);
    } catch (e) {
        log.warn('VectTauri: renderSettings pre-append debug failed', e);
    }

    $(`#${containerId}`).append(html);

    // Debug: log presence of lock button after rendering and observe for later appearance
    try {
        log.trace(`VectTauri: renderSettings appended to ${containerId}. lock button present:`, !!document.getElementById('VectTauri_lock_collection'));
        if (!document.getElementById('VectTauri_lock_collection')) {
            const containerEl = document.getElementById(containerId);
            if (containerEl && window.MutationObserver) {
                const mo = new MutationObserver((mutations, obs) => {
                    if (document.getElementById('VectTauri_lock_collection')) {
                        log.trace('VectTauri: lock button appeared in DOM');
                        obs.disconnect();
                    }
                });
                mo.observe(containerEl, { childList: true, subtree: true });
            }
        }
    } catch (e) {
        log.warn('VectTauri: debug check failed', e);
    }

    // Bind all events
    bindSettingsEvents(settings, callbacks);

    // Initialize collapsible cards
    initializeCollapsibleCards();

    // Initialize tab navigation
    initializeTabs();

    // Initialize modal
    initializeDiagnosticsModal();

    // Initialize health dashboard
    initializeHealthDashboard();

    log.lifecycle('VectTauri UI: Settings rendered');
}

/**
 * Initializes diagnostics modal functionality
 */
function initializeDiagnosticsModal() {
    // Close button
    $('#VectTauri_diagnostics_close').on('click', function() {
        closeDiagnosticsModal();
    });

    // Click overlay to close
    $('#VectTauri_diagnostics_modal .vecttauri-modal-overlay').on('click', function() {
        closeDiagnosticsModal();
    });

    // Stop mousedown propagation (ST closes drawers on mousedown/touchstart)
    // Note: This modal is inside the drawer so it doesn't strictly need this,
    // but we include it for consistency with other modals
    $('#VectTauri_diagnostics_modal').on('mousedown touchstart', function(e) {
        e.stopPropagation();
    });

    // ESC key to close
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#VectTauri_diagnostics_modal').is(':visible')) {
            closeDiagnosticsModal();
        }
    });

    // Cancel button
    $('#VectTauri_diag_cancel').on('click', function() {
        closeDiagnosticsModal();
    });

    // Done button
    $('#VectTauri_diag_done').on('click', function() {
        closeDiagnosticsModal();
    });

    // Back button - go back to selection
    $('#VectTauri_diag_back').on('click', function() {
        showDiagnosticsPhase('selection');
        $('#VectTauri_diagnostics_title').text('Run Diagnostics');
    });

    // Run button - execute diagnostics
    $('#VectTauri_diag_run').on('click', async function() {
        await executeDiagnostics();
    });
}

/**
 * Closes the diagnostics modal and resets to selection phase
 */
function closeDiagnosticsModal() {
    $('#VectTauri_diagnostics_modal').fadeOut(200, function() {
        // Reset to selection phase for next open
        showDiagnosticsPhase('selection');
        $('#VectTauri_diagnostics_title').text('Run Diagnostics');
    });
}

/**
 * Shows a specific phase of the diagnostics modal
 * @param {string} phase - 'selection', 'running', or 'results'
 */
function showDiagnosticsPhase(phase) {
    $('#VectTauri_diagnostics_selection').hide();
    $('#VectTauri_diagnostics_running').hide();
    $('#VectTauri_diagnostics_results').hide();
    $(`#VectTauri_diagnostics_${phase}`).show();
}

// Console error capture for diagnostics
let capturedConsoleLogs = [];
let originalConsoleError = null;
let originalConsoleWarn = null;

/**
 * Starts capturing console errors and warnings
 */
function startConsoleCapture() {
    capturedConsoleLogs = [];

    // Store originals
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;

    // Override console.error
    console.error = function(...args) {
        capturedConsoleLogs.push({
            type: 'error',
            message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            timestamp: new Date().toISOString(),
            stack: new Error().stack
        });
        originalConsoleError.apply(console, args);
    };

    // Override console.warn
    console.warn = function(...args) {
        capturedConsoleLogs.push({
            type: 'warning',
            message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            timestamp: new Date().toISOString()
        });
        originalConsoleWarn.apply(console, args);
    };
}

/**
 * Stops capturing console errors and returns captured logs
 * @returns {Array} Captured console logs
 */
function stopConsoleCapture() {
    // Restore originals
    if (originalConsoleError) {
        console.error = originalConsoleError;
        originalConsoleError = null;
    }
    if (originalConsoleWarn) {
        console.warn = originalConsoleWarn;
        originalConsoleWarn = null;
    }

    return capturedConsoleLogs;
}

/**
 * Executes diagnostics based on selected categories
 */
async function executeDiagnostics() {
    const settings = extension_settings.vecttauri;

    // Get selected categories
    const runInfrastructure = $('#VectTauri_diag_infrastructure').prop('checked');
    const runConfiguration = $('#VectTauri_diag_configuration').prop('checked');
    const runVisualizer = $('#VectTauri_diag_visualizer').prop('checked');
    const runProduction = $('#VectTauri_diag_production').prop('checked');

    if (!runInfrastructure && !runConfiguration && !runVisualizer && !runProduction) {
        toastr.warning('Please select at least one category to run');
        return;
    }

    // Show running phase
    showDiagnosticsPhase('running');
    $('#VectTauri_diagnostics_title').text('Running Diagnostics...');

    // Start capturing console errors
    startConsoleCapture();

    try {
        // Import and run diagnostics
        const { runDiagnostics } = await import('../diagnostics/index.js');
        const results = await runDiagnostics(settings, runProduction);

        // Stop capturing and get logs
        const consoleLogs = stopConsoleCapture();

        // Filter results based on selected categories
        const filteredResults = {
            version: results.version,
            categories: {},
            checks: [],
            overall: results.overall,
            timestamp: results.timestamp,
            consoleErrors: consoleLogs
        };

        if (runInfrastructure && results.categories.infrastructure) {
            filteredResults.categories.infrastructure = results.categories.infrastructure;
            filteredResults.checks.push(...results.categories.infrastructure);
        }
        if (runConfiguration && results.categories.configuration) {
            filteredResults.categories.configuration = results.categories.configuration;
            filteredResults.checks.push(...results.categories.configuration);
        }
        if (runVisualizer && results.categories.visualizer) {
            filteredResults.categories.visualizer = results.categories.visualizer;
            filteredResults.checks.push(...results.categories.visualizer);
        }
        if (runProduction && results.categories.production) {
            filteredResults.categories.production = results.categories.production;
            filteredResults.checks.push(...results.categories.production);
        }

        // Add console errors as a category if any were captured
        if (consoleLogs.length > 0) {
            filteredResults.categories.console = consoleLogs.map(log => ({
                name: `Console ${log.type}`,
                status: log.type === 'error' ? 'fail' : 'warning',
                message: log.message.substring(0, 200) + (log.message.length > 200 ? '...' : ''),
                category: 'console'
            }));
            filteredResults.checks.push(...filteredResults.categories.console);
        }

        // Recalculate overall status based on filtered results
        const failCount = filteredResults.checks.filter(c => c.status === 'fail').length;
        const warnCount = filteredResults.checks.filter(c => c.status === 'warning').length;
        filteredResults.overall = failCount > 0 ? 'issues' : warnCount > 0 ? 'warnings' : 'healthy';

        // Show results
        showDiagnosticsResults(filteredResults);

    } catch (error) {
        stopConsoleCapture();
        log.error('VectTauri Diagnostics error:', error);
        toastr.error('Failed to run diagnostics: ' + error.message);
        showDiagnosticsPhase('selection');
        $('#VectTauri_diagnostics_title').text('Run Diagnostics');
    }
}

/**
 * Initializes collapsible functionality
 */
function initializeCollapsibleCards() {
    $('.vecttauri-collapsible-header').on('click', function() {
        const content = $(this).next('.vecttauri-collapsible-content');
        const icon = $(this).find('.vecttauri-collapsible-icon');

        content.slideToggle(200);
        icon.toggleClass('rotated');
    });
}

    /**
     * Initializes two-row tab navigation for settings panels.
     * Each .vecttauri-card[data-vecttauri-tab] is a panel; only the active one is shown.
     */
    function initializeTabs() {
        $('#VectTauri_settings').on('click', '.vecttauri-tab-btn', function() {
            const tab = $(this).data('tab');
            // Update button active state
            $('.vecttauri-tab-btn', '#VectTauri_settings').removeClass('active');
            $(this).addClass('active');
            // Show only the matching tab panel
            $('[data-vecttauri-tab]', '#VectTauri_settings').removeClass('vecttauri-tab-active');
            $(`[data-vecttauri-tab="${tab}"]`, '#VectTauri_settings').addClass('vecttauri-tab-active');
            if (tab === 'action') refreshHealthIndicator();
            if (tab === 'worldinfo') refreshWIStatus();
            if (tab === 'autosync') refreshAutoSyncCheckbox(extension_settings.vecttauri);
        });
    }

// Use shared WebLLM provider singleton from providers/webllm.js
// This ensures the same engine instance is shared with core-vector-api.js
const getWebLlmProvider = getSharedWebLlmProvider;

/**
 * Checks if WebLLM is supported (browser + extension)
 * Shows user-friendly toast notifications with actionable guidance
 * @returns {boolean} True if WebLLM is available
 */
function isWebLlmSupported() {
    // Check 1: Browser supports WebGPU API
    if (!('gpu' in navigator)) {
        const warningKey = 'VectTauri_webllm_browser_warning_shown';
        if (!sessionStorage.getItem(warningKey)) {
            toastr.error(
                'Your browser does not support the WebGPU API. Please use Chrome 113+, Edge 113+, or another WebGPU-compatible browser.',
                'WebLLM - Browser Not Supported',
                { preventDuplicates: true, timeOut: 0, extendedTimeOut: 0 }
            );
            sessionStorage.setItem(warningKey, '1');
        }
        return false;
    }

    // Check 2: WebLLM extension is installed
    if (!Object.hasOwn(SillyTavern, 'llm')) {
        const warningKey = 'VectTauri_webllm_extension_warning_shown';
        if (!sessionStorage.getItem(warningKey)) {
            toastr.error(
                'WebLLM extension is not installed. Click here to install it.',
                'WebLLM - Extension Required',
                {
                    timeOut: 0,
                    extendedTimeOut: 0,
                    preventDuplicates: true,
                    onclick: () => openThirdPartyExtensionMenu('https://github.com/SillyTavern/Extension-WebLLM'),
                }
            );
            sessionStorage.setItem(warningKey, '1');
        }
        return false;
    }

    // Check 3: WebLLM extension supports embeddings
    if (typeof SillyTavern.llm.generateEmbedding !== 'function') {
        const warningKey = 'VectTauri_webllm_update_warning_shown';
        if (!sessionStorage.getItem(warningKey)) {
            toastr.error(
                'Your WebLLM extension is outdated and does not support embeddings. Please update the extension.',
                'WebLLM - Update Required',
                { preventDuplicates: true, timeOut: 0, extendedTimeOut: 0 }
            );
            sessionStorage.setItem(warningKey, '1');
        }
        return false;
    }

    return true;
}

/**
 * Executes a function with WebLLM error handling
 * @param {Function} func - Function to execute
 * @returns {Promise<any>} Result of function or undefined on error
 */
async function executeWithWebLlmErrorHandling(func) {
    try {
        return await func();
    } catch (error) {
        log.error('VectTauri: WebLLM operation failed', error);
        if (!(error instanceof Error)) {
            return;
        }
        switch (error.cause) {
            case 'webllm-not-available':
                toastr.error(
                    'WebLLM extension is not installed. Click here to install it.',
                    'WebLLM Error',
                    {
                        timeOut: 0,
                        extendedTimeOut: 0,
                        preventDuplicates: true,
                        onclick: () => openThirdPartyExtensionMenu('https://github.com/SillyTavern/Extension-WebLLM'),
                    }
                );
                break;
            case 'webllm-not-updated':
                toastr.error(
                    'Your WebLLM extension needs updating. It does not support embeddings.',
                    'WebLLM Update Required',
                    { timeOut: 0, extendedTimeOut: 0, preventDuplicates: true }
                );
                break;
            default:
                toastr.error(
                    `WebLLM error: ${error.message}`,
                    'WebLLM Error',
                    { preventDuplicates: true }
                );
        }
    }
}

/**
 * Loads available WebLLM models into the dropdown
 * @param {object} settings - VectTauri settings object
 */
export async function loadWebLlmModels(settings) {
    return executeWithWebLlmErrorHandling(async () => {
        const provider = getWebLlmProvider();
        const models = provider.getModels();
        const $select = $('#VectTauri_webllm_model');

        $select.empty();

        if (!models || models.length === 0) {
            $select.append($('<option>', { value: '', text: 'No embedding models available' }));
            return;
        }

        for (const model of models) {
            $select.append($('<option>', {
                value: model.id,
                text: model.toString ? model.toString() : model.id,
            }));
        }

        // Auto-select saved model or first available
        if (settings.webllm_model && models.some(m => m.id === settings.webllm_model)) {
            $select.val(settings.webllm_model);
        } else if (models.length > 0) {
            settings.webllm_model = models[0].id;
            $select.val(settings.webllm_model);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        }
    });
}

/**
 * Updates the WebLLM status display based on availability
 * @returns {boolean} True if WebLLM is available
 */
/**
 * Refreshes the auto-sync checkbox state from current chat's collection
 * Call this when chat changes to keep UI in sync
 * @param {object} settings - VectTauri settings object (unused, kept for API compatibility)
 */
export async function refreshWIStatus() {
    const $status = $('#VectTauri_wi_status');
    if (!$status.length) return;

    const settings = extension_settings.vecttauri || {};
    const $wiCheckbox = $('#VectTauri_enabled_world_info');

    // The WI checkbox mirrors the activation state: checked iff at least one own-persona
    // lorebook is active for the current chat. Two helpers to keep the persist/UI sync identical
    // across the three exit paths below.
    const _setWIEnabled = (enabled) => {
        if (settings.enabled_world_info !== enabled) {
            settings.enabled_world_info = enabled;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        }
        if ($wiCheckbox.length && $wiCheckbox.prop('checked') !== enabled) {
            $wiCheckbox.prop('checked', enabled);
            $('#VectTauri_world_info_settings').toggle(enabled);
        }
    };

    // Single source of truth for ownership AND isActive — getCollectionListing
    // encodes the superadmin bypass + creatorHandle check + lock-state check.
    const ownLorebookEntries = getCollectionListing(settings)
        .filter(e => e.isOwn && e.collectionId.startsWith('vf_lorebook_'));

    if (ownLorebookEntries.length === 0) {
        $status.html('<i class="fa-solid fa-circle-exclamation" style="color: var(--warning-color, #f39c12);"></i> No lorebooks vectorized — vectorize one first');
        _setWIEnabled(false);
        return;
    }

    const activeIds = ownLorebookEntries
        .filter(e => e.isActive)
        .map(e => e.collectionId);

    if (activeIds.length === 0) {
        $status.html(
            '<i class="fa-solid fa-circle-exclamation" style="color: var(--warning-color, #f39c12);"></i> ' +
            'Lorebook vectorized but not active for this chat — lock it in Database Browser → Collection Settings'
        );
        _setWIEnabled(false);
        return;
    }

    const names = activeIds.map(id => getCollectionMeta(id)?.sourceName || id);
    const nameList = names.map(n => `<span style="font-style:italic;">${StringUtils.escapeHtml(n)}</span>`).join(', ');
    $status.html(
        `<i class="fa-solid fa-circle-check" style="color: var(--success-color, #27ae60);"></i> ` +
        `Active for this chat: ${nameList}`
    );
    _setWIEnabled(true);
}

/**
 * Offer to fork a branch or checkpoint chat's EventBase from its parent, for the
 * auto-sync enable flow when the chat has no collection of its own yet.
 *
 * @param {object} settings
 * @returns {Promise<'forked'|'vectorize'|'cancel'>}
 *   'forked' — this chat now has its own collection; continue enabling.
 *   'vectorize' — no parent to fork from, or the user chose to start over.
 *   'cancel' — the user closed the popup, stopped the fork, or it failed.
 */
async function _offerEventBaseFork(settings) {
    const { findEventBaseForkSource, forkEventBaseFromSource } = await import('../core/eventbase-fork.js');

    let source;
    try {
        source = await findEventBaseForkSource(settings);
    } catch (err) {
        log.error('[AutoSync][fork] looking for a parent EventBase failed:', err);
        toastr.error(err?.message || String(err), 'Could not check for a parent chat');
        return 'cancel';
    }
    if (!source) return 'vectorize';

    const remainingCount = Math.max(0, source.chatMessageCount - source.sharedPrefixLength);
    const remainingText = remainingCount > 0
        ? ` The ${remainingCount} message${remainingCount === 1 ? '' : 's'} after them still need extraction.`
        : '';
    const popup = await import('../../../../popup.js');
    const { callGenericPopup, POPUP_TYPE } = popup;
    const POPUP_RESULT = popup.POPUP_RESULT || { AFFIRMATIVE: 1, NEGATIVE: 0 };
    const choice = await callGenericPopup(
        `<div style="text-align:left">
            <p><strong>This chat is a branch or checkpoint.</strong> Its first ${source.sharedPrefixLength} messages match the EventBase <em>${StringUtils.escapeHtml(source.collectionId)}</em>.</p>
            <p><strong>Fork from parent</strong> copies the events for those messages into this chat's own EventBase — no LLM calls, no re-embedding.${remainingText} If the parent's EventBase is locked to this chat, it is unlocked: its later events belong to the parent's story.</p>
            <p><strong>Vectorize from scratch</strong> extracts this chat's whole history again.</p>
        </div>`,
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Fork from parent', cancelButton: 'Vectorize from scratch' },
    );

    if (choice === POPUP_RESULT.NEGATIVE) return 'vectorize';
    if (choice !== POPUP_RESULT.AFFIRMATIVE) return 'cancel';

    try {
        const result = await forkEventBaseFromSource(settings, source);
        toastr.success(`Copied ${result.eventCount} events from the parent chat`, 'EventBase forked');
        return 'forked';
    } catch (err) {
        if (err?.name === 'AbortError') {
            toastr.info('EventBase fork stopped');
            return 'cancel';
        }
        log.error('[AutoSync][fork] fork failed:', err);
        toastr.error(err?.message || String(err), 'EventBase fork failed');
        return 'cancel';
    }
}

export async function refreshAutoSyncCheckbox(settings) {
    const $checkbox = $('#VectTauri_autosync_enabled');
    const $status = $('#VectTauri_autosync_status');
    const $hint = $('#VectTauri_autosync_hint');

    const { getChatAutoSyncStatus } = await import('../core/eventbase-workflow.js');
    const { isCollectionAutoSyncEnabled, isCollectionActiveForContextAnyKey } = await import('../core/collection-metadata.js');

    // While VectTauri is disabled this refresh only reads cached state: no backend call,
    // no diagnostics. It still runs so the checkbox matches the current chat — the
    // Summarizer Injection toggle reads it. The master switch refreshes again when
    // VectTauri is turned back on.
    const isVectTauriOn = isVectTauriEnabled(settings);
    const status = await getChatAutoSyncStatus(settings, {
        shouldProbeBackend: isVectTauriOn,
        shouldLogResolution: isVectTauriOn,
    });
    const chatId = getCurrentChatId();

    const LED = {
        white:  '<i class="fa-solid fa-circle" style="color: var(--muted-color, #8a8a8a);"></i>',
        yellow: '<i class="fa-solid fa-circle-exclamation" style="color: var(--warning-color, #f39c12);"></i>',
        green:  '<i class="fa-solid fa-circle-check" style="color: var(--success-color, #27ae60);"></i>',
    };

    // no-chat: no chat open at all
    if (status.state === 'no-chat') {
        $checkbox.prop('checked', false);
        $hint.show();
        $status.html(`${LED.yellow} No chat loaded`);
        return;
    }

    // no-collection: chat is open but no eventbase collection exists yet
    if (status.state === 'no-collection') {
        $checkbox.prop('checked', false);
        $hint.show();
        $status.html(`${LED.yellow} Not initialized — vectorize chat first`);
        return;
    }

    // Collection exists. The checkbox reflects the per-collection autoSync flag.
    // The LED reflects whether the chat is fully synced or has a backlog.
    // Metadata is keyed by registry-key form ("backend:id").
    const lookupKey = status.registryKey || status.collectionId;
    const isEnabled = isCollectionAutoSyncEnabled(lookupKey);
    const isLocked = chatId && isCollectionActiveForContextAnyKey(
        [status.registryKey, status.collectionId], { chatId });
    $checkbox.prop('checked', Boolean(isEnabled && isLocked));
    $hint.hide();

    // Helper to format the "chat: N msgs · vectorization: M msgs" tail.
    // Prefer vectorizationTip (live max(source_window_end)+1 — kept current by
    // the ingestion loop) over markerValue (frozen enable-time stake, lies as
    // new windows extract). Falls back to markerValue when the tip cache is
    // empty AND the probe returned no events (e.g. brand-new collection).
    const vectorizedCount = (typeof status.vectorizationTip === 'number')
        ? status.vectorizationTip
        : (typeof status.markerValue === 'number' ? status.markerValue : null);
    // Settle/commit lag: when fully synced, the active last turn is intentionally
    // held back (it's already in live context), so "vectorization" can sit one
    // turn behind "chat" without being a backlog. Label that gap so green + a
    // small delta reads as intentional, not "behind". See plans/executed/autosync-settle-lag.md.
    const settleGap = (typeof status.chatMessageCount === 'number' && vectorizedCount !== null)
        ? status.chatMessageCount - vectorizedCount
        : 0;
    const showSettleNote = status.state === 'fully-vectorized' && settleGap > 0;
    const counts = (typeof status.chatMessageCount === 'number')
        ? `<div style="margin-top:4px;font-size:0.85em;opacity:0.8;">chat: ${status.chatMessageCount} msgs` +
          (vectorizedCount !== null ? ` · vectorization: ${vectorizedCount} msgs` : '') +
          (showSettleNote ? ` · latest turn pending settle` : '') +
          `</div>`
        : '';

    if (!isVectTauriOn) {
        $status.html(`${LED.white} Auto-sync paused — VectTauri is disabled${counts}`);
    } else if (!isEnabled || !isLocked) {
        $status.html(`${LED.white} Auto-sync inactive${counts}`);
    } else if (status.state === 'vectorization-ahead') {
        // Distinct state — vectorization marker is past the current chat tail.
        // Common cause: user bound a chat vectorization that ran on a longer
        // version of this chat (or deleted messages after vectorizing). NO
        // auto-sync work will happen until the chat catches up to the marker.
        // Show the gap so the user can tell they probably picked the wrong
        // vectorization to bind to this chat.
        const gap = status.markerValue - status.chatMessageCount;
        $status.html(
            `${LED.yellow} Vectorization is ahead of current chat — no auto-sync needed. ` +
            `<div style="margin-top:4px;font-size:0.85em;opacity:0.9;">` +
            `chat: ${status.chatMessageCount} msgs · vectorization: ${status.markerValue} msgs ` +
            `(${gap} msg${gap === 1 ? '' : 's'} ahead)` +
            `</div>` +
            `<div style="margin-top:4px;font-size:0.82em;opacity:0.75;">` +
            `If this looks wrong, you may have bound a chat vectorization from a different / longer chat. ` +
            `Auto-sync will resume once the chat catches up to ${status.markerValue} messages.` +
            `</div>`
        );
    } else if (status.state === 'fully-vectorized') {
        $status.html(`${LED.green} Ready — fully synced${counts}`);
    } else {
        $status.html(`${LED.yellow} Locked — will sync to latest history on next auto-sync trigger${counts}`);
    }
}

export function updateWebLlmStatus() {
    const $status = $('#VectTauri_webllm_status');
    const $installBtn = $('#VectTauri_webllm_install');
    const $loadBtn = $('#VectTauri_webllm_load');
    const $modelSelect = $('#VectTauri_webllm_model');

    // Check browser support
    if (!('gpu' in navigator)) {
        $status.html('<i class="fa-solid fa-exclamation-triangle" style="color: var(--warning-color, #f39c12);"></i> Your browser does not support WebGPU. Use Chrome 113+ or Edge 113+.');
        $installBtn.hide();
        $loadBtn.prop('disabled', true);
        $modelSelect.prop('disabled', true);
        return false;
    }

    // Check extension installed
    if (!Object.hasOwn(SillyTavern, 'llm')) {
        $status.html('<i class="fa-solid fa-exclamation-circle" style="color: var(--error-color, #e74c3c);"></i> WebLLM extension not installed. Click "Install Extension" below.');
        $installBtn.show();
        $loadBtn.prop('disabled', true);
        $modelSelect.prop('disabled', true);
        return false;
    }

    // Check extension supports embeddings
    if (typeof SillyTavern.llm.generateEmbedding !== 'function') {
        $status.html('<i class="fa-solid fa-exclamation-triangle" style="color: var(--warning-color, #f39c12);"></i> WebLLM extension is outdated. Please update it to support embeddings.');
        $installBtn.show().find('i').removeClass('fa-puzzle-piece').addClass('fa-rotate');
        $installBtn.find('span, text').text(' Update Extension');
        $loadBtn.prop('disabled', true);
        $modelSelect.prop('disabled', true);
        return false;
    }

    // All good!
    $status.html('<i class="fa-solid fa-check-circle" style="color: var(--success-color, #2ecc71);"></i> WebLLM extension is installed and ready.');
    $installBtn.hide();
    $loadBtn.prop('disabled', false);
    $modelSelect.prop('disabled', false);
    return true;
}

/**
 * Toggles provider-specific settings visibility
 * @param {string} selectedProvider - Currently selected provider
 * @param {object} settings - VectTauri settings object
 */
function toggleProviderSettings(selectedProvider, settings) {
    // Hide all provider-specific settings
    $('.VectTauri_provider_setting').hide();

    // Show settings for selected provider
    $(`.VectTauri_provider_setting`).each(function() {
        const providers = $(this).attr('data-provider').split(',');
        if (providers.includes(selectedProvider)) {
            $(this).show();
        }
    });

    // Handle WebLLM-specific initialization
    if (selectedProvider === 'webllm') {
        const isSupported = updateWebLlmStatus();
        if (isSupported) {
            loadWebLlmModels(settings);
        }
    }
}

/**
 * Shows a confirmation modal when enabling auto-sync on a chat with existing vectors
 * If multiple collections match, lets user pick which one to use
 * @param {Array} allMatches - Array of matching collections [{collectionId, registryKey, chunkCount, source, backend, sources}]
 * @param {object} settings - VectTauri settings for purge operations
 * @returns {Promise<{action: string, selectedCollection?: object}>} User's choice
 */
async function showAutoSyncConfirmModal(allMatches, settings) {
    // Import unified delete function for ghost cleanup
    const { deleteCollection } = await import('../core/collection-loader.js');

    return new Promise((resolve) => {
        const hasMultiple = allMatches.length > 1;
        const hasGhosts = allMatches.some(m => m.chunkCount === 0);

        // Build collection list HTML
        const collectionListHtml = allMatches.map((match, index) => {
            const displayId = match.collectionId.length > 35
                ? match.collectionId.substring(0, 18) + '...' + match.collectionId.substring(match.collectionId.length - 12)
                : match.collectionId;
            const isGhost = match.chunkCount === 0;
            const isRecommended = index === 0 && !isGhost;

            return `
                <div class="vecttauri-collection-option ${isGhost ? 'ghost' : ''}" data-index="${index}" style="
                    background: var(--SmartThemeBlurTintColor);
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 10px;
                    cursor: pointer;
                    border: 2px solid ${isRecommended ? 'var(--SmartThemeQuoteColor)' : 'transparent'};
                    opacity: ${isGhost ? '0.6' : '1'};
                    position: relative;
                ">
                    ${isRecommended ? '<span style="position: absolute; top: -8px; right: 10px; background: var(--SmartThemeQuoteColor); color: var(--SmartThemeBodyColor); font-size: 0.7em; padding: 2px 6px; border-radius: 4px;">RECOMMENDED</span>' : ''}
                    ${isGhost ? '<span style="position: absolute; top: -8px; right: 10px; background: var(--SmartThemeFontColorOverrideWarning, #f0ad4e); color: #000; font-size: 0.7em; padding: 2px 6px; border-radius: 4px;">GHOST</span>' : ''}
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-family: monospace; word-break: break-all; font-size: 0.85em; margin-bottom: 6px;">
                                ${displayId}
                            </div>
                            <div style="font-size: 0.8em; color: var(--SmartThemeQuoteColor);">
                                <i class="fa-solid fa-cube"></i> <strong>${match.chunkCount}</strong> chunks
                                ${match.source ? `<span style="margin-left: 10px;"><i class="fa-solid fa-database"></i> ${match.source}</span>` : ''}
                            </div>
                        </div>
                        ${isGhost ? `
                            <button class="menu_button menu_button_icon vecttauri-delete-ghost" data-index="${index}" style="margin-left: 10px; color: var(--SmartThemeFontColorOverrideWarning, #f0ad4e);" title="Delete this ghost collection">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        const modalHtml = `
            <div id="VectTauri_autosync_confirm_modal" class="vecttauri-modal" style="display: flex;">
                <div class="vecttauri-modal-content" style="max-width: 500px;">
                    <div class="vecttauri-modal-header">
                        <h3><i class="fa-solid fa-link"></i> ${hasMultiple ? 'Multiple Collections Found' : 'Existing Collection Found'}</h3>
                        <button class="vecttauri-modal-close" data-action="cancel">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                    <div class="vecttauri-modal-body" style="padding: 20px;">
                        <p style="margin-bottom: 15px;">
                            ${hasMultiple
                                ? `Found <strong>${allMatches.length}</strong> collections matching this chat.${hasGhosts ? ' <span style="color: var(--SmartThemeFontColorOverrideWarning, #f0ad4e);">Ghost collections (0 chunks) can be deleted.</span>' : ''}`
                                : 'This chat already has a vectorized collection:'}
                        </p>
                        <div style="max-height: 300px; overflow-y: auto; margin-bottom: 15px;">
                            ${collectionListHtml}
                        </div>
                        <p style="margin-bottom: 10px; font-size: 0.9em; color: var(--SmartThemeQuoteColor);">
                            ${hasMultiple ? 'Click a collection to select it, then choose an action.' : 'What would you like to do?'}
                        </p>
                    </div>
                    <div class="vecttauri-modal-footer" style="display: flex; gap: 10px; padding: 15px 20px; border-top: 1px solid var(--SmartThemeBorderColor);">
                        <button class="menu_button" data-action="reconnect" style="flex: 1;">
                            <i class="fa-solid fa-plug"></i> Connect
                        </button>
                        <button class="menu_button" data-action="revectorize" style="flex: 1;">
                            <i class="fa-solid fa-rotate"></i> Re-vectorize
                        </button>
                        <button class="menu_button menu_button_icon" data-action="cancel">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const $modal = $(modalHtml);
        $('body').append($modal);

        // Track selected collection (default to first/best)
        let selectedIndex = 0;
        $modal.find('.vecttauri-collection-option').first().css('border-color', 'var(--SmartThemeQuoteColor)');

        // Handle collection selection
        $modal.find('.vecttauri-collection-option').on('click', function(e) {
            if ($(e.target).closest('.vecttauri-delete-ghost').length) return; // Don't select when clicking delete

            selectedIndex = parseInt($(this).data('index'));
            $modal.find('.vecttauri-collection-option').css('border-color', 'transparent');
            $(this).css('border-color', 'var(--SmartThemeQuoteColor)');
        });

        // Handle ghost deletion - uses unified deleteCollection()
        $modal.find('.vecttauri-delete-ghost').on('click', async function(e) {
            e.stopPropagation();
            const index = parseInt($(this).data('index'));
            const ghost = allMatches[index];

            if (!confirm(`Delete ghost collection?\n\n${ghost.collectionId}\n\nThis will remove it from disk.`)) return;

            try {
                // Use unified delete function - handles vectors, registry, AND metadata.
                // Route to the ghost's own backend and on-disk source folders, not
                // the current backend/provider settings.
                const deleteSettings = {
                    ...settings,
                    vector_backend: ghost.backend,
                    _discoveredSources: ghost.sources,
                };
                const result = await deleteCollection(ghost.collectionId, deleteSettings, ghost.registryKey);

                // Remove from UI
                allMatches.splice(index, 1);
                $(this).closest('.vecttauri-collection-option').fadeOut(200, function() {
                    $(this).remove();
                    // Re-index remaining items
                    $modal.find('.vecttauri-collection-option').each((i, el) => {
                        $(el).attr('data-index', i);
                        $(el).find('.vecttauri-delete-ghost').attr('data-index', i);
                    });
                });

                if (result.success) {
                    toastr.success('Ghost collection deleted', 'VectTauri');
                } else {
                    toastr.warning(`Partial deletion: ${result.errors.join(', ')}`, 'VectTauri');
                }

                // If no collections left, close modal
                if (allMatches.length === 0) {
                    $modal.remove();
                    resolve({ action: 'revectorize' });
                } else if (selectedIndex >= allMatches.length) {
                    selectedIndex = 0;
                    $modal.find('.vecttauri-collection-option').first().css('border-color', 'var(--SmartThemeQuoteColor)');
                }
            } catch (error) {
                log.error('VectTauri: Failed to delete ghost', error);
                toastr.error('Failed to delete ghost collection', 'VectTauri');
            }
        });

        // Handle action buttons
        $modal.find('[data-action]').on('click', function() {
            const action = $(this).data('action');
            $modal.remove();
            resolve({
                action,
                selectedCollection: action === 'reconnect' ? allMatches[selectedIndex] : null
            });
        });

        // Stop mousedown propagation (ST closes drawers on mousedown/touchstart)
        $modal.on('mousedown touchstart', function(e) {
            e.stopPropagation();
        });

        // Close on background click
        $modal.on('click', function(e) {
            if (e.target === this) {
                $modal.remove();
                resolve({ action: 'cancel' });
            }
        });

        // Handle escape key
        $(document).one('keydown.autosync_modal', function(e) {
            if (e.key === 'Escape') {
                $modal.remove();
                resolve({ action: 'cancel' });
            }
        });
    });
}

/**
 * Delete a shared VectTauri API key from ST's secret store and refresh every input that
 * displays it. ONE implementation reused by all "Clear saved key" buttons (Embedding /
 * Summarization / AgentMode, OpenRouter + vLLM) so the delete + refresh logic never drifts.
 *
 * Deletes the ACTIVE entry in each slot (the masked key the UI shows); vLLM/Custom keys live
 * in two slots (CUSTOM for chat-side, VLLM for embedding-side) so both are cleared. The
 * placeholder refresh rides the existing `vecttauri:*-key-changed` document events that every
 * placeholder updater already listens to — so all three places re-render from one trigger.
 *
 * @param {{ slots: string[], changedEvent: string, label: string, getCurrent: () => string, sharedWithST?: boolean }} opts
 */
async function clearSharedApiKey({ slots, changedEvent, label, getCurrent, sharedWithST = false }) {
    if (typeof getCurrent === 'function' && !getCurrent()) {
        toastr.info(`No ${label} API key is saved.`);
        return;
    }
    const warn = sharedWithST
        ? `\n\nThis is the same secret slot SillyTavern itself uses, so deleting it also affects your main chat if that's set to ${label}.`
        : '';
    if (!confirm(`Delete the saved ${label} API key?\n\nIt is shared across Embedding, Summarization, and AgentMode.${warn}\n\nThis cannot be undone.`)) {
        return;
    }
    const failed = [];
    for (const slot of slots) {
        try {
            await deleteSecret(slot); // no id → removes the active entry; clears the slot if it was the last
        } catch (err) {
            log.error(`[VectTauri] deleteSecret(${slot}) failed:`, err);
            failed.push(slot);
        }
    }
    try { await readSecretState(); } catch { /* deleteSecret already refreshes secret_state */ }
    $(document).trigger(changedEvent); // every placeholder updater re-renders from this
    if (failed.length) {
        toastr.error(`Failed to delete ${label} key — see console.`);
    } else {
        toastr.info(`${label} API key deleted.`);
    }
}

/**
 * Binds event handlers to UI elements
 * @param {object} settings - VectTauri settings object
 * @param {object} callbacks - Callback functions
 */
function bindSettingsEvents(settings, callbacks) {
    // Forward-declared so the vector-backend change handler can call it; the
    // real implementation is assigned later when the EventBase weight inputs
    // are wired up. The optional-call `?.()` at the call site guards against
    // any backend-change event that fires before assignment.
    let _refreshCosineWeightAvailability = null;
    // Forward-declared like the cosine helper above. Hides the Summarizer
    // Injection group on standard+no-plugin (its listChunks returns no metadata).
    let _refreshSummarizerInjectionAvailability = null;

    // Master switch — global enable/disable. Reads core/feature-gate.js::isVectTauriEnabled
    // so the UI and the runtime gates agree. Dims the rest of the panel when off as a
    // visual cue.
    const $masterSwitch = $('#VectTauri_master_enabled');
    const _applyMasterSwitchUI = (on) => {
        $('#VectTauri_settings .vecttauri-tabs, #VectTauri_settings .vecttauri-card')
            .css({ opacity: on ? '' : '0.5' });
    };
    $masterSwitch
        .prop('checked', isVectTauriEnabled(settings))
        .on('change', async function() {
            const on = $(this).prop('checked');
            settings.enabled = on;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            _applyMasterSwitchUI(on);
            toastr.info(on ? 'VectTauri enabled' : 'VectTauri disabled', 'VectTauri');
            log.lifecycle(`VectTauri: master switch ${on ? 'ON' : 'OFF'}`);

            if (!on) {
                // Take every VectTauri block out of the prompt now. ST keeps extension
                // prompts until they are overwritten, and quiet generations skip the
                // interceptor that would otherwise clear them.
                clearInterceptorPrompts(settings);
                clearLorebookPrompt(settings);
                await refreshAutoSyncCheckbox(settings); // shows auto-sync as paused
                return;
            }

            // Switching back ON: redo the work skipped while off, so VectTauri works
            // without a page reload. The ghosting WI-scan floor goes first — the next
            // generation may read it.
            await refreshWorldInfoEntryDepthCache(settings);

            // Off-box startup work. Two of its steps don't self-heal on demand — the
            // EventBase payload-index backfill is one-shot-per-install, and collection
            // discovery refreshes the registry that the Database Browser, cross-chat
            // retrieval and the auto-sync status read. See core/network-startup.js for
            // the full rationale.
            try {
                await runNetworkStartup(settings);
            } catch (error) {
                log.warn('VectTauri: backend/network startup after re-enable failed:', error?.message || error);
            }
            await refreshAutoSyncCheckbox(settings);
            await refreshHealthIndicator(); // its load-time probe is skipped while off
        });
    _applyMasterSwitchUI(isVectTauriEnabled(settings));

    /**
     * Turn Summarizer Injection off, because auto-sync — its data source — is not
     * running. Without auto-sync the collection stops tracking the chat, so
     * "the most recent N events" silently becomes some older N: the injection
     * keeps firing and feeds the model information that is simply wrong. Off is
     * the only safe state.
     *
     * Called from every path that leaves auto-sync off, including the two that
     * REFUSE to turn it on (no chat / no collection). Those return early, so
     * they used to skip the disable branch below — which is how the summarizer
     * could sit checked next to an unchecked auto-sync.
     *
     * @param {string} reason - shown to the user, completing "Summarizer Injection disabled (…)"
     */
    /**
     * Chat id whose auto-sync the user asked to turn on, but which had no
     * collection yet — so they were sent to Vectorize Content first. Consumed
     * when that vectorization succeeds, cleared if they close the panel instead.
     *
     * Needed because the redirect is where the user's intent would otherwise be
     * lost: they ticked the box, got taken somewhere else, finished the work the
     * box required, and came back to it still unticked.
     *
     * Chat-scoped so an intent from one chat can never enable auto-sync on
     * another; null when nothing is pending.
     * @type {string|null}
     */
    let _autoSyncEnableAwaitingVectorizeForChat = null;

    const _disableSummarizerInjectionBecauseAutoSyncIsOff = (reason) => {
        if (!settings.summarizer_injection_enabled) return;
        settings.summarizer_injection_enabled = false;
        Object.assign(extension_settings.vecttauri, settings);
        saveSettingsDebounced();
        $('#VectTauri_summarizer_injection_enabled').prop('checked', false);
        _applySummarizerLock();
        toastr.info(`Summarizer Injection disabled (${reason})`);
    };

    // Auto-sync enable/disable - now per-collection instead of global
    // Initial state is set by refreshAutoSyncCheckbox() after chat loads
    $('#VectTauri_autosync_enabled')
        .on('input', async function() {
            const enabling = $(this).prop('checked');
            const $checkbox = $(this);

            const { getChatAutoSyncStatus } = await import('../core/eventbase-workflow.js');
            const { setCollectionAutoSync, setCollectionLock } = await import('../core/collection-metadata.js');
            let status = await getChatAutoSyncStatus(settings);
            const chatId = getCurrentChatId();
            log.lifecycle(`[AutoSync][checkbox] ${enabling ? 'CHECK' : 'UNCHECK'} → status.state=${status.state}, chatId=${chatId || '(none)'}, collection=${status.registryKey || status.collectionId || '(none)'}`);

            if (status.state === 'no-chat') {
                toastr.warning('Open a chat first before enabling auto-sync');
                $checkbox.prop('checked', false);
                _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync');
                await refreshAutoSyncCheckbox(settings);
                return;
            }

            if (enabling) {
                if (status.state === 'no-collection') {
                    // A branch or checkpoint can take its parent's events instead of
                    // re-extracting the shared history.
                    const forkChoice = await _offerEventBaseFork(settings);
                    if (forkChoice === 'cancel') {
                        $checkbox.prop('checked', false);
                        _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync');
                        await refreshAutoSyncCheckbox(settings);
                        return;
                    }
                    if (forkChoice === 'forked') {
                        status = await getChatAutoSyncStatus(settings);
                        log.lifecycle(`[AutoSync][checkbox] forked → status.state=${status.state}, collection=${status.registryKey || status.collectionId || '(none)'}`);
                        if (status.state === 'no-collection') {
                            log.error('[AutoSync][checkbox] fork finished but resolveEventBaseWriteTarget still finds no collection — see [EventBase][resolve] log above');
                            toastr.error('The forked EventBase is not recognized as this chat\'s collection. Check the console log.', 'Auto-sync not enabled');
                            $checkbox.prop('checked', false);
                            _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync');
                            await refreshAutoSyncCheckbox(settings);
                            return;
                        }
                    }
                }
                if (status.state === 'no-collection') {
                    // No collection for this chat yet — send the user to vectorize first.
                    log.lifecycle('[AutoSync][checkbox] state=no-collection → redirecting to Vectorize Content (resolveEventBaseWriteTarget found no eligible collection — see [EventBase][resolve] log above)');
                    $checkbox.prop('checked', false);
                    toastr.info('Vectorize your chat history first — auto-sync will turn on when it finishes');
                    _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync, which needs a vectorized chat');
                    // Remember the intent across the redirect so a finished
                    // vectorization resumes the enable the user actually asked for.
                    _autoSyncEnableAwaitingVectorizeForChat = chatId;
                    openContentVectorizer('chat');
                    return;
                }
                // Collection exists (partial or fully-vectorized).
                // Use registry-key form ("backend:id") so metadata writes land in the
                // same bucket as the loader/import path.
                const lockKey = status.registryKey || status.collectionId;

                // --- Backlog catch-up gate ---
                // Auto-sync backfills the whole gap (tip → now) on its next trigger —
                // for a large gap that's a surprise burst of LLM calls. So for a big
                // gap, confirm first: run the catch-up now (with progress) or skip it
                // ("just keep up from here"). Small gaps catch up silently as before.
                // See plans/autosync-backlog-catchup-on-enable.md.
                let markerFloorOverride; // undefined → smart placement (catch up to tip)
                try {
                    const { getVectorizationTip } = await import('../core/eventbase-store.js');
                    const { getAutoSyncWindowSize } = await import('../core/eventbase-workflow.js');
                    const { getChatUUID } = await import('../core/collection-ids.js');
                    const uuid = getChatUUID();
                    const chatMsgCount = typeof status.chatMessageCount === 'number'
                        ? status.chatMessageCount
                        : (getContext()?.chat || []).filter(m => m.mes && m.mes.trim().length > 0).length;
                    const tip = getVectorizationTip(uuid) ?? 0;
                    const windowSize = Math.max(1, getAutoSyncWindowSize(settings));
                    // Clamp the backlog to the commit boundary — the active last turn is
                    // held back by the settle-lag and settles on its own, so it isn't
                    // "pending backlog". See plans/executed/autosync-settle-lag.md.
                    const boundary = typeof status.commitBoundary === 'number' ? status.commitBoundary : chatMsgCount;
                    const pendingMsgs = Math.max(0, boundary - tip);
                    const pendingWindows = Math.floor(pendingMsgs / windowSize);
                    const CATCHUP_PROMPT_THRESHOLD = 5; // windows (~5 LLM calls)

                    if (pendingWindows >= CATCHUP_PROMPT_THRESHOLD) {
                        const popup = await import('../../../../popup.js');
                        const { callGenericPopup, POPUP_TYPE } = popup;
                        const POPUP_RESULT = popup.POPUP_RESULT || { AFFIRMATIVE: 1, NEGATIVE: 0 };
                        const choice = await callGenericPopup(
                            `<div style="text-align:left">
                                <p><strong>${pendingMsgs} messages aren't vectorized yet</strong> (~${pendingWindows} extraction call${pendingWindows === 1 ? '' : 's'}).</p>
                                <p>Auto-sync will catch up this backlog. Run it now — with a progress bar you can cancel — or just keep up from here on?</p>
                            </div>`,
                            POPUP_TYPE.CONFIRM,
                            '',
                            { okButton: 'Catch up now', cancelButton: 'Just keep up from here' },
                        );
                        if (choice === POPUP_RESULT.AFFIRMATIVE) {
                            // Run the backfill now with the standard progress UI (full-screen
                            // on mobile). Resolves at extraction completion; the marker then
                            // lands at the freshly-advanced tip (smart placement below).
                            const { backfillCurrentChatWithProgress } = await import('./content-vectorizer.js');
                            await backfillCurrentChatWithProgress();
                        } else if (choice === POPUP_RESULT.NEGATIVE) {
                            // Keep up from here — skip the backlog (floor the marker at "now").
                            markerFloorOverride = 'chatLength';
                        } else {
                            // X / Esc — abort enabling entirely.
                            $checkbox.prop('checked', false);
                            _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync');
                            await refreshAutoSyncCheckbox(settings);
                            return;
                        }
                    }
                } catch (err) {
                    log.warn('[VectTauri] auto-sync backlog gate failed (continuing with default placement):', err?.message || err);
                }

                // Lock + enable (every non-revert path).
                setCollectionLock(lockKey, chatId);
                setCollectionAutoSync(lockKey, true);

                // Stamp the auto-sync start marker for this chat. Prevents the
                // window-fingerprint dedup cache from triggering a full chat
                // re-extraction when the user changed window_size before enabling
                // auto-sync. See plans/autosync-independent-window-and-last-n-injection.md §9.
                // Smart placement: stamps at max(source_window_end)+1 when events
                // exist (backfills the gap at the new window size), or at current
                // chat length when collection is empty. markerFloorOverride='chatLength'
                // forces from-now-on when the user chose "just keep up from here".
                try {
                    const { stampAutoSyncMarker } = await import('../core/eventbase-store.js');
                    const { getChatUUID } = await import('../core/collection-ids.js');
                    const uuid = getChatUUID();
                    if (uuid) await stampAutoSyncMarker(uuid, settings, markerFloorOverride ? { floor: markerFloorOverride } : {});
                } catch (err) {
                    log.warn('[VectTauri] Failed to stamp auto-sync marker on enable:', err?.message || err);
                }

                const message = status.state === 'fully-vectorized'
                    ? 'Auto-sync enabled — chat is fully synced'
                    : 'Auto-sync enabled — will catch up on next trigger';
                toastr.success(message);
                log.lifecycle(`VectTauri: Chat auto-sync ENABLED for ${lockKey} (state=${status.state})`);
            } else {
                // Reverse of the forward bind in the summarizer checkbox handler; the
                // injection self-clears on its next (now-disabled) turn.
                _disableSummarizerInjectionBecauseAutoSyncIsOff('needs auto-sync');

                // Uncheck — clear ONLY the auto-sync flag. Do NOT touch the chat
                // lock: the lock is a separate concern (it marks the collection
                // "active for this chat" for retrieval too, and the user may have
                // set it deliberately via the DB Browser). Removing it here surprised
                // users by deactivating a collection they only wanted to stop
                // auto-syncing. Unlocking is the DB Browser's job, not this toggle's.
                if (status.state !== 'no-collection') {
                    const lockKey = status.registryKey || status.collectionId;
                    setCollectionAutoSync(lockKey, false);

                    // Clear the marker so re-enabling later re-computes a fresh one
                    // against whatever collection state exists at that time.
                    try {
                        const { clearAutoSyncMarker } = await import('../core/eventbase-store.js');
                        const { getChatUUID } = await import('../core/collection-ids.js');
                        const uuid = getChatUUID();
                        if (uuid) clearAutoSyncMarker(uuid);
                    } catch (err) {
                        log.warn('[VectTauri] Failed to clear auto-sync marker on disable:', err?.message || err);
                    }

                    toastr.info('Auto-sync disabled for this chat');
                    log.lifecycle(`VectTauri: Chat auto-sync DISABLED for ${lockKey}`);
                }
            }

            await refreshAutoSyncCheckbox(settings);
            document.dispatchEvent(new CustomEvent('vecttauri:collections-updated'));
        });

        // Collection lock handled inside Database Browser per-collection settings

    // LEGACY CHAT CHUNKING STRATEGIES NOTE:
    // *** will be remove in future version because no longer used by eventbased path ***
    // The old chat chunking strategy selector and related batch/group-batch sliders were
    // removed from the GUI because chat auto-sync now follows EventBase extraction settings.
    // Keep the underlying settings fields for backward compatibility / migration only.

    // Summarization provider
    const updateSummarizeUI = (provider) => {
        $('#VectTauri_summarize_settings').show();
        $('#VectTauri_summarize_openrouter_row').toggle(provider === 'openrouter');
        // vLLM and Custom share the same Base URL + API key inputs — both are
        // OpenAI-compatible endpoints routed through ST's 'custom' source.
        $('#VectTauri_summarize_vllm_url_row').toggle(provider === 'vllm' || provider === 'custom');
    };
    $('#VectTauri_summarize_provider')
        .val(settings.chat_provider || 'openrouter')
        .on('change', function() {
            settings.chat_provider = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            // Write-through mirror (sync): survives app-switch/kill before the
            // debounced settings save flushes — see utils/llm-config-store.js.
            saveLlmConfigFields({ chat_provider: settings.chat_provider });
            saveSettingsDebounced();
            updateSummarizeUI(settings.chat_provider);
        });
    updateSummarizeUI(settings.chat_provider || 'openrouter');

    $('#VectTauri_summarize_model')
        .val(settings.chat_model || '')
        .on('input change', function() {
            // Bind 'input' too — 'change' alone only fires on blur, so clicking Vectorize
            // immediately after typing would skip the save.
            settings.chat_model = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveLlmConfigFields({ chat_model: settings.chat_model });
            saveSettingsDebounced();
        });

    // Request-shape switches for reasoning models. Global on purpose — they
    // describe the chat endpoint, not one feature, and every LLM path reads them
    // through resolveModelParameterStyle(). See core/llm-provider-call.js.
    $('#VectTauri_should_send_temperature')
        .prop('checked', settings.should_send_temperature !== false)
        .on('change', function() {
            settings.should_send_temperature = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveLlmConfigFields({ should_send_temperature: settings.should_send_temperature });
            saveSettingsDebounced();
        });

    $('#VectTauri_should_use_max_completion_tokens')
        .prop('checked', settings.should_use_max_completion_tokens === true)
        .on('change', function() {
            settings.should_use_max_completion_tokens = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveLlmConfigFields({ should_use_max_completion_tokens: settings.should_use_max_completion_tokens });
            saveSettingsDebounced();
        });

    $('#VectTauri_should_disable_thinking')
        .prop('checked', settings.should_disable_thinking !== false)
        .on('change', function() {
            settings.should_disable_thinking = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveLlmConfigFields({ should_disable_thinking: settings.should_disable_thinking });
            saveSettingsDebounced();
        });

    // "Choose" button — fetches model list from the configured provider and populates a dropdown
    $('#VectTauri_summarize_model_choose').on('click', async function() {
        const $btn = $(this);
        const $list = $('#VectTauri_summarize_model_list');
        const $input = $('#VectTauri_summarize_model');
        const provider = settings.chat_provider || 'openrouter';

        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Loading…');

        try {
            let models = [];

            if (provider === 'openrouter') {
                // OpenRouter /models is a public endpoint — no auth required for listing
                const resp = await fetch('https://openrouter.ai/api/v1/models', { method: 'GET' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                models = (data?.data || []).map(m => ({ id: m.id, label: m.name ? `${m.id} — ${m.name}` : m.id }));
            } else if (provider === 'vllm' || provider === 'custom') {
                // Send the URL verbatim (trailing slash trimmed only). ST's /status
                // does urlJoin(custom_url, '/models'), appending '/models' to exactly
                // what we pass — it does NOT re-insert a version segment. Stripping a
                // trailing '/v1' here made ST call <host>/models instead of
                // <host>/v1/models, breaking model listing on every standard
                // OpenAI-compatible endpoint (vLLM, OpenRouter, etc.). The summarizer
                // and embedding call sites already pass the user's '/v1' through; this
                // matches them. See GitHub issue #8.
                const baseUrl = (settings.chat_vllm_url || '').trim().replace(/\/+$/, '');
                if (!baseUrl) {
                    toastr.error('Set the Base URL first.', 'Provider not configured');
                    return;
                }
                // Route through ST's chat-completions /status endpoint, which
                // fetches ${apiUrl}/models server-side using SECRET_KEYS.CUSTOM.
                // Direct browser fetch with Bearer would 401 here because the
                // key now lives in a masked secret slot (post-2026-05-26
                // migration). Same proxy pattern as _callVLLM.
                const resp = await fetch('/api/backends/chat-completions/status', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        chat_completion_source: 'custom',
                        custom_url: baseUrl,
                    }),
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                // ST's /status returns `{ error: true, data: <upstreamBody> }`
                // when the upstream endpoint rejects the request (auth, bad
                // URL, etc.). Surface the upstream detail so the user can act
                // on it — generic "fetch failed" hides which side broke.
                if (data?.error === true) {
                    const detail = data.data
                        ? (typeof data.data === 'string' ? data.data : JSON.stringify(data.data))
                        : '(no detail returned)';
                    log.warn('[VectTauri] Upstream rejected model-list request:', data.data);
                    // Common cause is the endpoint not exposing /v1/models at all
                    // (siliconflow, some hosted vLLM-compatible providers do this
                    // even when /v1/chat/completions and /v1/embeddings work fine
                    // with the same key). Summarize still works — type the model
                    // name manually instead of using the Choose button.
                    throw new Error(`Upstream /v1/models rejected the request. Detail: ${detail.slice(0, 200)}. If embedding/summarize works with this URL+key, the endpoint probably just doesn't expose model listing — type the model name manually.`);
                }
                // OpenAI standard: `{ data: [...] }`, Cohere: `{ models: [...] }`,
                // some bare endpoints return an array directly.
                const arr = Array.isArray(data) ? data
                          : Array.isArray(data?.data) ? data.data
                          : Array.isArray(data?.models) ? data.models
                          : null;
                if (!arr) {
                    log.warn('[VectTauri] Model list response shape unrecognized:', data);
                    throw new Error(`Unrecognized model-list response shape (top-level keys: ${Object.keys(data || {}).join(',') || 'none'})`);
                }
                models = arr
                    .filter(m => m && (m.id || m.name))
                    .map(m => ({ id: m.id || m.name, label: m.id || m.name }));
            } else {
                toastr.warning(`Choose is not supported for provider "${provider}".`);
                return;
            }

            if (!models.length) {
                toastr.warning('Provider returned no models.');
                return;
            }

            models.sort((a, b) => a.id.localeCompare(b.id));

            const currentValue = String($input.val() || '').trim();
            const options = ['<option value="">— Select a model —</option>']
                .concat(models.map(m => {
                    const selected = m.id === currentValue ? ' selected' : '';
                    return `<option value="${$('<div>').text(m.id).html()}"${selected}>${$('<div>').text(m.label).html()}</option>`;
                }));

            $list.html(options.join('')).show();
            toastr.success(`Loaded ${models.length} models from ${provider}.`);
        } catch (err) {
            log.error('[VectTauri] Model list fetch failed:', err);
            toastr.error(`Could not fetch model list: ${err?.message || err}`);
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    $('#VectTauri_summarize_model_list').on('change', function() {
        const value = String($(this).val() || '').trim();
        if (!value) return;
        $('#VectTauri_summarize_model').val(value).trigger('change');
        $(this).hide();
    });

    $('#VectTauri_summarize_vllm_url')
        .val(settings.chat_vllm_url || '')
        .on('change', function() {
            settings.chat_vllm_url = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveLlmConfigFields({ chat_vllm_url: settings.chat_vllm_url });
            saveSettingsDebounced();
        });

    // vLLM API key (summarize input) — writes to SECRET_KEYS.CUSTOM
    // 2026-05-26 architecture pivot: ONE vLLM key shared across
    // summarize/agentic chat paths, stored in ST's well-known
    // SECRET_KEYS.CUSTOM slot (same slot ST's own Chat Completion →
    // Custom (OpenAI-compatible) source uses). Real key lives server-side;
    // client only sees a masked placeholder. Chat-side calls route through
    // ST's /api/backends/chat-completions/generate proxy with
    // `chat_completion_source: 'custom'` — see core/api-keys.js for the
    // full rationale and the migration history.
    //
    // Embedding side reads SECRET_KEYS.VLLM (separate ST slot) — user
    // configures that key in ST's Text Completion → vLLM UI directly,
    // not through VectTauri. The two slots are intentionally separate so
    // chat and embedding endpoints can use different credentials if the
    // user wants.
    //
    // Cross-input refresh: each display function also listens for the
    // `vecttauri:vllm-key-changed` custom event, so saving the key in any
    // of the three inputs updates all three placeholders.
    const updateSummarizeVllmKeyDisplay = () => {
        const savedKey = getCustomApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_summarize_vllm_apikey').attr('placeholder', `Key saved: ${masked} (shared with Embedding + AgentMode)`);
        } else {
            $('#VectTauri_summarize_vllm_apikey').attr('placeholder', 'Paste vLLM / Custom OpenAI-compatible key (shared with Embedding + AgentMode)');
        }
    };
    updateSummarizeVllmKeyDisplay();
    $(document).on('vecttauri:vllm-key-changed', updateSummarizeVllmKeyDisplay);
    $('#VectTauri_summarize_vllm_apikey').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            // Dual-write: CUSTOM (chat-side proxy) + VLLM (embedding-side
            // proxy). One key, both slots. Either failure is non-fatal — toast
            // the user which side didn't land so they can manually re-enter
            // via ST's UI if needed.
            const errors = [];
            try {
                await writeSecret(SECRET_KEYS.CUSTOM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.CUSTOM) failed:', err);
                errors.push('chat-side (CUSTOM)');
            }
            try {
                await writeSecret(SECRET_KEYS.VLLM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.VLLM) failed:', err);
                errors.push('embedding-side (VLLM)');
            }
            await readSecretState();
            if (errors.length === 0) {
                toastr.success('vLLM API key saved (shared across embedding/summarize/agentic)');
            } else if (errors.length === 2) {
                toastr.error('Failed to save vLLM key to either slot — see console');
                return;
            } else {
                toastr.warning(`vLLM key partially saved — ${errors.join(', ')} write failed. See console.`);
            }
            $(this).val('');
            $(document).trigger('vecttauri:vllm-key-changed');
        }
    });

    // OpenRouter API key (summarize input) — writes to SECRET_KEYS.OPENROUTER
    // 2026-05-25: ONE OpenRouter key shared across embedding/summarize/agentic,
    // stored in ST's well-known SECRET_KEYS.OPENROUTER slot (same slot ST's own
    // Connection Profile uses). The real key value lives server-side; the client
    // only ever sees a masked placeholder. Chat-completion calls are routed
    // through ST's /api/backends/chat-completions/generate proxy so the server
    // can read the real key — see core/api-keys.js for the full rationale.
    //
    // Cross-input refresh: each display function also listens for the
    // `vecttauri:openrouter-key-changed` custom event, so saving the key in any
    // of the three inputs updates all three placeholders immediately.
    const updateSummarizeORKeyDisplay = () => {
        const savedKey = getOpenRouterApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_summarize_openrouter_apikey').attr('placeholder', `Key saved: ${masked} (shared with Embedding + AgentMode)`);
        } else {
            $('#VectTauri_summarize_openrouter_apikey').attr('placeholder', 'Paste OpenRouter key (shared with Embedding + AgentMode)');
        }
    };
    updateSummarizeORKeyDisplay();
    $(document).on('vecttauri:openrouter-key-changed', updateSummarizeORKeyDisplay);
    $('#VectTauri_summarize_openrouter_apikey').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            try {
                await writeSecret(SECRET_KEYS.OPENROUTER, value);
                await readSecretState();
                toastr.success('OpenRouter API key saved (shared across embedding/summarize/agentic)');
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.OPENROUTER) failed:', err);
                toastr.error('Failed to save OpenRouter key — see console');
                return;
            }
            $(this).val('');
            $(document).trigger('vecttauri:openrouter-key-changed');
        }
    });

    // ─── AgentMode (Agentic Retrieval) ─────────────────────────────────────
    // Toggle provider-specific rows in the AgentMode tab. Treats empty provider
    // as "inherit from summarizer" — both row blocks hide in that case so the
    // user is reminded inheritance is in effect.
    const updateAgenticUI = (provider) => {
        const resolved = String(provider || '').trim();
        $('#VectTauri_agentic_openrouter_row').toggle(resolved === 'openrouter');
        $('#VectTauri_agentic_vllm_row').toggle(resolved === 'vllm');
    };

    $('#VectTauri_agentic_retrieval_enabled')
        .prop('checked', !!settings.agentic_retrieval_enabled)
        .on('change', function() {
            settings.agentic_retrieval_enabled = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_agentic_provider')
        .val(settings.agent_provider || '')
        .on('change', function() {
            settings.agent_provider = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            updateAgenticUI(settings.agent_provider);
        });
    updateAgenticUI(settings.agent_provider || '');

    $('#VectTauri_agentic_model')
        .val(settings.agent_model || '')
        .on('input change', function() {
            settings.agent_model = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // AgentMode OpenRouter input — writes to SECRET_KEYS.OPENROUTER
    // (same shared slot as Embedding + Summarize inputs). Per the 2026-05-25
    // architecture pivot, the "override" semantics are gone — there's now
    // ONE OpenRouter key everywhere.
    const updateAgenticORKeyDisplay = () => {
        const savedKey = getOpenRouterApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_agentic_openrouter_apikey').attr('placeholder', `Key saved: ${masked} (shared with Embedding + Summarize)`);
        } else {
            $('#VectTauri_agentic_openrouter_apikey').attr('placeholder', 'Paste OpenRouter key (shared with Embedding + Summarize)');
        }
    };
    updateAgenticORKeyDisplay();
    $(document).on('vecttauri:openrouter-key-changed', updateAgenticORKeyDisplay);
    $('#VectTauri_agentic_openrouter_apikey').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            try {
                await writeSecret(SECRET_KEYS.OPENROUTER, value);
                await readSecretState();
                toastr.success('OpenRouter API key saved (shared across embedding/summarize/agentic)');
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.OPENROUTER) failed:', err);
                toastr.error('Failed to save OpenRouter key — see console');
                return;
            }
            $(this).val('');
            $(document).trigger('vecttauri:openrouter-key-changed');
        }
    });

    $('#VectTauri_agentic_vllm_url')
        .val(settings.agent_vllm_url || '')
        .on('change', function() {
            settings.agent_vllm_url = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // AgentMode vLLM input — writes to SECRET_KEYS.CUSTOM (shared with
    // Summarize input). Same architecture as the Summarize input above:
    // chat-side routes through ST's chat-completions proxy with
    // `chat_completion_source: 'custom'`; embedding-side reads
    // SECRET_KEYS.VLLM (ST's Text Completion vLLM slot) separately.
    const updateAgenticVllmKeyDisplay = () => {
        const savedKey = getCustomApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_agentic_vllm_apikey').attr('placeholder', `Key saved: ${masked} (shared with Embedding + Summarize)`);
        } else {
            $('#VectTauri_agentic_vllm_apikey').attr('placeholder', 'Paste vLLM / Custom OpenAI-compatible key (shared with Embedding + Summarize)');
        }
    };
    updateAgenticVllmKeyDisplay();
    $(document).on('vecttauri:vllm-key-changed', updateAgenticVllmKeyDisplay);
    $('#VectTauri_agentic_vllm_apikey').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            // Dual-write: same pattern as the summarize input above.
            const errors = [];
            try {
                await writeSecret(SECRET_KEYS.CUSTOM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.CUSTOM) failed:', err);
                errors.push('chat-side (CUSTOM)');
            }
            try {
                await writeSecret(SECRET_KEYS.VLLM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.VLLM) failed:', err);
                errors.push('embedding-side (VLLM)');
            }
            await readSecretState();
            if (errors.length === 0) {
                toastr.success('vLLM API key saved (shared across embedding/summarize/agentic)');
            } else if (errors.length === 2) {
                toastr.error('Failed to save vLLM key to either slot — see console');
                return;
            } else {
                toastr.warning(`vLLM key partially saved — ${errors.join(', ')} write failed. See console.`);
            }
            $(this).val('');
            $(document).trigger('vecttauri:vllm-key-changed');
        }
    });

    // "Clear saved key" buttons — all 6 (Embedding / Summarize / AgentMode × OpenRouter / vLLM)
    // funnel through the single clearSharedApiKey() helper so the delete + refresh never drifts.
    // OpenRouter keys share one slot; vLLM/Custom keys live in CUSTOM + VLLM (both cleared).
    const _openRouterClearOpts = {
        slots: [SECRET_KEYS.OPENROUTER],
        changedEvent: 'vecttauri:openrouter-key-changed',
        label: 'OpenRouter',
        getCurrent: () => getOpenRouterApiKey(settings),
        sharedWithST: true,
    };
    const _vllmClearOpts = {
        slots: [SECRET_KEYS.CUSTOM, SECRET_KEYS.VLLM],
        changedEvent: 'vecttauri:vllm-key-changed',
        label: 'vLLM',
        getCurrent: () => getCustomApiKey(settings),
        sharedWithST: true,
    };
    ['#VectTauri_openrouter_apikey_clear', '#VectTauri_summarize_openrouter_apikey_clear', '#VectTauri_agentic_openrouter_apikey_clear']
        .forEach(sel => $(sel).on('click', () => clearSharedApiKey(_openRouterClearOpts)));
    ['#VectTauri_vllm_api_key_clear', '#VectTauri_summarize_vllm_apikey_clear', '#VectTauri_agentic_vllm_apikey_clear']
        .forEach(sel => $(sel).on('click', () => clearSharedApiKey(_vllmClearOpts)));

    // Sliders — chat depth, candidates, max queries
    const bindAgenticSlider = (inputId, valSpanId, settingKey, defaultVal) => {
        const startVal = Number(settings[settingKey] ?? defaultVal);
        $(inputId).val(startVal);
        $(valSpanId).text(startVal);
        $(inputId).on('input', function() {
            const v = Number($(this).val());
            settings[settingKey] = v;
            $(valSpanId).text(v);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    };
    bindAgenticSlider('#VectTauri_agentic_chat_depth', '#VectTauri_agentic_chat_depth_val', 'agentic_retrieval_chat_depth', 3);
    bindAgenticSlider('#VectTauri_agentic_candidates', '#VectTauri_agentic_candidates_val', 'agentic_retrieval_candidates_to_show', 12);
    bindAgenticSlider('#VectTauri_agentic_max_queries', '#VectTauri_agentic_max_queries_val', 'agentic_retrieval_max_queries', 6);

    // Both clamp through the same resolvers the retrieval path uses, so what the
    // field accepts and what the budget honors can never drift apart.
    $('#VectTauri_agentic_timeout')
        .val(resolveAgenticPlannerTimeoutMs(settings))
        .on('change input', function() {
            settings.agentic_retrieval_timeout_ms = resolveAgenticPlannerTimeoutMs({ agentic_retrieval_timeout_ms: $(this).val() });
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_agentic_query_timeout')
        .val(resolveAgenticQueryTimeoutMs(settings))
        .on('change input', function() {
            settings.agentic_retrieval_query_timeout_ms = resolveAgenticQueryTimeoutMs({ agentic_retrieval_query_timeout_ms: $(this).val() });
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_agentic_max_tokens')
        .val(resolveAgenticMaxTokens(settings))
        .on('change input', function() {
            settings.agentic_retrieval_max_tokens = resolveAgenticMaxTokens({ agentic_retrieval_max_tokens: $(this).val() });
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_agentic_debug')
        .prop('checked', settings.debug_domain?.agent || false)
        .on('change', function() {
            if (!settings.debug_domain) settings.debug_domain = {};
            settings.debug_domain.agent = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_agentic_filters_enabled')
        .prop('checked', settings.agentic_filters_enabled !== false)
        .on('change', function() {
            settings.agentic_filters_enabled = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // ─── Auto-Reformat (Document/URL/Wiki LLM restructuring) ───────────────
    // Mirrors the AgentMode inherit-from-summarizer pattern above. No dedicated
    // API-key fields — reuses the same shared OpenRouter/vLLM key slots.
    const updateReformatProviderUI = (provider) => {
        const resolved = String(provider || '').trim();
        $('#VectTauri_reformat_vllm_row').toggle(resolved === 'vllm');
    };

    $('#VectTauri_reformat_provider')
        .val(settings.reformat_provider || '')
        .on('change', function() {
            settings.reformat_provider = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            updateReformatProviderUI(settings.reformat_provider);
        });
    updateReformatProviderUI(settings.reformat_provider || '');

    $('#VectTauri_reformat_model')
        .val(settings.reformat_model || '')
        .on('input change', function() {
            settings.reformat_model = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_reformat_vllm_url')
        .val(settings.reformat_vllm_url || '')
        .on('change', function() {
            settings.reformat_vllm_url = String($(this).val()).trim();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    const bindReformatSlider = (inputId, valSpanId, settingKey, defaultVal) => {
        const startVal = Number(settings[settingKey] ?? defaultVal);
        $(inputId).val(startVal);
        $(valSpanId).text(startVal);
        $(inputId).on('input', function() {
            const v = Number($(this).val());
            settings[settingKey] = v;
            $(valSpanId).text(v);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    };
    bindReformatSlider('#VectTauri_reformat_batch_chars', '#VectTauri_reformat_batch_chars_val', 'reformat_batch_chars', 6000);
    bindReformatSlider('#VectTauri_reformat_max_body_chars', '#VectTauri_reformat_max_body_chars_val', 'reformat_max_body_chars', 2000);
    bindReformatSlider('#VectTauri_reformat_name_fuzzy_threshold', '#VectTauri_reformat_name_fuzzy_threshold_val', 'reformat_name_fuzzy_threshold', 0.8);
    bindReformatSlider('#VectTauri_reformat_concurrency', '#VectTauri_reformat_concurrency_val', 'reformat_concurrency', 2);

    $('#VectTauri_reformat_timeout_ms')
        .val(Number(settings.reformat_timeout_ms ?? 90000))
        .on('change input', function() {
            const v = Number($(this).val());
            settings.reformat_timeout_ms = Math.max(10000, v || 90000);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_reformat_custom_prompt')
        .val(settings.reformat_custom_prompt || '')
        .on('change', function() {
            settings.reformat_custom_prompt = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Chunk size (for adaptive strategy)
    $('#VectTauri_chunk_size')
        .val(settings.chunk_size || 500)
        .on('input', function() {
            const value = Number($(this).val());
            settings.chunk_size = value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Helper: update visibility of native-hybrid-dependent UI elements
    function updateNativeHybridUI() {
        const backend       = settings.vector_backend || 'standard';
        const method        = settings.keyword_scoring_method || 'hybrid';
        const supportsNative = backend === 'qdrant';
        const preferNative  = settings.hybrid_native_prefer !== false;
        const nativeActive  = supportsNative && preferNative;        // A3
        const isHybridMode  = !nativeActive && method === 'hybrid';  // A2 (or Qdrant+prefer=false fallback)
        const isBM25Mode    = !nativeActive && method === 'bm25';    // A1

        // Keyword scoring method dropdown vs static "native active" notice
        $('#VectTauri_keyword_method_section').toggle(!nativeActive);
        $('#VectTauri_native_hybrid_info').toggle(nativeActive);

        // BM25 k1/b: visible whenever client-side BM25 logic runs (A1 or A2)
        $('#VectTauri_bm25_params').toggle(!nativeActive);

        // Fusion Method + RRF K: visible only for A2 (Standard + Hybrid). A3 (Qdrant) ignores
        // these — Qdrant always runs server-side RRF with its own internal k constant — so the
        // controls would just confuse Qdrant users.
        $('#VectTauri_hybrid_params').toggle(isHybridMode);

        // Query Keyword Budget (lives in ChunkBase tab): visible only in A1
        $('#VectTauri_hybrid_keyword_budget_wrapper').toggle(isBM25Mode);

        // Native rerank checkbox: Qdrant only
        $('#VectTauri_eventbase_native_rerank_wrapper').toggle(supportsNative);
    }

    // Apply backend-specific hybrid defaults when backend changes or on first load.
    // Only rewrites settings that make sense for the new backend — does not touch user-tuned values
    // like rrf_k, vector/text weights, or BM25 k1/b.
    function applyBackendHybridDefaults(backend) {
        const isNative = backend === 'qdrant';
        if (isNative) {
            // Qdrant: prefer native hybrid, RRF fusion
            settings.hybrid_native_prefer = true;
            settings.hybrid_fusion_method = settings.hybrid_fusion_method || 'rrf';
        } else {
            // Standard: no native hybrid, BM25 fast re-rank, RRF fusion
            settings.hybrid_native_prefer = false;
            settings.keyword_scoring_method = settings.keyword_scoring_method || 'hybrid';
            settings.hybrid_fusion_method = settings.hybrid_fusion_method || 'rrf';
        }
        // Sync UI controls
        $('#VectTauri_keyword_scoring_method').val(settings.keyword_scoring_method || 'hybrid');
        $('#VectTauri_hybrid_fusion_method').val(settings.hybrid_fusion_method || 'rrf');
        Object.assign(extension_settings.vecttauri, settings);
        saveSettingsDebounced();
    }

    // Helper: gate the Qdrant backend on the Similharity server plugin being
    // installed. Qdrant depends entirely on the plugin's /api/plugins/similharity/...
    // endpoints (and selecting it is what lets a qdrant_api_key get written into
    // extension settings), so when the plugin is absent we must prevent the user
    // from landing on Qdrant at all. Standard backend can fall back to ST's
    // native Vectors extension, but Qdrant cannot run without the plugin.
    //
    // Enforcement (called on init and after every dropdown change):
    //   1. Disable the <option value="qdrant"> so it can't be picked while the
    //      plugin is missing.
    //   2. If the current selection IS qdrant but the plugin is missing, revert
    //      to standard, persist it, and re-sync the dependent UI.
    //   3. Show/hide the red plugin-missing hint accordingly.
    // Returns true if it forced a revert (caller may need to re-run side effects).
    async function _refreshQdrantPluginAvailability() {
        const $err = $('#VectTauri_qdrant_plugin_error');
        const pluginUp = await checkPluginAvailable();

        // 1. Bar selecting Qdrant up front when the plugin is absent.
        $('#VectTauri_vector_backend option[value="qdrant"]').prop('disabled', !pluginUp);

        // Persistent "why is Qdrant disabled?" notice (with install link) —
        // visible whenever the plugin is missing, regardless of current backend.
        $('#VectTauri_qdrant_plugin_notice').toggle(!pluginUp);

        const backend = settings.vector_backend || 'standard';
        const mustRevert = backend === 'qdrant' && !pluginUp;

        // 3. Red hint visible only while we're (briefly) on qdrant without a plugin.
        if ($err.length) $err.toggle(mustRevert);

        // 2. Force the selection back to Standard.
        if (mustRevert) {
            settings.vector_backend = 'standard';
            $('#VectTauri_vector_backend').val('standard');
            $('#VectTauri_qdrant_settings').hide();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            toastr.error(
                'Qdrant requires the Similharity server plugin, which is not installed. Switched back to Standard (ST Vectra). Install the plugin to use Qdrant.',
                'VectTauri — Qdrant unavailable',
                { timeOut: 8000 }
            );
        }
        return mustRevert;
    }

    // Vector backend selection
    $('#VectTauri_vector_backend')
        .val(settings.vector_backend || 'qdrant')
        .on('change', async function() {
            settings.vector_backend = String($(this).val());

            // Show/hide Qdrant settings
            if (settings.vector_backend === 'qdrant') {
                $('#VectTauri_qdrant_settings').show();
            } else {
                $('#VectTauri_qdrant_settings').hide();
            }

            // Bar Qdrant when the plugin is missing: this shows a red alert and
            // reverts settings.vector_backend to 'standard' in place. Await it so
            // the dependent UI below syncs to the *effective* backend, not the
            // one the user briefly clicked.
            await _refreshQdrantPluginAvailability();

            // NOTE: standard backend is now safe to use with hedge, parallel-split,
            // and pipelined mode all enabled. The per-collection write queue in
            // backends/standard.js#_vectraWriteQueues serializes concurrent POSTs
            // to the same Vectra collection at the client side, so the plugin only
            // ever sees one in-flight insert per collection. Earlier versions of
            // this handler force-disabled those features on standard backend; that
            // enforcement was removed once the queue shipped (2026-05-30) because
            // users can now keep all three features on. The trade-off is that the
            // queue's serialization caps in-flight inserts to 1 per collection —
            // hedge duplicates queue rather than race, so they help less on standard
            // than on Qdrant. But the run no longer crashes, and total wall time
            // is still much better than the legacy batched-POST behavior under
            // OpenRouter timeouts.
            applyBackendHybridDefaults(settings.vector_backend);
            updateNativeHybridUI();
            log.lifecycle(`VectTauri: Vector backend changed to ${settings.vector_backend}`);
            // Reset health cache so new backend gets properly initialized
            resetBackendHealth();
            // Refresh Cosine weight availability — backend switch may have
            // moved us into or out of the "no vector scoring" state.
            _refreshCosineWeightAvailability?.();
            // Same for Summarizer Injection — hidden on standard+no-plugin.
            _refreshSummarizerInjectionAvailability?.();
        });

    // Qdrant cloud toggle.
    //
    // Visibility and re-initialization are deliberately SEPARATE. This used to be one
    // handler ending in `.trigger('change')`, which meant simply rendering the settings
    // panel reset backend health, eagerly initialized the Qdrant backend, pushed config
    // to the Similharity plugin, and popped a success toast — on every page load, even
    // with the VectTauri master switch off. Backend init is already lazy (getBackend →
    // initializeBackend), so nothing needs that eager call. Only a real user-driven
    // mode change should re-initialize.
    const applyQdrantModeVisibility = (useCloud) => {
        $('#VectTauri_qdrant_local_settings').toggle(!useCloud);
        $('#VectTauri_qdrant_cloud_settings').toggle(!!useCloud);
    };

    $('#VectTauri_qdrant_use_cloud')
        .prop('checked', settings.qdrant_use_cloud || false)
        .on('change', async function() {
            settings.qdrant_use_cloud = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();

            applyQdrantModeVisibility(settings.qdrant_use_cloud);

            // Reset backend health to force re-initialization with new config
            log.lifecycle('VectTauri: Qdrant mode changed, forcing re-initialization...');
            resetBackendHealth('qdrant');

            // Proactively reinitialize if Qdrant is the current backend
            if (settings.vector_backend === 'qdrant') {
                try {
                    const { initializeBackend } = await import('../backends/backend-manager.js');
                    await initializeBackend('qdrant', settings, false);
                    toastr.success(
                        `Qdrant re-initialized in ${settings.qdrant_use_cloud ? 'cloud' : 'local'} mode`,
                        'VectTauri'
                    );
                } catch (e) {
                    log.error('VectTauri: Failed to reinitialize Qdrant:', e);
                    toastr.warning('Failed to reinitialize Qdrant: ' + e.message, 'VectTauri');
                }
            }
        });

    // Initial state only — no health reset, no backend init, no toast.
    applyQdrantModeVisibility(settings.qdrant_use_cloud || false);

    // Qdrant settings
    $('#VectTauri_qdrant_host')
        .val(settings.qdrant_host || '127.0.0.1')
        .on('input', function() {
            settings.qdrant_host = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_qdrant_port')
        .val(settings.qdrant_port || 6333)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.qdrant_port = isNaN(value) ? 6333 : value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_qdrant_url')
        .val(settings.qdrant_url || '')
        .on('input', function() {
            settings.qdrant_url = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Qdrant API key — stored in ST's secret_state under custom slot
    // 'api_key_qdrant' (post-2026-05-26 migration). Client-side
    // secret_state filters non-enum slots, so the masked placeholder
    // comes from the plugin's /qdrant/key-status endpoint asynchronously.
    // Pre-migration users still on plaintext see their value masked from
    // settings.qdrant_api_key during the transition window.
    const updateQdrantKeyDisplay = async () => {
        const legacyPlaintext = getQdrantApiKey(settings);
        if (legacyPlaintext) {
            const masked = legacyPlaintext.length > 4
                ? '*'.repeat(Math.min(legacyPlaintext.length - 4, 8)) + legacyPlaintext.slice(-4)
                : '*'.repeat(legacyPlaintext.length);
            $('#VectTauri_qdrant_api_key').attr('placeholder', `Key saved: ${masked} (legacy plaintext, will migrate on next reload)`);
            return;
        }
        // No plaintext — check server-side presence via plugin endpoint.
        try {
            const presence = await fetchQdrantApiKeyPresence();
            if (presence.set) {
                $('#VectTauri_qdrant_api_key').attr('placeholder', `Key saved: ${presence.masked}`);
            } else {
                $('#VectTauri_qdrant_api_key').attr('placeholder', 'Your Qdrant Cloud API key');
            }
        } catch (err) {
            $('#VectTauri_qdrant_api_key').attr('placeholder', 'Your Qdrant Cloud API key (presence check unavailable)');
        }
    };
    updateQdrantKeyDisplay();
    $('#VectTauri_qdrant_api_key').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            try {
                await writeSecret('api_key_qdrant', value);
                // secret_state.api_key_qdrant won't appear (enum filter), so
                // skip readSecretState — the plugin endpoint is the source of
                // truth for presence now.
                toastr.success('Qdrant API key saved to secret_state');
            } catch (err) {
                log.error('[VectTauri] writeSecret(api_key_qdrant) failed:', err);
                toastr.error('Failed to save Qdrant key — see console');
                return;
            }
            $(this).val('');
            updateQdrantKeyDisplay();
        }
    });

    // Qdrant multitenancy toggle
    $('#VectTauri_qdrant_multitenancy')
        .prop('checked', settings.qdrant_multitenancy || false)
        .on('change', function() {
            settings.qdrant_multitenancy = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Show Qdrant settings if backend is qdrant
    if (settings.vector_backend === 'qdrant') {
        $('#VectTauri_qdrant_settings').show();
    }

    // On initial load: disable the Qdrant option when the plugin is absent and,
    // if the saved backend was Qdrant, revert to Standard (with a red alert).
    // When it reverts, re-sync the backend-dependent UI to Standard.
    _refreshQdrantPluginAvailability().then((reverted) => {
        if (reverted) {
            applyBackendHybridDefaults('standard');
            updateNativeHybridUI();
            resetBackendHealth();
            _refreshCosineWeightAvailability?.();
            _refreshSummarizerInjectionAvailability?.();
        }
    });

    // Embedding provider
    $('#VectTauri_source')
        .val(settings.embedding_provider)
        .on('change', function() {
            settings.embedding_provider = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            toggleProviderSettings(settings.embedding_provider, settings);
            log.lifecycle(`VectTauri: Embedding provider changed to ${settings.embedding_provider}`);
            // Reset health cache since provider change may affect backend connectivity
            resetBackendHealth();
        });

    // Score threshold
    $('#VectTauri_score_threshold')
        .val(settings.score_threshold)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.3 : value;
            $('#VectTauri_threshold_value').text(safeValue.toFixed(2));
            settings.score_threshold = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_threshold_value').text(settings.score_threshold.toFixed(2));

    // "Skip Already-Visible Events" (legacy key name: deduplication_depth).
    // Default 0 = filter disabled. See settings comment in index.js — the assumption
    // that the LLM sees the last N messages in raw form is usually wrong (~3-6 in
    // practice), so this is opt-in only.
    $('#VectTauri_deduplication_depth')
        .val(settings.deduplication_depth ?? 0)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 0 : Math.max(0, value);
            $('#VectTauri_deduplication_depth_value').text(safeValue);
            settings.deduplication_depth = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_deduplication_depth_value').text(settings.deduplication_depth ?? 0);

    // EventBase Dedup Window Gap — temporal proximity threshold for the
    // dedup gate in eventbase-retrieval.js. See settings comment in index.js.
    // 0 = temporal dedup fully disabled.
    $('#VectTauri_eventbase_dedup_window_gap')
        .val(settings.eventbase_dedup_window_gap ?? 10)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 10 : Math.max(0, Math.min(200, value));
            $('#VectTauri_eventbase_dedup_window_gap_val').text(safeValue);
            settings.eventbase_dedup_window_gap = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_eventbase_dedup_window_gap_val').text(settings.eventbase_dedup_window_gap ?? 10);

    // EventBase Anchor Boost — flat additive bonus on keyword-anchored events.
    // See settings comment in index.js and the boost code in
    // eventbase-retrieval.js (around the `_finalScore` formula).
    $('#VectTauri_eventbase_anchor_boost')
        .val(settings.eventbase_anchor_boost ?? 0.20)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.20 : Math.max(0, Math.min(0.5, value));
            $('#VectTauri_eventbase_anchor_boost_val').text(safeValue.toFixed(2));
            settings.eventbase_anchor_boost = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_eventbase_anchor_boost_val').text(
        (typeof settings.eventbase_anchor_boost === 'number' ? settings.eventbase_anchor_boost : 0.20).toFixed(2)
    );

    // Keyword scoring method (bm25 = A1 fast re-rank; hybrid = A2 client-side hybrid fusion, ANN-bound ≤100)
    $('#VectTauri_keyword_scoring_method')
        .val(settings.keyword_scoring_method || 'hybrid')
        .on('change', function() {
            settings.keyword_scoring_method = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            log.lifecycle(`VectTauri: Keyword scoring method changed to ${settings.keyword_scoring_method}`);
            updateNativeHybridUI();
        });

    // Hybrid keyword level
    $('#VectTauri_hybrid_keyword_level')
        .val(settings.hybrid_keyword_level || 'balance')
        .on('change', function() {
            settings.hybrid_keyword_level = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            log.lifecycle(`VectTauri: Hybrid keyword level changed to ${settings.hybrid_keyword_level}`);
        });

    // BM25 k1 parameter
    $('#VectTauri_bm25_k1')
        .val(settings.bm25_k1 || 1.5)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 1.5 : value;
            $('#VectTauri_bm25_k1_value').text(safeValue.toFixed(1));
            settings.bm25_k1 = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_bm25_k1_value').text((settings.bm25_k1 || 1.5).toFixed(1));

    // BM25 b parameter
    $('#VectTauri_bm25_b')
        .val(settings.bm25_b || 0.75)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.75 : value;
            $('#VectTauri_bm25_b_value').text(safeValue.toFixed(2));
            settings.bm25_b = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_bm25_b_value').text((settings.bm25_b || 0.75).toFixed(2));

    // BM25 corpus-IDF A/B toggle (GUI-only stub; consumer wired up in a follow-up change)
    $('#VectTauri_bm25_use_corpus_idf')
        .prop('checked', settings.bm25_use_corpus_idf === true)
        .on('change', function() {
            settings.bm25_use_corpus_idf = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // ========== Hybrid Search Settings ==========

    // Fusion method selector
    $('#VectTauri_hybrid_fusion_method')
        .val(settings.hybrid_fusion_method || 'rrf')
        .on('change', function() {
            settings.hybrid_fusion_method = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            // Show weights only for weighted method, RRF settings for RRF
            const isWeighted = settings.hybrid_fusion_method === 'weighted';
            $('#VectTauri_hybrid_weights').toggle(isWeighted);
            $('#VectTauri_hybrid_rrf_settings').toggle(!isWeighted);
            log.lifecycle(`VectTauri: Hybrid fusion method changed to ${settings.hybrid_fusion_method}`);
        });
    // Initialize visibility based on current method
    const isWeightedMethod = (settings.hybrid_fusion_method || 'rrf') === 'weighted';
    $('#VectTauri_hybrid_weights').toggle(isWeightedMethod);
    $('#VectTauri_hybrid_rrf_settings').toggle(!isWeightedMethod);

    // Vector weight slider
    $('#VectTauri_hybrid_vector_weight')
        .val(settings.hybrid_vector_weight ?? 0.5)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.5 : value;
            $('#VectTauri_hybrid_vector_weight_value').text(safeValue.toFixed(1));
            settings.hybrid_vector_weight = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_hybrid_vector_weight_value').text((settings.hybrid_vector_weight ?? 0.5).toFixed(1));

    // Text weight slider
    $('#VectTauri_hybrid_text_weight')
        .val(settings.hybrid_text_weight ?? 0.5)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.5 : value;
            $('#VectTauri_hybrid_text_weight_value').text(safeValue.toFixed(1));
            settings.hybrid_text_weight = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_hybrid_text_weight_value').text((settings.hybrid_text_weight ?? 0.5).toFixed(1));

    // RRF K constant slider
    $('#VectTauri_hybrid_rrf_k')
        .val(settings.hybrid_rrf_k || 60)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 60 : value;
            $('#VectTauri_hybrid_rrf_k_value').text(safeValue);
            settings.hybrid_rrf_k = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_hybrid_rrf_k_value').text(settings.hybrid_rrf_k || 60);

    // Initialize native-hybrid-dependent visibility
    updateNativeHybridUI();

    // Query depth (how many recent messages to include in search query)
    $('#VectTauri_query_depth')
        .val(settings.query || 2)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 2 : value;
            $('#VectTauri_query_depth_value').text(safeValue);
            settings.query = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_query_depth_value').text(settings.query || 2);

    // Top K - number of results retrieved per collection (top-K)
    $('#VectTauri_topk')
        .val((settings.top_k ?? settings.insert) || 3)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? (settings.insert || 3) : value;
            settings.top_k = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Auto-sync independent window (turns). Feature A.
    {
        const _turns0 = Math.max(1, Math.min(20, settings.eventbase_autosync_window_turns ?? 1));
        $('#VectTauri_eventbase_autosync_window_turns_val').text(_turns0);
        $('#VectTauri_autosync_window_msg_equiv').text(`(= ${_turns0 * 2} messages)`);
        $('#VectTauri_eventbase_autosync_window_turns')
            .val(_turns0)
            .on('input', async function() {
                const val = Math.max(1, Math.min(20, parseInt(this.value, 10) || 1));
                const prev = settings.eventbase_autosync_window_turns;
                settings.eventbase_autosync_window_turns = val;
                $('#VectTauri_eventbase_autosync_window_turns_val').text(val);
                $('#VectTauri_autosync_window_msg_equiv').text(`(= ${val * 2} messages)`);
                Object.assign(extension_settings.vecttauri, settings);
                saveSettingsDebounced();

                // Re-stamp the per-chat auto-sync marker so a new window size starts
                // from the current high-water mark instead of triggering a backfill
                // storm. Guarded on real change (input fires on every drag tick).
                if (prev !== val) {
                    try {
                        const { stampAutoSyncMarker } = await import('../core/eventbase-store.js');
                        const { getChatUUID } = await import('../core/collection-ids.js');
                        const uuid = getChatUUID();
                        if (uuid) await stampAutoSyncMarker(uuid, extension_settings.vecttauri);
                    } catch (err) {
                        log.warn('[VectTauri] Failed to re-stamp marker on auto-sync window change:', err?.message || err);
                    }
                }
            });
    }

    // --- Summarizer Injection (Feature B) ---
    // Count slider (1-50, default 30).
    const _summCount0 = Math.max(1, Math.min(50, settings.summarizer_injection_count ?? 20));
    $('#VectTauri_summarizer_injection_count_val').text(_summCount0);
    $('#VectTauri_summarizer_injection_count')
        .val(_summCount0)
        .on('input', function() {
            const val = Math.max(1, Math.min(50, parseInt(this.value, 10) || 20));
            settings.summarizer_injection_count = val;
            $('#VectTauri_summarizer_injection_count_val').text(val);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Full event detail toggle (default ON — includes structured fields per event).
    $('#VectTauri_summarizer_injection_full_detail')
        .prop('checked', settings.summarizer_injection_full_detail !== false)
        .on('change', function() {
            settings.summarizer_injection_full_detail = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Max injection size (characters). 0 = no cap.
    $('#VectTauri_summarizer_injection_max_chars')
        .val(Number(settings.summarizer_injection_max_chars ?? 10000))
        .on('change input', function() {
            const v = Number($(this).val());
            settings.summarizer_injection_max_chars = Number.isFinite(v) ? Math.max(0, v) : 10000;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Per-turn token-saved readout, fed by window.VectTauri_LastGhost (set inside
    // applyGhosting on every enabled generation). Refreshed on init, on toggle, and
    // after each AI reply / swipe via the event subscriptions below.
    const _refreshGhostReadout = () => {
        const $el = $('#VectTauri_eventbase_ghost_readout');
        if ($el.length === 0) return;
        if (!settings.eventbase_ghost_enabled || !settings.summarizer_injection_enabled) {
            $el.text('Last turn: ghosting off.');
            return;
        }
        const g = window.VectTauri_LastGhost;
        if (!g || typeof g.wiped !== 'number') {
            $el.text('Last turn: no generation yet.');
        } else if (g.wiped === 0) {
            $el.text('Last turn: 0 messages wiped (nothing vectorized below the recent tail yet).');
        } else {
            $el.html(`Last turn: wiped <strong>${g.wiped}</strong> message(s) — ~${g.charsRemoved.toLocaleString()} chars (<strong>~${g.approxTokens.toLocaleString()} tokens</strong>) saved.`);
        }
    };

    // Ghosting controls depend on Summarizer Injection being on (the wipe self-gates
    // on it too). Grey out + disable when it's off, with a one-line nudge.
    const _applyGhostAvailability = () => {
        const summOn = !!settings.summarizer_injection_enabled;
        const ghostOn = !!settings.eventbase_ghost_enabled;
        $('#VectTauri_eventbase_ghost_enabled').prop('disabled', !summOn);
        $('#VectTauri_eventbase_ghost_keep_recent').prop('disabled', !summOn || !ghostOn);
        const $group = $('#VectTauri_eventbase_ghost_group');
        $group.css('opacity', summOn ? '1' : '0.5');
        if (!summOn) {
            if ($group.find('[data-lock="needs-summarizer"]').length === 0) {
                $group.append('<small class="VectTauri_hint" data-lock="needs-summarizer" style="display:block; color: var(--warning, #e0a800);">Enable Summarizer Injection above to use ghosting.</small>');
            }
        } else {
            $group.find('[data-lock="needs-summarizer"]').remove();
        }
        _refreshGhostReadout();
    };

    // Refresh the readout after each generation completes (reply + swipe regenerate).
    eventSource.on(event_types.MESSAGE_RECEIVED, _refreshGhostReadout);
    eventSource.on(event_types.MESSAGE_SWIPED, _refreshGhostReadout);

    $('#VectTauri_eventbase_ghost_enabled')
        .prop('checked', !!settings.eventbase_ghost_enabled)
        .on('change', function() {
            settings.eventbase_ghost_enabled = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            _applyGhostAvailability();
        });

    const _ghostKeep0 = Math.max(0, Math.min(100, parseInt(settings.eventbase_ghost_keep_recent ?? 10, 10) || 0));
    $('#VectTauri_eventbase_ghost_keep_recent_val').text(_ghostKeep0);
    $('#VectTauri_eventbase_ghost_keep_recent')
        .val(_ghostKeep0)
        .on('input', function() {
            const val = Math.max(0, Math.min(100, parseInt(this.value, 10) || 0));
            settings.eventbase_ghost_keep_recent = val;
            $('#VectTauri_eventbase_ghost_keep_recent_val').text(val);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // One-way lock: enabling Summarizer Injection forces + locks the auto-sync
    // window to 1 turn (so "last N events" == "last N turns"). Flipping the slider
    // to 1 via .trigger('input') reuses its own handler, which re-stamps the marker
    // — so the lock can't cause a re-extraction storm.
    const _applySummarizerLock = () => {
        const enabled = !!settings.summarizer_injection_enabled;
        const $slider = $('#VectTauri_eventbase_autosync_window_turns');
        const $group = $slider.closest('.vecttauri-form-group');
        if (enabled) {
            if (settings.eventbase_autosync_window_turns !== 1) {
                $slider.val(1).trigger('input'); // updates setting + label + re-stamps marker
            }
            $slider.prop('disabled', true);
            if ($group.find('[data-lock="summarizer"]').length === 0) {
                $group.append('<small class="VectTauri_hint" data-lock="summarizer" style="display:block;">Locked to 1 turn by Summarizer Injection (below).</small>');
            }
        } else {
            $slider.prop('disabled', false);
            $group.find('[data-lock="summarizer"]').remove();
        }
        _applyGhostAvailability(); // ghosting requires summarizer injection — keep in sync
    };

    $('#VectTauri_summarizer_injection_enabled')
        .prop('checked', !!settings.summarizer_injection_enabled)
        .on('change', function() {
            const enabling = $(this).prop('checked');
            settings.summarizer_injection_enabled = enabling;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            _applySummarizerLock();

            // "Most recent N events" is only meaningful if the collection stays current,
            // so turning the summarizer ON also turns auto-sync ON — reusing the auto-sync
            // checkbox's OWN enable flow (backlog catch-up gate, lock, marker stamp) rather
            // than duplicating it. Symmetric with the window-lock above: while the
            // summarizer runs, both the window (1 turn) and auto-sync (on) are bound to it.
            //
            // That flow may REFUSE (no chat, or no collection yet), and being async it
            // cannot report back to this handler. It therefore revokes the summarizer
            // itself via _disableSummarizerInjectionBecauseAutoSyncIsOff, so the pair can
            // never end up disagreeing — which is what left the summarizer checked beside
            // an unchecked auto-sync, injecting stale events as if they were the latest.
            if (enabling) {
                const $autosync = $('#VectTauri_autosync_enabled');
                if (!$autosync.prop('checked')) {
                    $autosync.prop('checked', true).trigger('input');
                }

                // Ghosting is the summarizer's main payoff — the wiped turns rely on
                // its injection for recall — so default it ON when the summarizer is
                // enabled. Soft default, NOT a hard lock (unlike the 1-turn window):
                // the ghost checkbox stays editable so the user can uncheck it. Reuses
                // the ghost checkbox's own change handler so the setting + availability
                // stay in sync.
                const $ghost = $('#VectTauri_eventbase_ghost_enabled');
                if (!$ghost.prop('checked')) {
                    $ghost.prop('checked', true).trigger('change');
                }
            }
        });

    // Hide the whole group on standard + no plugin (listChunks returns no metadata
    // there → 0 events → silent no-op, so the feature can't function). Mirror of
    // _refreshCosineWeightAvailability; also called on vector-backend change.
    _refreshSummarizerInjectionAvailability = async function() {
        const $group = $('#VectTauri_summarizer_injection_group');
        if ($group.length === 0) return;
        const backend = settings.vector_backend || 'standard';
        const pluginUp = await checkPluginAvailable();
        $group.toggle(!(backend === 'standard' && !pluginUp));
    };

    _applySummarizerLock();
    _refreshSummarizerInjectionAvailability();

    // Auto-sync popup toggle
    $('#VectTauri_autosync_popup')
        .prop('checked', settings.eventbase_autosync_popup !== false)
        .on('change', function() {
            settings.eventbase_autosync_popup = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Auto-sync progress modal toggle (default: hidden)
    $('#VectTauri_autosync_show_progress_modal')
        .prop('checked', settings.autosync_show_progress_modal === true)
        .on('change', function() {
            settings.autosync_show_progress_modal = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Per-turn retrieval budget. Clamped through the same resolver the retrieval
    // path uses, so the field can never accept a value the budget won't honor.
    $('#VectTauri_retrieval_timeout_ms')
        .val(resolveRetrievalTimeoutMs(settings))
        .on('change input', function() {
            settings.retrieval_timeout_ms = resolveRetrievalTimeoutMs({ retrieval_timeout_ms: $(this).val() });
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Retrieval popups
    $('#VectTauri_retrieval_popup_on_start')
        .prop('checked', settings.retrieval_popup_on_start || false)
        .on('change', function() {
            settings.retrieval_popup_on_start = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_retrieval_popup_on_result')
        .prop('checked', settings.retrieval_popup_on_result || false)
        .on('change', function() {
            settings.retrieval_popup_on_result = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // World Info Integration settings
    $('#VectTauri_enabled_world_info')
        .prop('checked', settings.enabled_world_info || false)
        .on('change', async function() {
            const enabled = $(this).prop('checked');
            const $checkbox = $(this);

            // Single source of truth — getCollectionListing handles superadmin
            // bypass + creatorHandle ownership + isActive lock-state check.
            const ownLorebookEntries = getCollectionListing(settings)
                .filter(e => e.isOwn && e.collectionId.startsWith('vf_lorebook_'));

            const chatId = getCurrentChatId();
            const characterId = getContext()?.characterId;
            const { removeCollectionLock, removeCollectionCharacterLock } = await import('../core/collection-metadata.js');

            if (enabled) {
                if (ownLorebookEntries.length === 0) {
                    $checkbox.prop('checked', false);
                    toastr.info('Vectorize a lorebook first to use Semantic WI Activation');
                    openContentVectorizer('lorebook');
                    return;
                }

                const hasActive = ownLorebookEntries.some(e => e.isActive);
                if (!hasActive) {
                    $checkbox.prop('checked', false);
                    toastr.info('Lock a lorebook to this chat in Database Browser → Collection Settings');
                    openDatabaseBrowser();
                    return;
                }
            } else {
                // Uncheck mirrors Collection Settings uncheck: remove the lock that's making each
                // active own-persona lorebook active. After this, isActive returns false for all
                // of them and the listing badge drops the 🔒.
                let removed = 0;
                for (const e of ownLorebookEntries) {
                    if (!e.isActive) continue;
                    const lockKey = e.registryKey || e.collectionId;
                    if (e.meta.scope === 'chat' && chatId) {
                        removeCollectionLock(lockKey, chatId);
                        removed++;
                    } else if (e.meta.scope === 'character' && characterId) {
                        removeCollectionCharacterLock(lockKey, String(characterId));
                        removed++;
                    }
                }
                if (removed > 0) {
                    document.dispatchEvent(new CustomEvent('vecttauri:collections-updated'));
                }
            }

            settings.enabled_world_info = enabled;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            $('#VectTauri_world_info_settings').toggle(enabled);
        });

    $('#VectTauri_world_info_threshold')
        .val(settings.world_info_threshold ?? 0.3)
        .on('input', function() {
            const value = parseFloat($(this).val());
            const safeValue = isNaN(value) ? 0.3 : Math.max(0, Math.min(1, value));
            settings.world_info_threshold = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_world_info_top_k')
        .val(settings.world_info_top_k ?? 3)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 3 : Math.max(1, Math.min(20, value));
            settings.world_info_top_k = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_world_info_query_depth')
        .val(settings.world_info_query_depth ?? 3)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 3 : Math.max(1, Math.min(10, value));
            settings.world_info_query_depth = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_world_info_retrieval_popup')
        .prop('checked', settings.world_info_retrieval_popup === true)
        .on('change', function() {
            settings.world_info_retrieval_popup = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Custom stopwords
    $('#VectTauri_custom_stopwords')
        .val(settings.custom_stopwords || '')
        .on('input', function() {
            settings.custom_stopwords = $(this).val();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // CJK tokenizer mode selector
    $('#VectTauri_cjk_tokenizer_mode')
        .val(settings.cjk_tokenizer_mode || CJK_TOKENIZER_MODES.intl)
        .on('change', async function() {
            const mode = String($(this).val());
            settings.cjk_tokenizer_mode = mode;
            setCjkTokenizerMode(mode);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();

            if (mode === CJK_TOKENIZER_MODES.jieba) {
                const ok = await ensureJiebaTokenizerLoaded();
                if (!ok) {
                    toastr.warning('Simplified Chinese Jieba tokenizer failed to load. Falling back to Intl.Segmenter.', 'VectTauri CJK');
                }
            }

            if (mode === CJK_TOKENIZER_MODES.jieba_tw) {
                toastr.info('Loading Traditional Chinese dictionary (~2–5 MB)...', 'VectTauri CJK');
                const ok = await ensureJiebaTwLoaded();
                if (ok) {
                    toastr.success('Traditional Chinese Jieba tokenizer ready.', 'VectTauri CJK');
                } else {
                    toastr.warning('Traditional Chinese Jieba tokenizer failed to load. Falling back to Intl.Segmenter.', 'VectTauri CJK');
                }
            }
        });

    // Initialize world info settings visibility based on current setting
    $('#VectTauri_world_info_settings').toggle(settings.enabled_world_info || false);
    refreshWIStatus();
    document.addEventListener('vecttauri:collections-updated', refreshWIStatus);
    eventSource.on(event_types.CHAT_CHANGED, refreshWIStatus);

    // Chat auto-sync UI also follows the same events: collection list changes
    // (e.g. chat just got vectorized) and chat-changed shift the state.
    const _refreshAutoSync = () => refreshAutoSyncCheckbox(extension_settings.vecttauri);
    document.addEventListener('vecttauri:collections-updated', _refreshAutoSync);

    document.addEventListener('vecttauri:eventbase-synced', () => {
        // The chat just gained a collection because the user was sent here by
        // ticking auto-sync. Finish what they started: re-run the enable flow,
        // which now finds a collection and takes the normal path (straight on if
        // fully synced, catch-up prompt if not). Refreshing alone would only
        // re-read the stored "off" and leave the box unticked — the bug this
        // fixes.
        const pendingChat = _autoSyncEnableAwaitingVectorizeForChat;
        _autoSyncEnableAwaitingVectorizeForChat = null;
        if (pendingChat && pendingChat === getCurrentChatId()) {
            $('#VectTauri_autosync_enabled').prop('checked', true).trigger('input');
            return; // that flow sets the checkbox itself
        }
        _refreshAutoSync();
    });

    // Closed without vectorizing — the user changed their mind, so drop the
    // intent rather than enabling auto-sync off some later unrelated run.
    document.addEventListener('vecttauri:content-vectorizer-closed', () => {
        _autoSyncEnableAwaitingVectorizeForChat = null;
    });

    // Debug buttons: Test semantic WI and dump registry
    $('#VectTauri_wi_test_btn').on('click', async function() {
        try {
            const raw = $('#VectTauri_wi_test_input').val() || '';
            const recentMessages = raw.split('\n').map(s => s.trim()).filter(Boolean);
            const activeEntries = [];
            const cfg = window.extension_settings?.vecttauri || settings;

            log.trace('VectTauri: Running semantic WI test with messages:', recentMessages);

            // Primary: use initialized hooks if available
            if (window.VectTauri_WorldInfo && typeof window.VectTauri_WorldInfo.getSemanticEntries === 'function') {
                const entries = await window.VectTauri_WorldInfo.getSemanticEntries(recentMessages, activeEntries, cfg);
                log.trace('VectTauri: Semantic WI test results (via window hooks):', entries);
                if (cfg.world_info_retrieval_popup) toastr.info(`Semantic WI test completed - ${entries.length} entries (see console)`);

                // If no entries found, provide extended diagnostics to help debug
                if (!entries || entries.length === 0) {
                    try {
                        log.trace('VectTauri: No semantic entries — dumping registry and per-collection query info...');
                        const registry = getCollectionRegistry();
                        log.trace('VectTauri: Collection registry:', registry);

                        const coreApi = await import('../core/core-vector-api.js');
                        const metaMod = await import('../core/collection-metadata.js');

                        for (const registryKey of registry) {
                            try {
                                const collKey = parseRegistryKey(registryKey).collectionId;
                                if (!collKey.startsWith('vf_lorebook_')) continue; // focus on lorebooks
                                const meta = metaMod.getCollectionMeta(collKey);
                                log.trace(`VectTauri: Collection meta for ${collKey}:`, meta);

                                // Check saved hashes (true=include metadata)
                                if (coreApi.getSavedHashes) {
                                    try {
                                        const saved = await coreApi.getSavedHashes(collKey, cfg, true);
                                        log.trace(`VectTauri: getSavedHashes for ${collKey}:`, saved && saved.hashes ? saved.hashes.length + ' hashes' : saved);
                                    } catch (hErr) {
                                        log.warn(`VectTauri: getSavedHashes failed for ${collKey}:`, hErr.message);
                                    }
                                }

                                // Run a direct vector query against this collection
                                const diagQueryText = recentMessages.join('\n');
                                if (!diagQueryText.trim()) {
                                    log.trace(`VectTauri: skipping queryCollection for ${collKey} — no test messages provided`);
                                } else {
                                    try {
                                        const qres = await coreApi.queryCollection(collKey, diagQueryText, cfg.world_info_top_k || 3, cfg);
                                        log.trace(`VectTauri: queryCollection result for ${collKey}:`, qres);
                                    } catch (qErr) {
                                        log.warn(`VectTauri: queryCollection failed for ${collKey}:`, qErr.message);
                                    }
                                }
                            } catch (inner) {
                                log.warn('VectTauri: Error inspecting collection', collKey, inner.message);
                            }
                        }

                        if (cfg.world_info_retrieval_popup) toastr.info('Extended WI diagnostics written to console (registry + per-collection queries)');
                    } catch (diagErr) {
                        log.error('VectTauri: Failed to run extended WI diagnostics', diagErr);
                        toastr.error('Failed to run WI diagnostics: ' + (diagErr.message || diagErr));
                    }
                }

                return;
            }

            // Fallback: try dynamic import of module (in case initialization order differed)
            try {
                const mod = await import('../core/world-info-integration.js');
                const fn = mod.getSemanticWorldInfoEntries || mod.getSemanticEntries || mod.default;
                if (!fn || typeof fn !== 'function') {
                    throw new Error('WorldInfo module does not export a usable function');
                }
                const entries = await fn(recentMessages, activeEntries, cfg);
                log.trace('VectTauri: Semantic WI test results (via dynamic import):', entries);
                if (cfg.world_info_retrieval_popup) toastr.info(`Semantic WI test completed - ${entries.length} entries (see console)`);
                return;
            } catch (impErr) {
                log.warn('VectTauri: Dynamic import fallback failed:', impErr.message);
                toastr.error('VectTauri: WorldInfo hooks not initialized and dynamic import failed: ' + impErr.message);
                return;
            }

        } catch (e) {
            log.error('VectTauri: Semantic WI test failed', e);
            try { toastr.error('Semantic WI test failed: ' + (e.message || String(e))); } catch (_) {}
        }
    });

    $('#VectTauri_wi_dump_registry').on('click', function() {
        try {
            const registry = getCollectionRegistry();
            log.trace('VectTauri: Collection registry dump:', registry);
            toastr.info(`Collection registry dumped to console (${registry.length} items)`);
        } catch (e) {
            log.error('VectTauri: Failed to dump registry', e);
            toastr.error('Failed to dump registry: ' + e.message);
        }
    });

    // Apply first semantic hit to ST World Info (best-effort)
    $('#VectTauri_wi_apply_first').on('click', async function() {
        try {
            const raw = $('#VectTauri_wi_test_input').val() || '';
            const recentMessages = raw.split('\n').map(s => s.trim()).filter(Boolean);
            const cfg = window.extension_settings?.vecttauri || settings;

            if (!window.VectTauri_WorldInfo || !window.VectTauri_WorldInfo.getSemanticEntries) {
                toastr.error('VectTauri: WorldInfo hooks not initialized');
                return;
            }

            const entries = await window.VectTauri_WorldInfo.getSemanticEntries(recentMessages, [], cfg);
            if (!entries || entries.length === 0) {
                toastr.info('No semantic entries found');
                return;
            }

            const first = entries[0];
            log.trace('VectTauri: Applying semantic WI entry:', first);

            // Best-effort: try importing ST's world-info module and invoking common APIs
            let applied = false;
            try {
                const worldInfo = await import('../../../../world-info.js');
                // Try common function names
                const candidates = ['applyWorldInfoEntries', 'activateEntries', 'setActiveEntries', 'activateWorldInfoEntries'];
                for (const name of candidates) {
                    if (worldInfo[name] && typeof worldInfo[name] === 'function') {
                        await worldInfo[name]([first]);
                        applied = true;
                        log.trace(`VectTauri: Applied via world-info.${name}`);
                        break;
                    }
                }
            } catch (e) {
                log.trace('VectTauri: world-info import failed or method not found', e);
            }

            // Try global window API fallbacks
            if (!applied) {
                const fallbackCandidates = [
                    window.applyWorldInfoEntries,
                    window.activateWorldInfoEntries,
                    window.setActiveWorldInfoEntries
                ];
                for (const fn of fallbackCandidates) {
                    if (fn && typeof fn === 'function') {
                        try {
                            await fn([first]);
                            applied = true;
                            log.trace('VectTauri: Applied via global fallback function');
                            break;
                        } catch (e) {
                            log.trace('VectTauri: fallback apply failed', e);
                        }
                    }
                }
            }

            if (applied) {
                toastr.success('Semantic WI entry applied (best-effort)');
                return;
            }

            // Final fallback: copy content to clipboard and instruct user
            const text = first.content || (Array.isArray(first.key) ? first.key.join(', ') : String(first.key));
            try {
                await navigator.clipboard.writeText(text);
                toastr.info('Semantic entry copied to clipboard. Paste into World Info editor to activate.');
            } catch (e) {
                log.warn('VectTauri: Clipboard write failed, showing content in console');
                log.trace('Semantic entry content:', text);
                toastr.info('Semantic entry logged to console. Paste into World Info editor to activate.');
            }

        } catch (e) {
            log.error('VectTauri: Apply semantic WI failed', e);
            toastr.error('Failed to apply semantic WI entry: ' + e.message);
        }
    });

    // Injection position (where every VectTauri block goes in the prompt)
    $('#VectTauri_injection_position')
        .val(settings.position)
        .on('change', function() {
            const value = parseInt($(this).val());
            settings.position = value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            // Show/hide depth slider based on position
            $('#VectTauri_injection_depth_row').toggle(value === 1);
        });
    // Initialize depth row visibility
    $('#VectTauri_injection_depth_row').toggle(settings.position === 1);

    // Injection depth (for in-chat position)
    $('#VectTauri_injection_depth')
        .val(settings.depth ?? 2)
        .on('input', function() {
            const value = parseInt($(this).val());
            const safeValue = isNaN(value) ? 2 : value;
            $('#VectTauri_injection_depth_value').text(safeValue);
            settings.depth = safeValue;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_injection_depth_value').text(settings.depth ?? 2);

    // RAG Context settings
    $('#VectTauri_rag_context')
        .val(settings.rag_context || '')
        .on('input', function() {
            settings.rag_context = $(this).val();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_rag_xml_tag')
        .val(settings.rag_xml_tag || '')
        .on('input', function() {
            // Sanitize: only allow alphanumeric, underscore, hyphen
            const sanitized = $(this).val().replace(/[^a-zA-Z0-9_-]/g, '');
            $(this).val(sanitized);
            settings.rag_xml_tag = sanitized;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Provider-specific settings

    // ElectronHub model
    $('#VectTauri_electronhub_model')
        .val(settings.electronhub_model)
        .on('change', function() {
            settings.electronhub_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Ollama alternative endpoint
    $('#VectTauri_ollama_use_alt_endpoint')
        .prop('checked', settings.embedding_ollama_url_override)
        .on('input', function() {
            settings.embedding_ollama_url_override = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            $('#VectTauri_ollama_alt_endpoint_url').toggle(settings.embedding_ollama_url_override);
        });

    $('#VectTauri_ollama_alt_endpoint_url')
        .val(settings.embedding_ollama_url)
        .toggle(settings.embedding_ollama_url_override)
        .on('input', function() {
            settings.embedding_ollama_url = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Ollama API key input removed 2026-05-26: ST itself has no SECRET_KEYS.OLLAMA
    // slot and no getOllamaHeaders function in additional-headers.js. Calls to
    // setAdditionalHeadersByType(headers, TEXTGEN_TYPES.OLLAMA, ...) inside
    // ST's ollama-vectors.js are silent no-ops — ST never sends an Authorization
    // header to Ollama. VectTauri's old plaintext settings.ollama_api_key was
    // therefore dead code on both sides. Field is dropped entirely; migration
    // deletes any leftover plaintext from settings.json (see api-keys.js).
    // Users who need authed Ollama (rare — Ollama is typically LAN no-auth)
    // should configure auth at their reverse proxy.

    // vLLM alternative endpoint
    $('#VectTauri_vllm_use_alt_endpoint')
        .prop('checked', settings.embedding_vllm_url_override)
        .on('input', function() {
            settings.embedding_vllm_url_override = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
            $('#VectTauri_vllm_alt_endpoint_url').toggle(settings.embedding_vllm_url_override);
        });

    $('#VectTauri_vllm_alt_endpoint_url')
        .val(settings.embedding_vllm_url)
        .toggle(settings.embedding_vllm_url_override)
        .on('input', function() {
            settings.embedding_vllm_url = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // WebLLM model
    $('#VectTauri_webllm_model')
        .val(settings.webllm_model)
        .on('change', function() {
            settings.webllm_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // WebLLM Load Model button
    $('#VectTauri_webllm_load').on('click', async function() {
        const modelId = settings.webllm_model;

        if (!modelId) {
            toastr.warning('Please select a WebLLM model first', 'No Model Selected');
            return;
        }

        if (!isWebLlmSupported()) {
            return; // isWebLlmSupported already shows appropriate error
        }

        const $button = $(this);
        const originalHtml = $button.html();
        $button.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Loading...');

        await executeWithWebLlmErrorHandling(async () => {
            const provider = getWebLlmProvider();
            await provider.loadModel(modelId);
            toastr.success(`WebLLM model "${modelId}" loaded successfully`, 'Model Loaded');
        });

        $button.prop('disabled', false).html(originalHtml);
    });

    // WebLLM Install Extension button
    $('#VectTauri_webllm_install').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (Object.hasOwn(SillyTavern, 'llm')) {
            toastr.info('WebLLM extension is already installed. Try refreshing the page.', 'Already Installed');
            return;
        }

        openThirdPartyExtensionMenu('https://github.com/SillyTavern/Extension-WebLLM');
    });

    // Ollama model
    $('#VectTauri_ollama_model')
        .val(settings.embedding_ollama_model)
        .on('input', function() {
            settings.embedding_ollama_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_ollama_keep')
        .prop('checked', settings.ollama_keep)
        .on('input', function() {
            settings.ollama_keep = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // ─── Logging (core/log.js) ──────────────────────────────────────────
    // Verbosity dropdown — single noise floor, drives all gated log.* calls
    // (the 22 Phase-1 sites). Plus the raw_llm domain deep-dive, the one domain
    // whose read site is migrated (eventbase-extractor.js). No backward-compat
    // shim: the old verbosity gate flags are not read (user decision 2026-05-30).
    // The remaining domain deep-dives (qdrant / standard / injection / rerank)
    // ship in Phase 2 when their read sites migrate — until then their old
    // checkboxes below (Injection / Qdrant / Compare re-rank) stay on the old
    // flags so they keep working. See plans/logging-levels-and-classification.md.
    const _ensureDebugDomain = () => {
        if (!settings.debug_domain || typeof settings.debug_domain !== 'object') {
            settings.debug_domain = {};
        }
        return settings.debug_domain;
    };

    $('#VectTauri_debug_verbosity')
        .val(settings.debug_verbosity || 'off')
        .on('change', function() {
            settings.debug_verbosity = $(this).val();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Raw LLM reply domain deep-dive → settings.debug_domain.raw_llm
    $('#VectTauri_debug_domain_raw_llm')
        .prop('checked', _ensureDebugDomain().raw_llm === true)
        .on('change', function() {
            _ensureDebugDomain().raw_llm = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Injection debug toggle — drives debug_domain.injection, the unified
    // log.domain('injection') gate for BOTH ChunkBase (chat-vectorization.js)
    // and EventBase (eventbase-workflow.js) injection diagnostics.
    $('#VectTauri_injection_debug_logging')
        .prop('checked', settings.debug_domain?.injection || false)
        .on('change', function() {
            if (!settings.debug_domain) settings.debug_domain = {};
            settings.debug_domain.injection = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Serial / pipelined toggle. Checkbox CHECKED == disable_pipeline == serial.
    // Default to unchecked when the setting is unset (matches the read-site
    // semantics in eventbase-workflow.js: `... === true` means only explicit
    // true is serial). Fresh installs get pipelined mode (the new default).
    $('#VectTauri_eventbase_disable_pipeline')
        .prop('checked', settings.eventbase_disable_pipeline ?? false)
        .on('change', function() {
            settings.eventbase_disable_pipeline = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Group embedding-call toggle (default unchecked = parallel-split per item).
    // Checked = legacy batched POST. Path-agnostic — affects both EventBase ingestion
    // and document vectorization via the shared insertVectorItems entry point.
    // UI lives in the Core tab → Embedding section (the setting's actual scope).
    // Skipped automatically for local providers (Ollama uses batch=1 per item;
    // rate-limit forces serial via dynamicRateLimiter).
    $('#VectTauri_vector_group_embedding_call')
        .prop('checked', !!settings.vector_group_embedding_call)
        .on('change', function() {
            settings.vector_group_embedding_call = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Hedge toggle — boolean UI maps to a millisecond threshold so power users can tune
    // via devtools without code changes. Checked → 15000ms (vetted default). Unchecked → 0
    // (off). The actual hedge logic lives in core-vector-api.js callWithHedge(); the gating
    // in insertVectorItems skips local providers regardless of this checkbox.
    // See plans/embedding-resilience-hedge-and-diagnostics.md §6 for the full design.
    const HEDGE_DEFAULT_THRESHOLD_MS = 15000;
    $('#VectTauri_vector_hedge_enabled')
        .prop('checked', (Number(settings.vector_hedge_after_ms) || 0) > 0)
        .on('change', function() {
            settings.vector_hedge_after_ms = $(this).prop('checked') ? HEDGE_DEFAULT_THRESHOLD_MS : 0;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // EventBase native rerank toggle (A3 / Qdrant only).
    $('#VectTauri_eventbase_native_rerank')
        .prop('checked', !!settings.eventbase_native_rerank)
        .on('change', function() {
            settings.eventbase_native_rerank = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Compare-mode toggle (debug-only observability for native rerank).
    // Drives debug_domain.rerank — read by log.domainEnabled('rerank') in eventbase-retrieval.js.
    $('#VectTauri_eventbase_compare_rerank')
        .prop('checked', _ensureDebugDomain().rerank === true)
        .on('change', function() {
            _ensureDebugDomain().rerank = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Compare-mode verbose toggle.
    $('#VectTauri_eventbase_compare_rerank_verbose')
        .prop('checked', !!settings.eventbase_compare_rerank_verbose)
        .on('change', function() {
            settings.eventbase_compare_rerank_verbose = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // ── EventBase settings ──────────────────────────────────────────────────

    // Helper: normalize re-rank weights to sum = 1.0
    const _normalizeRerankWeights = () => {
        const keys = ['rerank_w_cosine', 'rerank_w_importance', 'rerank_w_persist', 'rerank_w_recency'];
        const values = keys.map(k => parseFloat(settings[`eventbase_${k}`]) || 0);
        const total = values.reduce((a, b) => a + b, 0);
        if (total === 0) return;
        keys.forEach((k, i) => {
            settings[`eventbase_${k}`] = Math.round((values[i] / total) * 1000) / 1000;
            $(`#VectTauri_eventbase_${k}`).val(settings[`eventbase_${k}`]);
        });
    };

    // Range inputs with live label update
    const _bindEventBaseRange = (id, settingKey, labelId) => {
        const $el = $(`#VectTauri_eventbase_${id}`);
        $el.val(settings[settingKey] ?? $el.attr('min') ?? 0)
            .on('input', function() {
                const v = parseInt($(this).val(), 10);
                settings[settingKey] = v;
                if (labelId) $(`#VectTauri_eventbase_${labelId}_val`).text(v);
                Object.assign(extension_settings.vecttauri, settings);
                saveSettingsDebounced();
            });
        if (labelId) $(`#VectTauri_eventbase_${labelId}_val`).text(settings[settingKey] ?? $el.val());
    };

    // window_size / window_overlap bindings moved to the Vectorize Content panel
    // (ui/content-vectorizer.js) — see Feature A re-home.
    _bindEventBaseRange('min_importance_store', 'eventbase_min_importance_store', 'min_importance_store');
    _bindEventBaseRange('max_events_per_window', 'eventbase_max_events_per_window', 'max_events_per_window');
    _bindEventBaseRange('retrieval_top_k', 'eventbase_retrieval_top_k', 'retrieval_top_k');
    _bindEventBaseRange('retrieval_min_importance', 'eventbase_retrieval_min_importance', 'retrieval_min_importance');

    $('#VectTauri_eventbase_injection_format')
        .val(settings.eventbase_injection_format || 'densetext')
        .on('change', function() {
            settings.eventbase_injection_format = String($(this).val() || 'densetext').toLowerCase();
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Number inputs (temperature, max_tokens, timeout_ms)
    const _bindEventBaseNumber = (id, settingKey) => {
        $(`#VectTauri_eventbase_${id}`)
            .val(settings[settingKey] ?? '')
            .on('change', function() {
                const v = parseFloat($(this).val());
                if (!isNaN(v)) {
                    settings[settingKey] = v;
                    Object.assign(extension_settings.vecttauri, settings);
                    saveSettingsDebounced();
                }
            });
    };

    _bindEventBaseNumber('temperature', 'eventbase_temperature');
    _bindEventBaseNumber('max_tokens', 'eventbase_max_tokens');
    _bindEventBaseNumber('timeout_ms', 'eventbase_timeout_ms');

    // Summarizer timeout lives in the EventBase tab next to the extraction timeout
    // (both bound the same configured model). Its setting key is summarize_*, so it
    // can't go through _bindEventBaseNumber (which prefixes ids/keys with eventbase_).
    $('#VectTauri_summarize_timeout_ms')
        .val(settings.summarize_timeout_ms ?? '')
        .on('change', function() {
            const v = parseFloat($(this).val());
            if (!isNaN(v)) {
                settings.summarize_timeout_ms = v;
                Object.assign(extension_settings.vecttauri, settings);
                saveSettingsDebounced();
            }
        });

    // Re-rank weight inputs
    ['rerank_w_cosine', 'rerank_w_importance', 'rerank_w_persist', 'rerank_w_recency'].forEach(k => {
        $(`#VectTauri_eventbase_${k}`)
            .val(settings[`eventbase_${k}`] ?? '')
            .on('change', function() {
                const v = parseFloat($(this).val());
                if (!isNaN(v) && v >= 0) {
                    settings[`eventbase_${k}`] = v;
                    _normalizeRerankWeights();
                    Object.assign(extension_settings.vecttauri, settings);
                    saveSettingsDebounced();
                }
            });
    });

    // Grey out the Cosine weight input when vector scoring is unavailable
    // (Standard backend without the Similharity plugin always returns score=0
    // from the native /api/vector/query path — see backends/standard.js:438).
    // The saved value is preserved so it takes effect again when the plugin
    // is installed or the user switches to a backend with real vector scores.
    // The retrieval pipeline coerces cosine→0 in the same condition so the
    // remaining 3 weights renormalize to a full 1.0 — see eventbase-retrieval.js.
    _refreshCosineWeightAvailability = async function() {
        const $input = $('#VectTauri_eventbase_rerank_w_cosine');
        const $group = $('#VectTauri_eventbase_cosine_group');
        const $warn  = $('#VectTauri_eventbase_cosine_plugin_warning');
        if ($input.length === 0) return;
        const backend = settings.vector_backend || 'standard';
        const pluginUp = await checkPluginAvailable();
        const inactive = backend === 'standard' && !pluginUp;
        $input.prop('disabled', inactive);
        $group.css('opacity', inactive ? 0.5 : 1);
        $warn.toggle(inactive);
    };
    _refreshCosineWeightAvailability();

    $('#VectTauri_eventbase_reset_weights').on('click', function() {
        settings.eventbase_rerank_w_cosine    = 0.55;
        settings.eventbase_rerank_w_importance = 0.20;
        settings.eventbase_rerank_w_persist   = 0.15;
        settings.eventbase_rerank_w_recency   = 0.10;
        ['rerank_w_cosine', 'rerank_w_importance', 'rerank_w_persist', 'rerank_w_recency'].forEach(k => {
            $(`#VectTauri_eventbase_${k}`).val(settings[`eventbase_${k}`]);
        });
        Object.assign(extension_settings.vecttauri, settings);
        saveSettingsDebounced();
        toastr.success('Re-rank weights reset to defaults');
    });

    // Custom extraction prompt textarea — pre-fill with default if nothing saved.
    // The "default" is now localized via CJK Tokenizer Mode (intl / jieba /
    // jieba_tw / tiny_segmenter / korean / others). When no custom prompt has
    // been saved, we show the localized built-in so the user sees the variant
    // that will actually be sent at extraction time.
    (async () => {
        const { getEventBaseExtractionPrompt } = await import('../core/prompts-i18n.js');
        const saved = settings.eventbase_custom_prompt || '';
        const mode = settings.cjk_tokenizer_mode || 'intl';
        $('#VectTauri_eventbase_custom_prompt').val(saved || getEventBaseExtractionPrompt(mode));
    })();

    $('#VectTauri_eventbase_custom_prompt').on('input', function() {
        settings.eventbase_custom_prompt = $(this).val();
        Object.assign(extension_settings.vecttauri, settings);
        saveSettingsDebounced();
    });

    // Reset prompt to built-in default for the current CJK Tokenizer Mode.
    $('#VectTauri_eventbase_prompt_reset').on('click', async function() {
        const { getEventBaseExtractionPrompt } = await import('../core/prompts-i18n.js');
        const mode = settings.cjk_tokenizer_mode || 'intl';
        settings.eventbase_custom_prompt = '';
        $('#VectTauri_eventbase_custom_prompt').val(getEventBaseExtractionPrompt(mode));
        Object.assign(extension_settings.vecttauri, settings);
        saveSettingsDebounced();
        toastr.success(`Extraction prompt reset to ${mode} default`, 'EventBase');
    });

    // When the user changes CJK Tokenizer Mode AND has no custom prompt saved,
    // re-fill the textarea with the new mode's localized default so the
    // displayed text matches what extraction will actually use. If the user
    // has a custom prompt, leave it alone — they explicitly customized it.
    $('#VectTauri_cjk_tokenizer_mode').on('change.eventbasePromptSync', async function() {
        if (settings.eventbase_custom_prompt && settings.eventbase_custom_prompt.trim()) return;
        const { getEventBaseExtractionPrompt } = await import('../core/prompts-i18n.js');
        const mode = $(this).val() || 'intl';
        $('#VectTauri_eventbase_custom_prompt').val(getEventBaseExtractionPrompt(mode));
    });

    // ── End EventBase settings ───────────────────────────────────────────────

    // OpenAI model
    $('#VectTauri_openai_model')
        .val(settings.openai_model)
        .on('change', function() {
            settings.openai_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Cohere model
    $('#VectTauri_cohere_model')
        .val(settings.cohere_model)
        .on('change', function() {
            settings.cohere_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // TogetherAI model
    $('#VectTauri_togetherai_model')
        .val(settings.togetherai_model)
        .on('change', function() {
            settings.togetherai_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // vLLM model
    $('#VectTauri_vllm_model')
        .val(settings.embedding_vllm_model)
        .on('input', function() {
            settings.embedding_vllm_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // vLLM API key (embedding input) — dual-write to SECRET_KEYS.CUSTOM
    // (chat-side proxy) + SECRET_KEYS.VLLM (embedding-side proxy). Same
    // pattern as the Summarize and AgentMode inputs above. One shared key,
    // both ST slots. See core/api-keys.js header for the full rationale.
    const updateVllmKeyDisplay = () => {
        const savedKey = getCustomApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_vllm_api_key').attr('placeholder', `Key saved: ${masked} (shared with Summarize + AgentMode)`);
        } else {
            $('#VectTauri_vllm_api_key').attr('placeholder', 'Leave blank for local / no-auth (shared with Summarize + AgentMode)');
        }
    };
    updateVllmKeyDisplay();
    $(document).on('vecttauri:vllm-key-changed', updateVllmKeyDisplay);
    $('#VectTauri_vllm_api_key').on('change', async function() {
        const value = String($(this).val()).trim();
        if (value) {
            const errors = [];
            try {
                await writeSecret(SECRET_KEYS.CUSTOM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.CUSTOM) failed:', err);
                errors.push('chat-side (CUSTOM)');
            }
            try {
                await writeSecret(SECRET_KEYS.VLLM, value);
            } catch (err) {
                log.error('[VectTauri] writeSecret(SECRET_KEYS.VLLM) failed:', err);
                errors.push('embedding-side (VLLM)');
            }
            await readSecretState();
            if (errors.length === 0) {
                toastr.success('vLLM API key saved (shared across embedding/summarize/agentic)');
            } else if (errors.length === 2) {
                toastr.error('Failed to save vLLM key to either slot — see console');
                return;
            } else {
                toastr.warning(`vLLM key partially saved — ${errors.join(', ')} write failed. See console.`);
            }
            $(this).val('');
            $(document).trigger('vecttauri:vllm-key-changed');
        }
    });

    // Google model
    $('#VectTauri_google_model')
        .val(settings.google_model)
        .on('change', function() {
            settings.google_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // OpenRouter model
    $('#VectTauri_openrouter_model')
        .val(settings.embedding_openrouter_model)
        .on('input', function() {
            settings.embedding_openrouter_model = String($(this).val());
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // "Choose" button — fetches OpenRouter model list, filters to embedding-likely models
    // Cached for the session to avoid re-fetching 600+ entries each click
    let _openrouterModelCache = null;
    $('#VectTauri_openrouter_model_choose').on('click', async function() {
        const $btn = $(this);
        const $list = $('#VectTauri_openrouter_model_list');
        const $input = $('#VectTauri_openrouter_model');

        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Loading…');

        try {
            if (!_openrouterModelCache) {
                // OpenRouter's /models endpoint is public — auth only personalizes
                // the response. getOpenRouterApiKey() returns a MASKED value
                // (see core/api-keys.js docstring), which would 401 if sent as
                // Bearer. Fetch unauthenticated; the global model list is fine
                // for the picker UI.
                const headers = { 'Content-Type': 'application/json' };
                // Embedding models use output_modalities=embeddings — not in the standard list
                const [embResp, allResp] = await Promise.all([
                    fetch('https://openrouter.ai/api/v1/models?output_modalities=embeddings', { method: 'GET', headers }),
                    fetch('https://openrouter.ai/api/v1/models', { method: 'GET', headers }),
                ]);
                const toEntry = m => ({ id: m.id, label: m.name ? `${m.id} — ${m.name}` : m.id });
                const embModels = embResp.ok ? (await embResp.json()).data?.map(toEntry) || [] : [];
                const allModels = allResp.ok ? (await allResp.json()).data?.map(toEntry) || [] : [];
                _openrouterModelCache = { embeddings: embModels, all: [...embModels, ...allModels] };
            }

            const { embeddings, all } = _openrouterModelCache;

            const renderList = (items, showingAll) => {
                if (!items.length) {
                    toastr.warning('No models matched the filter.');
                    return;
                }
                items.sort((a, b) => a.id.localeCompare(b.id));
                const currentValue = String($input.val() || '').trim();
                const toggleLabel = showingAll ? '— Showing all models · click to filter to embedding-only —' : '— Showing embedding models · click to show all —';
                const options = [`<option value="__toggle__">${toggleLabel}</option>`, '<option value="">— Select a model —</option>']
                    .concat(items.map(m => {
                        const selected = m.id === currentValue ? ' selected' : '';
                        const safeId = $('<div>').text(m.id).html();
                        const safeLabel = $('<div>').text(m.label).html();
                        return `<option value="${safeId}"${selected}>${safeLabel}</option>`;
                    }));
                $list.html(options.join('')).data('showing-all', showingAll).show();
            };

            // Default to embedding-only; if zero matches, fall back to all
            if (embeddings.length > 0) {
                renderList(embeddings, false);
                toastr.success(`Loaded ${embeddings.length} embedding models (${all.length} total available).`);
            } else {
                renderList(all, true);
                toastr.info(`No embedding-tagged models found — showing all ${all.length} models.`);
            }
        } catch (err) {
            log.error('[VectTauri] OpenRouter model list fetch failed:', err);
            toastr.error(`Could not fetch model list: ${err?.message || err}`);
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    $('#VectTauri_openrouter_model_list').on('change', function() {
        const $list = $(this);
        const value = String($list.val() || '').trim();

        // "__toggle__" pseudo-option toggles between embedding-only and all
        if (value === '__toggle__') {
            const showingAll = !!$list.data('showing-all');
            const cache = _openrouterModelCache || { embeddings: [], all: [] };
            const items = showingAll ? cache.embeddings : cache.all;
            items.sort((a, b) => a.id.localeCompare(b.id));
            const currentValue = String($('#VectTauri_openrouter_model').val() || '').trim();
            const nextShowingAll = !showingAll;
            const toggleLabel = nextShowingAll ? '— Showing all models · click to filter to embedding-only —' : '— Showing embedding models · click to show all —';
            const options = [`<option value="__toggle__">${toggleLabel}</option>`, '<option value="">— Select a model —</option>']
                .concat(items.map(m => {
                    const selected = m.id === currentValue ? ' selected' : '';
                    const safeId = $('<div>').text(m.id).html();
                    const safeLabel = $('<div>').text(m.label).html();
                    return `<option value="${safeId}"${selected}>${safeLabel}</option>`;
                }));
            $list.html(options.join('')).data('showing-all', nextShowingAll);
            return;
        }

        if (!value) return;
        $('#VectTauri_openrouter_model').val(value).trigger('input');
        $list.hide();
    });

    // OpenRouter API key (embedding input) — writes to SECRET_KEYS.OPENROUTER,
    // the shared slot used by ST's own Connection Profile and by VectTauri's
    // Summarize + AgentMode inputs. See core/api-keys.js for the rationale.
    const updateOpenRouterKeyDisplay = () => {
        const savedKey = getOpenRouterApiKey(settings);
        if (savedKey) {
            const masked = savedKey.length > 4
                ? '*'.repeat(Math.min(savedKey.length - 4, 8)) + savedKey.slice(-4)
                : '*'.repeat(savedKey.length);
            $('#VectTauri_openrouter_apikey').attr('placeholder', `Key saved: ${masked} (shared with Summarize + AgentMode)`);
        } else {
            $('#VectTauri_openrouter_apikey').attr('placeholder', 'Paste OpenRouter key (shared with Summarize + AgentMode)');
        }
    };
    updateOpenRouterKeyDisplay();
    $(document).on('vecttauri:openrouter-key-changed', () => {
        updateOpenRouterKeyDisplay();
        _openrouterModelCache = null; // sibling-input save also invalidates the model picker cache
    });

    $('#VectTauri_openrouter_apikey')
        .on('change', async function() {
            const value = String($(this).val()).trim();
            if (value) {
                try {
                    await writeSecret(SECRET_KEYS.OPENROUTER, value);
                    await readSecretState(); // refresh masked state for display
                } catch (err) {
                    log.error('[VectTauri] writeSecret(SECRET_KEYS.OPENROUTER) failed:', err);
                    toastr.error('Failed to save OpenRouter key — see console');
                    return;
                }
                _openrouterModelCache = null;
                toastr.success('OpenRouter API key saved (shared across embedding/summarize/agentic)');
                $(this).val('');
                $(document).trigger('vecttauri:openrouter-key-changed');
            }
        });

    // Rate Limiting
    $('#VectTauri_rate_limit_calls')
        .val(settings.rate_limit_calls || 0)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.rate_limit_calls = isNaN(value) ? 0 : value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_rate_limit_interval')
        .val(settings.rate_limit_interval || 60)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.rate_limit_interval = isNaN(value) ? 60 : value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Summarizer / Agent Mode (chat-completions) Rate Limiting — shared budget,
    // separate from the embedding limiter above. 0 = disabled.
    $('#VectTauri_generation_rate_limit_calls')
        .val(settings.generation_rate_limit_calls || 0)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.generation_rate_limit_calls = isNaN(value) ? 0 : value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_generation_rate_limit_interval')
        .val(settings.generation_rate_limit_interval || 60)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.generation_rate_limit_interval = isNaN(value) ? 60 : value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    $('#VectTauri_eventbase_debug_qdrant_backend')
        .prop('checked', !!settings.eventbase_debug_qdrant_backend)
        .on('change', function() {
            settings.eventbase_debug_qdrant_backend = !!$(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // VEC-6: Insert Batch Size
    $('#VectTauri_insert_batch_size')
        .val(settings.insert_batch_size || 50)
        .on('input', function() {
            const value = parseInt($(this).val());
            $('#VectTauri_insert_batch_size_value').text(value);
            settings.insert_batch_size = value;
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });
    $('#VectTauri_insert_batch_size_value').text(settings.insert_batch_size || 50);

    // Acronym glossary injection (Documents) — see core/glossary-extractor.js
    $('#VectTauri_document_glossary_injection')
        .prop('checked', settings.document_glossary_injection !== false)
        .on('change', function() {
            settings.document_glossary_injection = $(this).prop('checked');
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Minimum chat length before injection starts
    $('#VectTauri_min_chat_length')
        .val(settings.min_chat_length ?? 0)
        .on('input', function() {
            const value = parseInt($(this).val());
            settings.min_chat_length = isNaN(value) ? 0 : Math.max(0, value);
            Object.assign(extension_settings.vecttauri, settings);
            saveSettingsDebounced();
        });

    // Action buttons
    $('#VectTauri_vectorize_content').on('click', () => {
        openContentVectorizer();
    });
    $('#VectTauri_vectorize_all').on('click', callbacks.onVectorizeAll);
    $('#VectTauri_purge').on('click', callbacks.onPurge);
    $('#VectTauri_cleanup_corrupted').on('click', callbacks.onCleanupCorrupted);
    $('#VectTauri_run_diagnostics').on('click', callbacks.onRunDiagnostics);
    $('#VectTauri_database_browser').on('click', () => {
        log.lifecycle('VECTTAURI: Database Browser button clicked');
        try {
            const p = openDatabaseBrowser();
            if (p && typeof p.catch === 'function') {
                p.catch(err => log.error('VECTTAURI: openDatabaseBrowser rejected:', err));
            }
        } catch (err) {
            log.error('VECTTAURI: Database Browser click handler threw synchronously:', err);
        }
    });
    $('#VectTauri_view_results').on('click', () => {
        openQueryTestModal();
    });
    $('#VectTauri_debug_summarizer').on('click', () => {
        openSummarizerDebug(settings);
    });
    $('#VectTauri_text_cleaning').on('click', () => {
        openTextCleaningManager();
    });
    $('#VectTauri_reopen_progress').on('click', () => {
        if (!progressTracker.reopen()) {
            toastr.info('No active progress to show', 'VectTauri');
        }
    });

    // Initialize provider-specific settings visibility
    toggleProviderSettings(settings.embedding_provider, settings);
}

/**
 * "Debug Summarizer" action — preview the exact <VectTauriSummarizer> block that the
 * summarizer injection would put into the prompt this turn, WITHOUT injecting it.
 * Runs the same compute path (buildSummarizerInjection); ignores only the enabled
 * flag so the preview works while the feature is off.
 * @param {object} settings - extension_settings.vecttauri
 */
async function openSummarizerDebug(settings) {
    const { callGenericPopup, POPUP_TYPE } = await import('../../../../popup.js');

    let result;
    try {
        const { buildSummarizerInjection } = await import('../core/summarizer-injection.js');
        result = await buildSummarizerInjection(settings);
    } catch (err) {
        result = { text: '', count: 0, reason: 'error', error: err?.message || String(err) };
    }

    const enabled = !!settings.summarizer_injection_enabled;
    const REASONS = {
        'no-chat': 'No chat is open.',
        'no-collection': 'This chat has no active EventBase collection yet — vectorize it first.',
        'no-events': 'The collection has no events to inject yet.',
        'backend-error': `Backend unavailable: ${result.error || ''}`,
        'listchunks-error': `Could not read the collection: ${result.error || ''}`,
        'error': `Failed: ${result.error || ''}`,
    };

    let body;
    if (result.count > 0) {
        const reqNote = result.requested ? ` (requested up to ${result.requested})` : '';
        const offNote = enabled ? '' : ' — <em>feature is currently OFF; this previews what enabling it would inject</em>';
        body = `<p style="margin:0 0 6px;"><strong>${result.count}</strong> event(s) would be injected${reqNote}${offNote}.</p>`
            + `<pre style="white-space:pre-wrap; word-break:break-word; max-height:55vh; overflow:auto; text-align:left; background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; margin:0;">${StringUtils.escapeHtml(result.text)}</pre>`;
    } else {
        body = `<p style="margin:0;">Nothing would be injected this turn.</p>`
            + `<p style="margin:6px 0 0; opacity:0.85;">${StringUtils.escapeHtml(REASONS[result.reason] || result.reason || 'No events.')}</p>`;
    }

    const html = `<div style="text-align:left;">
        <h3 style="margin:0 0 8px;">Summarizer Injection — preview</h3>
        ${body}
    </div>`;
    await callGenericPopup(html, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true, large: true });
}

// Store current diagnostic results for copy/filter functionality
let currentDiagnosticResults = null;
let currentDiagnosticFilter = 'all'; // 'all', 'pass', 'warning', 'fail'

/**
 * Shows diagnostics results in the results phase
 * @param {object} results - Diagnostics results object
 */
export function showDiagnosticsResults(results) {
    // Store results globally for copy/filter functionality
    currentDiagnosticResults = results;
    currentDiagnosticFilter = 'all';

    renderDiagnosticsContent(results, 'all');

    // Show results phase
    showDiagnosticsPhase('results');
}

/**
 * Renders diagnostic content with optional status filter
 * @param {object} results - Diagnostics results object
 * @param {string} filter - Filter: 'all', 'pass', 'warning', 'fail'
 */
function renderDiagnosticsContent(results, filter = 'all') {
    const output = $('#VectTauri_diagnostics_content');
    output.empty();

    log.lifecycle('VectTauri UI: Rendering diagnostics with results:', results);
    log.trace('VectTauri UI: Version data received:', results.version);
    log.trace('VectTauri UI: Extension version:', results.version?.extension);
    log.trace('VectTauri UI: Plugin version:', results.version?.plugin);

    const statusIcons = {
        'pass': '<i class="fa-solid fa-circle-check" style="color: var(--vecttauri-success);"></i>',
        'warning': '<i class="fa-solid fa-triangle-exclamation" style="color: var(--vecttauri-warning);"></i>',
        'fail': '<i class="fa-solid fa-circle-xmark" style="color: var(--vecttauri-danger);"></i>',
        'skipped': '<i class="fa-solid fa-circle-minus" style="color: var(--grey70);"></i>'
    };

    const categoryTitles = {
        infrastructure: '<i class="fa-solid fa-server"></i> Infrastructure',
        configuration: '<i class="fa-solid fa-sliders"></i> Configuration',
        visualizer: '<i class="fa-solid fa-eye"></i> Visualizer',
        production: '<i class="fa-solid fa-vial"></i> Production Tests',
        console: '<i class="fa-solid fa-terminal"></i> Console Logs'
    };

    // Count stats
    const passCount = results.checks.filter(c => c.status === 'pass').length;
    const warnCount = results.checks.filter(c => c.status === 'warning').length;
    const failCount = results.checks.filter(c => c.status === 'fail').length;
    const fixableCount = results.checks.filter(c => c.fixable && (c.status === 'fail' || c.status === 'warning')).length;

    // Filter checks if needed
    const filterCheck = (check) => {
        if (filter === 'all') return true;
        return check.status === filter;
    };

    const renderChecks = (checks) => {
        const filteredChecks = checks.filter(filterCheck);
        if (filteredChecks.length === 0) {
            return '<div class="diagnostic-item-empty">No items match current filter</div>';
        }
        return filteredChecks.map(check => `
            <div class="diagnostic-item ${check.status}" data-fix-action="${check.fixAction || ''}" data-status="${check.status}">
                <div class="diagnostic-main">
                    <span class="diagnostic-icon">${statusIcons[check.status]}</span>
                    <span class="diagnostic-label">${check.name}</span>
                    <span class="diagnostic-message">${check.message}</span>
                </div>
                ${check.fixable ? `
                    <button class="diagnostic-fix-btn" data-fix-action="${check.fixAction}">
                        <i class="fa-solid fa-wrench"></i>
                        Fix
                    </button>
                ` : ''}
            </div>
        `).join('');
    };

    const html = `
        <!-- Version Info -->
        <div class="vecttauri-diagnostics-version" style="padding: 10px 15px; background: var(--black30alpha); border-radius: 8px; margin-bottom: 15px; font-size: 0.9em; color: var(--grey70);">
            <i class="fa-solid fa-info-circle"></i>
            <strong>Extension:</strong> v${results.version?.extension || 'Unknown'}
            <span style="margin: 0 10px;">•</span>
            <strong>Plugin:</strong> v${results.version?.plugin || 'Not installed'}
        </div>

        <!-- Summary Stats Bar (Clickable Filters) -->
        <div class="vecttauri-diagnostics-stats">
            <div class="vecttauri-diag-stat pass ${filter === 'pass' ? 'active' : ''}" data-filter="pass" title="Click to filter by passed">
                ${statusIcons.pass}
                <span class="vecttauri-diag-stat-count">${passCount}</span>
                <span class="vecttauri-diag-stat-label">Passed</span>
            </div>
            <div class="vecttauri-diag-stat warning ${filter === 'warning' ? 'active' : ''}" data-filter="warning" title="Click to filter by warnings">
                ${statusIcons.warning}
                <span class="vecttauri-diag-stat-count">${warnCount}</span>
                <span class="vecttauri-diag-stat-label">Warnings</span>
            </div>
            <div class="vecttauri-diag-stat fail ${filter === 'fail' ? 'active' : ''}" data-filter="fail" title="Click to filter by failed">
                ${statusIcons.fail}
                <span class="vecttauri-diag-stat-count">${failCount}</span>
                <span class="vecttauri-diag-stat-label">Failed</span>
            </div>
        </div>

        ${filter !== 'all' ? `
            <div class="vecttauri-diag-filter-notice">
                <span>Showing only: <strong>${filter}</strong></span>
                <button class="vecttauri-diag-clear-filter" data-filter="all">
                    <i class="fa-solid fa-times"></i> Show All
                </button>
            </div>
        ` : ''}

        ${Object.entries(results.categories).map(([category, checks]) => {
            if (checks.length === 0) return '';

            // Category-level stats
            const catPass = checks.filter(c => c.status === 'pass').length;
            const catWarn = checks.filter(c => c.status === 'warning').length;
            const catFail = checks.filter(c => c.status === 'fail').length;
            const catTotal = checks.length;
            const filteredCount = checks.filter(filterCheck).length;

            // Don't show category if all items filtered out
            if (filter !== 'all' && filteredCount === 0) return '';

            return `
                <div class="diagnostic-category" data-category="${category}">
                    <div class="diagnostic-category-header" data-collapsed="false">
                        <h4 class="diagnostic-category-title">
                            <span class="diagnostic-category-collapse-icon">
                                <i class="fa-solid fa-chevron-down"></i>
                            </span>
                            ${categoryTitles[category] || `<i class="fa-solid fa-folder"></i> ${category}`}
                        </h4>
                        <div class="diagnostic-category-stats">
                            <span class="diag-cat-stat pass" title="Passed">${catPass}</span>
                            <span class="diag-cat-stat warning" title="Warnings">${catWarn}</span>
                            <span class="diag-cat-stat fail" title="Failed">${catFail}</span>
                        </div>
                    </div>
                    <div class="diagnostic-category-content">
                        <div class="vecttauri-diagnostics">
                            ${renderChecks(checks)}
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;

    output.html(html);

    // Update title based on results
    const titleText = results.overall === 'healthy'
        ? 'All Checks Passed!'
        : results.overall === 'warnings'
            ? 'Completed with Warnings'
            : 'Issues Found';
    $('#VectTauri_diagnostics_title').text(titleText);

    // Show/hide Fix All button based on fixable issues
    if (fixableCount > 0) {
        $('#VectTauri_diag_fix_all')
            .show()
            .html(`<i class="fa-solid fa-wand-magic-sparkles"></i> Fix All (${fixableCount})`)
            .off('click')
            .on('click', function() {
                handleFixAll(results.checks);
            });
    } else {
        $('#VectTauri_diag_fix_all').hide();
    }

    // Bind filter click handlers on stat boxes
    $('.vecttauri-diag-stat').off('click').on('click', function() {
        const clickedFilter = $(this).data('filter');
        // Toggle: if already active, show all; otherwise apply filter
        if (currentDiagnosticFilter === clickedFilter) {
            currentDiagnosticFilter = 'all';
        } else {
            currentDiagnosticFilter = clickedFilter;
        }
        renderDiagnosticsContent(currentDiagnosticResults, currentDiagnosticFilter);
    });

    // Bind clear filter button
    $('.vecttauri-diag-clear-filter').off('click').on('click', function() {
        currentDiagnosticFilter = 'all';
        renderDiagnosticsContent(currentDiagnosticResults, 'all');
    });

    // Bind category collapse handlers
    $('.diagnostic-category-header').off('click').on('click', function() {
        const $header = $(this);
        const $content = $header.next('.diagnostic-category-content');
        const isCollapsed = $header.attr('data-collapsed') === 'true';

        if (isCollapsed) {
            $content.slideDown(200);
            $header.attr('data-collapsed', 'false');
            $header.find('.diagnostic-category-collapse-icon i').removeClass('fa-chevron-right').addClass('fa-chevron-down');
        } else {
            $content.slideUp(200);
            $header.attr('data-collapsed', 'true');
            $header.find('.diagnostic-category-collapse-icon i').removeClass('fa-chevron-down').addClass('fa-chevron-right');
        }
    });

    // Bind individual fix button click handlers
    $('.diagnostic-fix-btn').off('click').on('click', function(e) {
        e.stopPropagation();
        const action = $(this).data('fix-action');
        handleDiagnosticFix(action);
        // Mark this item as fixed visually
        $(this).closest('.diagnostic-item')
            .removeClass('fail warning')
            .addClass('pass')
            .find('.diagnostic-icon').html(statusIcons.pass);
        $(this).fadeOut(200);
    });

    // Bind copy button
    $('#VectTauri_diag_copy').off('click').on('click', function() {
        copyDiagnosticsReport(currentDiagnosticResults);
    });
}

/**
 * Generates and copies a nicely formatted diagnostics report
 * Respects the current filter selection
 * @param {object} results - Diagnostics results object
 */
function copyDiagnosticsReport(results) {
    if (!results) {
        toastr.warning('No diagnostic results to copy');
        return;
    }

    const filter = currentDiagnosticFilter;
    const isFiltered = filter !== 'all';

    // Filter checks if a specific filter is active
    const filterCheck = (check) => {
        if (!isFiltered) return true;
        return check.status === filter;
    };

    const timestamp = new Date(results.timestamp).toLocaleString();

    // Total counts (always show these for context)
    const totalPass = results.checks.filter(c => c.status === 'pass').length;
    const totalWarn = results.checks.filter(c => c.status === 'warning').length;
    const totalFail = results.checks.filter(c => c.status === 'fail').length;
    const totalCount = totalPass + totalWarn + totalFail;

    // Filtered counts
    const filteredChecks = results.checks.filter(filterCheck);
    const filteredCount = filteredChecks.length;

    const statusSymbols = {
        'pass': '✓',
        'warning': '⚠',
        'fail': '✗',
        'skipped': '○'
    };

    const filterNames = {
        'pass': 'PASSED ONLY',
        'warning': 'WARNINGS ONLY',
        'fail': 'FAILURES ONLY'
    };

    // Get current settings for the report
    const settings = extension_settings.vecttauri;
    const backend = settings.vector_backend || 'qdrant';
    const source = settings.embedding_provider || 'none';
    const modelField = getModelField(source);
    const model = modelField ? (settings[modelField] || 'not set') : 'n/a (provider handles it)';
    const qdrantMode = settings.qdrant_mode || 'local';
    const qdrantUrl = backend === 'qdrant'
        ? (qdrantMode === 'cloud' ? settings.qdrant_cloud_url : settings.qdrant_url)
        : null;

    // Build provider URL info
    let providerUrl = 'n/a';
    if (source === 'ollama') {
        providerUrl = settings.embedding_ollama_url_override && settings.embedding_ollama_url
            ? settings.embedding_ollama_url
            : (textgenerationwebui_settings?.server_urls?.[textgen_types?.OLLAMA] || 'http://127.0.0.1:11434');
    } else if (source === 'vllm') {
        providerUrl = settings.embedding_vllm_url_override && settings.embedding_vllm_url
            ? settings.embedding_vllm_url
            : (textgenerationwebui_settings?.server_urls?.[textgen_types?.VLLM] || 'http://127.0.0.1:8000');
    }

    let report = `╔══════════════════════════════════════════════════════════════╗
║              VectTauri DIAGNOSTICS REPORT                      ║
╚══════════════════════════════════════════════════════════════╝

📅 Generated: ${timestamp}
📦 Extension Version: ${results.version?.extension || 'Unknown'}
🔌 Plugin Version: ${results.version?.plugin || 'Not installed'}
${isFiltered ? `🔍 Filter: ${filterNames[filter]} (${filteredCount} of ${totalCount} checks)\n` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                      CURRENT SETTINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Backend:           ${backend}${backend === 'qdrant' ? ` (${qdrantMode})` : ''}
  Embedding Source:  ${source}
  Model:             ${model}${providerUrl !== 'n/a' ? `\n  Provider URL:      ${providerUrl}` : ''}${qdrantUrl ? `\n  Qdrant URL:        ${qdrantUrl}` : ''}
  Chunk Size:        ${settings.chunk_size || 500} chars (adaptive only)
  Score Threshold:   ${settings.score_threshold || 0.5}
  Query Depth:       ${settings.query || 3}
  Chat Auto-Sync:    ${settings.enabled_chats ? 'enabled' : 'disabled'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                         SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Passed:   ${String(totalPass).padStart(3)}${filter === 'pass' ? ' ◀ showing' : ''}
  ⚠ Warnings: ${String(totalWarn).padStart(3)}${filter === 'warning' ? ' ◀ showing' : ''}
  ✗ Failed:   ${String(totalFail).padStart(3)}${filter === 'fail' ? ' ◀ showing' : ''}
  ─────────────────
  Total:      ${String(totalCount).padStart(3)}

`;

    const categoryNames = {
        infrastructure: '🔧 INFRASTRUCTURE',
        configuration: '⚙️  CONFIGURATION',
        visualizer: '👁️  VISUALIZER',
        production: '🧪 PRODUCTION TESTS',
        console: '💻 CONSOLE LOGS'
    };

    for (const [category, checks] of Object.entries(results.categories)) {
        // Filter checks for this category
        const filteredCatChecks = checks.filter(filterCheck);
        if (filteredCatChecks.length === 0) continue;

        // Show filtered counts vs total for this category
        const catTotal = checks.length;
        const catFiltered = filteredCatChecks.length;
        const catStats = isFiltered
            ? `(${catFiltered} of ${catTotal})`
            : `(✓${checks.filter(c => c.status === 'pass').length} ⚠${checks.filter(c => c.status === 'warning').length} ✗${checks.filter(c => c.status === 'fail').length})`;

        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${categoryNames[category] || category.toUpperCase()}  ${catStats}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

        for (const check of filteredCatChecks) {
            const symbol = statusSymbols[check.status] || '?';
            const name = check.name.padEnd(28);
            report += `  ${symbol} ${name} ${check.message}\n`;
        }

        report += '\n';
    }

    // Add console errors if present (only when showing all or failures)
    if (results.consoleErrors && results.consoleErrors.length > 0 && (!isFiltered || filter === 'fail')) {
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💻 CONSOLE ERRORS CAPTURED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
        for (const error of results.consoleErrors) {
            report += `  [${error.type.toUpperCase()}] ${error.message}\n`;
            if (error.stack) {
                report += `           ${error.stack.split('\n')[0]}\n`;
            }
        }
        report += '\n';
    }

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                      END OF REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    // Copy to clipboard
    const filterMsg = isFiltered ? ` (${filterNames[filter]})` : '';
    navigator.clipboard.writeText(report).then(() => {
        toastr.success(`Diagnostics report${filterMsg} copied to clipboard`, 'VectTauri');
    }).catch(err => {
        log.error('Failed to copy:', err);
        toastr.error('Failed to copy report');
    });
}

/**
 * Opens the diagnostics modal (starts at selection phase)
 */
export function openDiagnosticsModal() {
    showDiagnosticsPhase('selection');
    $('#VectTauri_diagnostics_title').text('Run Diagnostics');
    $('#VectTauri_diagnostics_modal').fadeIn(200);
}

/**
 * Handles fixing all fixable issues
 * @param {Array} checks - Array of diagnostic checks
 */
function handleFixAll(checks) {
    const fixableChecks = checks.filter(c => c.fixable && (c.status === 'fail' || c.status === 'warning'));

    if (fixableChecks.length === 0) {
        toastr.info('No fixable issues found');
        return;
    }

    let fixedCount = 0;
    const statusIcons = {
        'pass': '<i class="fa-solid fa-circle-check" style="color: var(--vecttauri-success);"></i>'
    };

    fixableChecks.forEach(check => {
        try {
            handleDiagnosticFix(check.fixAction, true); // silent mode
            fixedCount++;

            // Update UI for this item
            $(`.diagnostic-item[data-fix-action="${check.fixAction}"]`)
                .removeClass('fail warning')
                .addClass('pass')
                .find('.diagnostic-icon').html(statusIcons.pass);
            $(`.diagnostic-item[data-fix-action="${check.fixAction}"] .diagnostic-fix-btn`).fadeOut(200);
        } catch (e) {
            log.warn(`Failed to fix: ${check.fixAction}`, e);
        }
    });

    // Hide Fix All button after use
    $('#VectTauri_diag_fix_all').fadeOut(200);

    toastr.success(`Fixed ${fixedCount} issue${fixedCount !== 1 ? 's' : ''}`);
}

/**
 * Handles diagnostic fix actions
 * @param {string} action - The fix action to perform
 * @param {boolean} silent - If true, suppress toast notifications and don't close modal
 */
function handleDiagnosticFix(action, silent = false) {
    const settings = extension_settings.vecttauri;

    switch (action) {
        case 'enable_chats':
            $('#VectTauri_autosync_enabled').prop('checked', true).trigger('change');
            if (!silent) toastr.success('Chat auto-sync enabled');
            break;

        case 'vectorize_all':
            $('#VectTauri_vectorize_all').click();
            break;

        case 'configure_provider':
            // Scroll to provider settings
            $('#VectTauri_provider_settings')[0]?.scrollIntoView({ behavior: 'smooth' });
            if (!silent) toastr.info('Please select an embedding provider');
            break;

        case 'configure_api_key':
            if (!silent) toastr.info('Go to Settings > API Connections to add your API key');
            break;

        case 'configure_url':
            // Scroll to provider settings
            $('#VectTauri_provider_settings')[0]?.scrollIntoView({ behavior: 'smooth' });
            if (!silent) toastr.info('Please configure your API URL in the provider settings');
            break;

        case 'fix_threshold':
            $('#VectTauri_score_threshold').val(0.25).trigger('change');
            if (!silent) toastr.success('Score threshold reset to 0.25');
            break;

        case 'fix_counts':
            if (settings.insert < 1) {
                $('#VectTauri_insert').val(3).trigger('change');
            }
            if ((settings.top_k ?? settings.insert) < 1) {
                $('#VectTauri_topk').val(3).trigger('change');
            }
            if (settings.query < 1) {
                $('#VectTauri_query').val(2).trigger('change');
            }
            if (!silent) toastr.success('Insert/Query counts fixed');
            break;

        case 'fix_chunk_size':
            $('#VectTauri_chunk_size').val(500).trigger('input');
            if (!silent) toastr.success('Chunk size reset to 500');
            break;

        case 'fix_qdrant_dimension':
            // This needs a dialog - don't auto-fix, show options
            if (!silent) {
                showQdrantDimensionFixDialog();
            }
            return; // Don't close modal

        default:
            if (!silent) toastr.error(`Unknown fix action: ${action}`);
    }

    // Only close modal for individual fixes (not batch Fix All)
    if (!silent) {
        setTimeout(() => {
            closeDiagnosticsModal();
        }, 500);
    }
}

/**
 * Shows a dialog with options to fix Qdrant dimension mismatch
 */
async function showQdrantDimensionFixDialog() {
    // Get the check data from the current diagnostics results
    const check = currentDiagnosticResults?.checks?.find(c => c.fixAction === 'fix_qdrant_dimension');
    const data = check?.data || {};

    const collectionDim = data.collectionDimension || '?';
    const currentDim = data.currentDimension || '?';
    const sources = data.collectionSources?.join(', ') || 'unknown';
    const models = data.collectionModels?.length > 0 ? data.collectionModels.join(', ') : '(not recorded)';
    const pointsCount = data.pointsCount || 0;

    const dialogHtml = `
        <div class="vecttauri-dimension-fix-dialog">
            <h3 style="margin-top: 0; color: var(--vecttauri-danger);">
                <i class="fa-solid fa-triangle-exclamation"></i> Vector Dimension Mismatch
            </h3>

            <div class="vecttauri-dimension-info" style="background: var(--SmartThemeBlurTintColor); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0;"><strong>Your Qdrant collection:</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>${collectionDim}</strong> dimensions</li>
                    <li>Source: <strong>${sources}</strong></li>
                    <li>Model: <strong>${models}</strong></li>
                    <li><strong>${pointsCount.toLocaleString()}</strong> vectors stored</li>
                </ul>

                <p style="margin: 12px 0 8px 0;"><strong>Your current embedding model:</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                    <li><strong>${currentDim}</strong> dimensions</li>
                </ul>
            </div>

            <p style="margin-bottom: 16px;">These dimensions don't match. You have two options:</p>

            <div class="vecttauri-dimension-options" style="display: flex; flex-direction: column; gap: 12px;">
                <button id="VectTauri_dim_fix_purge" class="vecttauri-btn-danger" style="padding: 12px; text-align: left;">
                    <i class="fa-solid fa-trash"></i>
                    <strong>Purge collection and start fresh</strong>
                    <br><small style="opacity: 0.8;">Delete all ${pointsCount.toLocaleString()} vectors and re-vectorize with your current model</small>
                </button>

                <button id="VectTauri_dim_fix_switch" class="vecttauri-btn-secondary" style="padding: 12px; text-align: left;">
                    <i class="fa-solid fa-rotate-left"></i>
                    <strong>I'll switch my embedding model back</strong>
                    <br><small style="opacity: 0.8;">Keep your vectors; change your embedding settings to match (${sources}${models !== '(not recorded)' ? ': ' + models : ''})</small>
                </button>

                <button id="VectTauri_dim_fix_cancel" class="vecttauri-btn-secondary" style="padding: 12px; text-align: left;">
                    <i class="fa-solid fa-clock"></i>
                    <strong>Hold off for now</strong>
                    <br><small style="opacity: 0.8;">I'll figure it out later</small>
                </button>
            </div>
        </div>
    `;

    // Use callGenericPopup for the dialog
    const { callGenericPopup, POPUP_TYPE } = await import('../../../../popup.js');

    callGenericPopup(dialogHtml, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        wide: false,
        allowVerticalScrolling: true,
    });

    // Bind button handlers
    $('#VectTauri_dim_fix_purge').off('click').on('click', async () => {
        // Close popup
        $('.popup-button-close').click();

        // Show confirmation
        const confirmHtml = `
            <p><strong>Are you sure you want to purge the Qdrant collection?</strong></p>
            <p>This will delete all <strong>${pointsCount.toLocaleString()}</strong> vectors permanently.</p>
            <p>You'll need to re-vectorize all your chats, lorebooks, and documents.</p>
        `;

        const confirmed = await callGenericPopup(confirmHtml, POPUP_TYPE.CONFIRM, '', {
            okButton: 'Yes, purge it',
            cancelButton: 'Cancel',
        });

        if (confirmed) {
            toastr.info('Purging Qdrant collection...');
            try {
                const { getRequestHeaders } = await import('../../../../../script.js');
                const response = await similharityFetch('/api/plugins/similharity/backend/qdrant/purge-collection', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ collectionName: 'VectTauri_main' })
                });

                if (response.ok) {
                    toastr.success('Qdrant collection purged! You can now re-vectorize your content.');
                    closeDiagnosticsModal();
                } else {
                    const error = await response.text();
                    toastr.error(`Failed to purge: ${error}`);
                }
            } catch (e) {
                toastr.error(`Purge failed: ${e.message}`);
            }
        }
    });

    $('#VectTauri_dim_fix_switch').off('click').on('click', () => {
        $('.popup-button-close').click();
        toastr.info(`Switch your embedding provider to "${sources}"${models !== '(not recorded)' ? ` with model "${models}"` : ''} to match your stored vectors.`);
        closeDiagnosticsModal();
        // Scroll to provider settings
        $('#VectTauri_provider_settings')[0]?.scrollIntoView({ behavior: 'smooth' });
    });

    $('#VectTauri_dim_fix_cancel').off('click').on('click', () => {
        $('.popup-button-close').click();
    });
}

/**
 * Hides diagnostics output
 */
export function hideDiagnosticsResults() {
    $('#VectTauri_diagnostics_output').hide();
}
