/**
 * ============================================================================
 * VectTauri CHUNK VISUALIZER
 * ============================================================================
 * Split-panel master/detail layout for browsing and editing chunks
 * Left panel: scrollable chunk list with search/filter/sort
 * Right panel: full details of selected chunk
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import {
    getChunkMetadata,
    saveChunkMetadata,
    deleteChunkMetadata,
} from '../core/collection-metadata.js';
import {
    deleteVectorItems,
    insertVectorItems,
    updateChunkText,
    updateChunkMetadata,
} from '../core/core-vector-api.js';
import { getStringHash } from '../../../../utils.js';
import { getContext } from '../../../../extensions.js';
import { eventSource, getRequestHeaders } from '../../../../../script.js';
import StringUtils from '../utils/string-utils.js';
import { packTimelineSortKey } from '../core/eventbase-schema.js';
import { log } from '../core/log.js';
import { getPluginUrl, similharityFetch } from '../utils/similharity-url.js';

// ============================================================================
// STATE
// ============================================================================

let currentResults = null;
let currentCollectionId = null;
let currentSettings = null;
let allChunks = [];
let filteredChunks = [];
// PERF: Lookup maps for O(1) chunk access instead of O(n) find() operations
let allChunksMap = new Map(); // uniqueId -> chunk
let filteredChunksMap = new Map(); // uniqueId -> index in filteredChunks
let selectedChunkId = null; // Use uniqueId, not hash (hashes can be duplicated)
let displayLimit = 50;
let chunkFetchLimit = 0; // 0 = no limit (fetch all)
let onReloadCallback = null;
let sortBy = 'index'; // 'index', 'length-desc', 'length-asc', 'keywords', 'modified'
let filterBy = 'all'; // 'all', 'enabled', 'disabled', 'conditions', 'blind'
let searchQuery = '';
let bulkSelectMode = false;
let selectedChunksSet = new Set(); // uniqueIds checked in bulk mode
let selectedHashes = new Set();
let hasUnsavedChanges = false;
let pendingChanges = new Map(); // hash -> {keywords, enabled, conditions, etc.}
let plaintextKeywordMode = false; // Toggle for plaintext keyword editing

// ============================================================================
// COLLECTION TYPE HELPERS
// ============================================================================

/**
 * Gets the appropriate icon for the collection type
 */
function getCollectionIcon() {
    const icons = {
        chat: '💬',
        file: '📄',
        lorebook: '📚',
        document: '📝',
    };
    return icons[currentResults?.collectionType] || '📦';
}

/**
 * EventBase collections store ingested events from chat history. They use a
 * dedicated retrieval pipeline (importance/persist/recency re-rank) that
 * ignores per-chunk metadata like enabled/keywords/conditions/links.
 * Catches both the new `vf_eventbase_*` prefix and legacy `vecthare_eventbase_*`.
 */
function isEventBaseCollection() {
    const id = String(currentCollectionId || '').toLowerCase();
    return id.startsWith('vf_eventbase_') || id.includes('_eventbase_');
}

// ============================================================================
// CHUNK DATA HELPERS
// ============================================================================

// Phase B (read-source refactor): the vector backend payload is the source of truth for
// per-chunk fields. These are the ONLY fields still persisted to extension_settings on save
// — genuinely client-only state with no backend payload representation. Everything else goes
// to the backend via updateChunkMetadata. See plans/chunk-metadata-read-source-fix.md.
const CLIENT_ONLY_CHUNK_FIELDS = ['summaries'];

/**
 * Normalize keywords to the new format: { text: string, weight: number }
 * Handles migration from old string[] format
 * Weight is a MULTIPLIER: 1.0 = no boost, 1.5 = 50% boost, 2.0 = double
 */
function normalizeKeywords(keywords) {
    if (!keywords || !Array.isArray(keywords)) return [];
    return keywords.map(k => {
        // Old format: just a string
        if (typeof k === 'string') {
            return { text: k, weight: 1.5 }; // Default boost for legacy keywords
        }
        // New format: { text, weight }
        if (k && typeof k === 'object' && k.text) {
            return { text: k.text, weight: k.weight ?? 1.0 };
        }
        return null;
    }).filter(Boolean);
}

function getChunkData(chunk) {
    const stored = getChunkMetadata(chunk.hash) || {};
    const dbMeta = chunk.metadata || {};

    // Backend (Vectra/Qdrant payload) is the source of truth; extension_settings is a legacy
    // fallback for entries the backend lacks (e.g. pre-fix text-edited chunks — see
    // plans/chunk-metadata-read-source-fix.md). pick: first non-null wins. pickStr: also
    // treats '' as absent so an empty string means "use fallback", not "explicitly blank".
    const pick = (a, b) => (a !== undefined && a !== null ? a : b);
    const pickStr = (a, b) => (a !== undefined && a !== null && a !== '' ? a : b);

    // keywords: prefer non-empty backend array, then ext_settings override, then raw chunk keywords
    const keywords = (Array.isArray(dbMeta.keywords) && dbMeta.keywords.length > 0)
        ? dbMeta.keywords
        : (stored.keywords !== undefined ? stored.keywords : (chunk.keywords || []));

    return {
        hash: chunk.hash,
        index: chunk.index,
        text: chunk.text,
        score: chunk.score || 1,
        similarity: chunk.similarity || 1,
        messageAge: chunk.messageAge,
        // enabled defaults true; an explicit false (from either store) must survive
        enabled: pick(dbMeta.enabled, stored.enabled) !== false,
        keywords: normalizeKeywords(keywords),
        conditions: dbMeta.conditions || stored.conditions || { enabled: false, logic: 'AND', rules: [] },
        chunkLinks: dbMeta.chunkLinks || stored.chunkLinks || [],
        summaries: stored.summaries || [], // client-only (dual-vector summaries), unchanged
        name: pickStr(dbMeta.name, stored.name) ?? null,
        // Prompt context (existing)
        context: pickStr(dbMeta.context, stored.context) ?? '',
        xmlTag: pickStr(dbMeta.xmlTag, stored.xmlTag) ?? '',
        // Injection position/depth (null = use collection/global default; 0 is a valid value)
        position: pick(dbMeta.position, stored.position) ?? null,
        depth: pick(dbMeta.depth, stored.depth) ?? null,
        // EventBase-specific fields (read-only, from DB payload)
        eventType: chunk.metadata?.event_type || null,
        importance: chunk.metadata?.importance ?? null,
        concepts: chunk.metadata?.concepts || [],
        openThreads: chunk.metadata?.open_threads || [],
        eventItems: chunk.metadata?.items || [],
        // Real-world send-time anchor (message send_date). Deterministic metadata,
        // NOT part of the editable embed text — surfaced read-only in the info bar.
        realWorldDate: chunk.metadata?.real_world_date || null,
    };
}

function updateChunkData(hash, updates) {
    const existing = pendingChanges.get(hash) || {};
    pendingChanges.set(hash, { ...existing, ...updates });
    hasUnsavedChanges = true;
        // refresh the chunk data
        allChunks.forEach(chunk => {
            if (chunk.hash === hash) {
                // merge pending changes into the chunk for fresh data if chunks end up with same hash somehow.
                const stored = getChunkMetadata(hash) || {};
                const pending = pendingChanges.get(hash) || {};
                chunk.data = { ...chunk.data, ...pending };
            }
        });
}

async function saveAllChanges() {
    const count = pendingChanges.size;
    if (count === 0) {
        toastr.info('No changes to save', 'VectTauri');
        return;
    }

    try {
        for (const [hash, updates] of pendingChanges) {
            // Check what kind of update is needed
            if (updates.text) {
                // Text changed - requires re-embedding
                await updateChunkText(currentCollectionId, hash, updates.text, currentSettings);
            }

            // Handle new summaries - vectorize them
            if (updates._newSummaries?.length > 0) {
                for (const summaryText of updates._newSummaries) {
                    const summaryHash = getStringHash(summaryText);
                    const summaryItem = {
                        text: summaryText,
                        hash: summaryHash,
                        index: 0,
                        keywords: [],
                        metadata: {
                            isSummary: true,
                            parentHash: hash,
                            contentType: 'summary',
                        },
                    };
                    await insertVectorItems(currentCollectionId, [summaryItem], currentSettings);
                }
            }

            // Handle deleted summaries - remove vectors
            if (updates._deletedSummaries?.length > 0) {
                const hashesToDelete = updates._deletedSummaries.map(text => getStringHash(text));
                await deleteVectorItems(currentCollectionId, hashesToDelete, currentSettings);
            }

            // Phase B (no dual write): the vector backend is the source of truth for
            // per-chunk fields (name/context/xmlTag/position/depth/keywords/conditions/
            // enabled/chunkLinks). Only genuinely client-only state — dual-vector
            // `summaries`, which has no backend payload field — is persisted to
            // extension_settings. See plans/chunk-metadata-read-source-fix.md (W1).
            const clientOnly = {};
            for (const k of CLIENT_ONLY_CHUNK_FIELDS) {
                if (k in updates) clientOnly[k] = updates[k];
            }
            if (Object.keys(clientOnly).length > 0) {
                const existing = getChunkMetadata(hash) || {};
                saveChunkMetadata(hash, { ...existing, ...clientOnly });
            }

            // Send per-chunk metadata to the backend (the only durable store now).
            const metadataUpdates = { ...updates };
            delete metadataUpdates.text;
            delete metadataUpdates._newSummaries;
            delete metadataUpdates._deletedSummaries;

            if (Object.keys(metadataUpdates).length > 0 ) {
                // Send metadata updates (keywords, conditions, etc.) to backend
                try {
                    await updateChunkMetadata(currentCollectionId, hash, metadataUpdates, currentSettings);
                    // Keep the in-memory backend payload fresh so backend-first reads
                    // (getChunkData) reflect the save without a full reload from the backend.
                    allChunks.forEach(c => {
                        if (c.hash === hash) {
                            c.metadata = { ...(c.metadata || {}), ...metadataUpdates };
                        }
                    });
                } catch (e) {
                    // Backend is now the only store for these fields, so a failure means the
                    // change did NOT persist — surface it instead of swallowing it.
                    console.error('VectTauri: Failed to save chunk metadata to backend:', e);
                    toastr.error(`Failed to save chunk metadata to the backend — change not persisted: ${e.message}`, 'VectTauri');
                    throw e;
                }
            }
        }

        pendingChanges.clear();
        hasUnsavedChanges = false;
        toastr.success(`Saved changes to ${count} chunk(s)`, 'VectTauri');
    } catch (error) {
        console.error('VectTauri: Failed to save changes', error);
        toastr.error(`Failed to save changes: ${error.message}`, 'VectTauri');
    }
}

function discardAllChanges() {
    pendingChanges.clear();
    hasUnsavedChanges = false;
    // Reload chunk data from stored metadata
    allChunks = allChunks.map(chunk => ({
        ...chunk,
        data: getChunkData(chunk)
    }));
    // PERF: Rebuild lookup map after allChunks modification
    allChunksMap = new Map(allChunks.map(c => [c.uniqueId, c]));
    renderChunkList();
    renderDetailPanel();
}

// ============================================================================
// MAIN API
// ============================================================================

export function openVisualizer(results, collectionId, settings, onReload = null) {
    currentResults = results;
    currentCollectionId = collectionId;
    currentSettings = settings;
    onReloadCallback = onReload;
    selectedChunkId = null;
    displayLimit = 50;
    searchQuery = '';
    bulkSelectMode = false;
    selectedChunksSet.clear();
    selectedHashes.clear();
    pendingChanges.clear();
    hasUnsavedChanges = false;

    // Process chunks - add unique identifier for each chunk
    allChunks = (results?.chunks || []).map((chunk, idx) => ({
        ...chunk,
        uniqueId: `chunk_${idx}_${chunk.hash}`, // Create truly unique ID
        data: getChunkData(chunk)
    }));
    // PERF: Build lookup map for O(1) chunk access
    allChunksMap = new Map(allChunks.map(c => [c.uniqueId, c]));

    applyFilters();
    createModal();
    // Sync persisted UI state into the freshly-rendered dropdowns. createModal()
    // rebuilds the HTML, so without this the dropdowns silently revert to their
    // first option on reload while sortBy/filterBy retain the user's choice.
    $('#VectTauri_chunk_sort').val(sortBy);
    $('#VectTauri_chunk_filter').val(filterBy);
    renderChunkList();
    renderDetailPanel();
    bindEvents();

    $('#VectTauri_visualizer_modal').fadeIn(200);

    // Async fetch collection-level metadata (sentinel point) and render in footer.
    // Read-only — surfaces internal lock state without making it look editable.
    _loadAndRenderCollectionMetaFooter(collectionId, settings).catch(err => {
        console.debug('[VectTauri] Collection metadata footer load skipped:', err?.message);
    });
}

async function _loadAndRenderCollectionMetaFooter(collectionId, settings) {
    // Only Qdrant collections carry the sentinel today.
    if ((settings?.vector_backend || 'standard') !== 'qdrant') return;
    const backend = 'qdrant';

    // Strip any registry prefix (e.g. "qdrant:foo:bar" → "foo:bar") and resolve actual collection name.
    const stripped = String(collectionId).startsWith('qdrant:')
        ? String(collectionId).substring(7)
        : String(collectionId);
    const actualCollectionId = stripped.includes(':') ? stripped.split(':')[1] : stripped;

    let resp;
    try {
        resp = await similharityFetch('/api/plugins/similharity/chunks/collection-metadata', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ backend, collectionId: actualCollectionId }),
        });
    } catch {
        return;
    }
    if (!resp.ok) return;
    const data = await resp.json().catch(() => null);
    const payload = data?.payload;
    if (!payload || typeof payload !== 'object') return;

    // Surface only the keys that matter for diagnostics. Skip vector/zero junk.
    const interesting = {};
    if (payload.cjk_tokenizer_mode) interesting.cjk_tokenizer_mode = payload.cjk_tokenizer_mode;
    if (payload.migrated_at)        interesting.migrated_at        = new Date(payload.migrated_at).toISOString();
    if (payload.updated_at)         interesting.updated_at         = new Date(payload.updated_at).toISOString();
    if (payload.migrated_from)      interesting.migrated_from      = payload.migrated_from;

    if (Object.keys(interesting).length === 0) return;

    const lines = Object.entries(interesting)
        .map(([k, v]) => `<span style="margin-right:1.2em;"><b>${StringUtils.escapeHtml(k)}</b>: ${StringUtils.escapeHtml(v)}</span>`)
        .join('');

    $('#VectTauri_collection_meta_footer')
        .html(`<span style="margin-right:0.8em;">🔒 Collection metadata (read-only, internal — do not delete the sentinel point in Qdrant):</span>${lines}`)
        .show();
}

export function closeVisualizer() {
    if (hasUnsavedChanges) {
        if (!confirm('You have unsaved text changes. Are you sure you want to close?')) {
            return;
        }
    }
    hasUnsavedChanges = false;
    $('#VectTauri_visualizer_modal').fadeOut(200);
    currentResults = null;
    currentCollectionId = null;
    selectedChunkId = null;
}

// ============================================================================
// FILTERING & SORTING
// ============================================================================

/**
 * Whole-timeline sort value for a chunk, in true chat-history order.
 *
 * Newer EventBase chunks carry `timeline_sort_key` (window_start * STRIDE +
 * event_order) — several events from one big window keep their real order, and
 * windows processed out of order by the parallel pool still land correctly.
 *
 * Older chunks (pre-timeline_sort_key EventBase, legacy chunk/document/lorebook
 * data) lack that field. They fall back to their message number packed onto the
 * SAME scale (msg * STRIDE), so a database holding a mix of old and new chunks
 * sorts as one coherent sequence instead of splitting into two blocks. Chunks
 * with no order signal at all coalesce to 0.
 * @param {object} chunk
 * @returns {number}
 */
function chunkTimelineSortValue(chunk) {
    const meta = chunk.metadata || {};
    if (typeof meta.timeline_sort_key === 'number') return meta.timeline_sort_key;
    const messageNumber = meta.source_window_start ?? meta.source_window_end ?? chunk.index ?? 0;
    return packTimelineSortKey(messageNumber, 0);
}

function applyFilters() {
    let chunks = [...allChunks];

    // Search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        chunks = chunks.filter(c =>
            c.text.toLowerCase().includes(q) ||
            c.data.name?.toLowerCase().includes(q) ||
            c.data.keywords.some(k => k.text.toLowerCase().includes(q))
        );
    }

    // Filter
    switch (filterBy) {
        case 'enabled':
            chunks = chunks.filter(c => c.data.enabled);
            break;
        case 'disabled':
            chunks = chunks.filter(c => !c.data.enabled);
            break;
        case 'conditions':
            chunks = chunks.filter(c => c.data.conditions?.enabled && c.data.conditions?.rules?.length > 0);
            break;
        case 'keywords':
            chunks = chunks.filter(c => c.data.keywords?.length > 0);
            break;
    }

    // Sort
    switch (sortBy) {
        case 'length-desc':
            chunks.sort((a, b) => (b.data.text?.length || 0) - (a.data.text?.length || 0));
            break;
        case 'length-asc':
            chunks.sort((a, b) => (a.data.text?.length || 0) - (b.data.text?.length || 0));
            break;
        case 'keywords':
            chunks.sort((a, b) => (b.data.keywords?.length || 0) - (a.data.keywords?.length || 0));
            break;
        case 'modified':
            // Sort by whether chunk has customizations (keywords, conditions, name)
            chunks.sort((a, b) => {
                const aModified = (a.data.keywords?.length || 0) + (a.data.conditions?.rules?.length || 0) + (a.data.name ? 1 : 0);
                const bModified = (b.data.keywords?.length || 0) + (b.data.conditions?.rules?.length || 0) + (b.data.name ? 1 : 0);
                return bModified - aModified;
            });
            break;
        case 'index-r':
            chunks.sort((a, b) => chunkTimelineSortValue(b) - chunkTimelineSortValue(a));
            break;
        default: // 'index'
            chunks.sort((a, b) => chunkTimelineSortValue(a) - chunkTimelineSortValue(b));
    }

    filteredChunks = chunks;
    // PERF: Build lookup map for O(1) position lookup
    filteredChunksMap = new Map(filteredChunks.map((c, idx) => [c.uniqueId, idx]));
}

// ============================================================================
// MODAL CREATION
// ============================================================================

function createModal() {
    // Remove existing
    $('#VectTauri_visualizer_modal').remove();

    const collectionName = currentCollectionId || 'Collection';
    const icon = getCollectionIcon();
    const dbChunkCount = Number(currentResults?.dbChunkCount);
    const dbChunkText = Number.isFinite(dbChunkCount) && dbChunkCount >= 0
        ? dbChunkCount.toLocaleString()
        : 'Unknown';

    const html = `
        <div id="VectTauri_visualizer_modal" class="vecttauri-visualizer-modal">
            <div class="vecttauri-visualizer-container">
                <!-- Header -->
                <div class="vecttauri-visualizer-header">
                    <div class="vecttauri-visualizer-title">
                        <span class="vecttauri-visualizer-title-icon">${icon}</span>
                        <span>${StringUtils.escapeHtml(collectionName)}</span>
                    </div>
                    <div class="vecttauri-visualizer-header-actions">
                        <button class="vecttauri-visualizer-save" id="VectTauri_visualizer_save" title="Save changes">
                            <i class="fa-solid fa-floppy-disk"></i> Save
                        </button>
                        <button class="vecttauri-visualizer-close" id="VectTauri_visualizer_close">✕</button>
                    </div>
                </div>

                <!-- Body: Chunk Split Panel -->
                <div class="vecttauri-visualizer-body">
                    <!-- Left: Chunk List -->
                    <div class="vecttauri-chunk-list-panel">
                        <div class="vecttauri-list-toolbar">
                            <input type="text" class="vecttauri-list-search" id="VectTauri_chunk_search" placeholder="🔍 Search...">
                            <div class="vecttauri-list-controls">
                                <select class="vecttauri-list-sort" id="VectTauri_chunk_sort">
                                    <option value="index">Sort: Message Order</option>
                                    <option value="length-desc">Sort: Longest First</option>
                                    <option value="length-asc">Sort: Shortest First</option>
                                    <option value="keywords">Sort: Most Keywords</option>
                                    <option value="modified">Sort: Recently Modified</option>
                                    <option value="index-r">Sort: Message order Reversed</option>

                                </select>
                                <select class="vecttauri-list-filter" id="VectTauri_chunk_filter">
                                    <option value="all">Filter: All</option>
                                    <option value="enabled">Enabled</option>
                                    <option value="disabled">Disabled</option>
                                    <option value="keywords">Has Keywords</option>
                                    <option value="conditions">Has Conditions</option>
                                </select>
                            </div>
                                <div class="vecttauri-fetch-limit-control">
                                    <label>Fetch limit:</label>
                                    <input type="number" id="VectTauri_fetch_limit" min="0" max="99999" step="100" value="${chunkFetchLimit}" title="Max chunks loaded from server (0 = all)">
                                    <button id="VectTauri_reload_chunks" title="Reload chunks from server with new limit">↺ Reload</button>
                                </div>
                                <div class="vecttauri-db-total" id="VectTauri_db_chunk_total">DB max chunks: ${dbChunkText}</div>
                        </div>
                        <div class="vecttauri-chunk-list" id="VectTauri_chunk_list"></div>
                        <div class="vecttauri-bulk-actions">
                            <label class="vecttauri-bulk-toggle">
                                <input type="checkbox" id="VectTauri_bulk_mode">
                                <span>Bulk Select Mode</span>
                            </label>
                            <div class="vecttauri-bulk-buttons" id="VectTauri_bulk_buttons" style="display: none;">
                                <button class="vecttauri-bulk-btn" id="VectTauri_bulk_enable">Enable All</button>
                                <button class="vecttauri-bulk-btn" id="VectTauri_bulk_disable">Disable All</button>
                                <button class="vecttauri-bulk-btn vecttauri-bulk-btn-danger" id="VectTauri_bulk_delete">Delete Selected</button>
                            </div>
                        </div>
                        <div class="vecttauri-list-status" id="VectTauri_list_status"></div>
                    </div>

                    <!-- Right: Detail Panel -->
                    <div class="vecttauri-chunk-detail-panel" id="VectTauri_detail_panel">
                        <div class="vecttauri-detail-empty">Select a chunk to view details</div>
                    </div>
                </div>

                <!-- Read-only collection metadata footer (sentinel point). Populated async after modal opens. -->
                <div class="vecttauri-visualizer-meta-footer" id="VectTauri_collection_meta_footer" style="display:none; padding: 8px 16px; border-top: 1px solid var(--grey30); font-size: 0.78em; color: var(--SmartThemeBodyColor); opacity: 0.7; font-family: monospace;"></div>
            </div>
        </div>
    `;

    $('body').append(html);
}

// ============================================================================
// CHUNK LIST RENDERING
// ============================================================================

function renderChunkList() {
    const container = $('#VectTauri_chunk_list');
    const displayChunks = filteredChunks.slice(0, displayLimit);

    let html = displayChunks.map((chunk, idx) => renderChunkItem(chunk, idx)).join('');

    if (filteredChunks.length > displayLimit) {
        html += `<div class="vecttauri-load-more" id="VectTauri_load_more">[Load ${Math.min(50, filteredChunks.length - displayLimit)} more...]</div>`;
    }

    container.html(html);
    updateStatusBar();
}

function renderChunkItem(chunk, listIndex) {
    const data = chunk.data;
    const isSelected = chunk.uniqueId === selectedChunkId;
    const hasConditions = data.conditions?.enabled && data.conditions?.rules?.length > 0;
    const hasKeywords = data.keywords?.length > 0;

    // Use the display position in the filtered/sorted list (1-based)
    const displayNumber = listIndex + 1;

    // Create a text preview (first ~60 chars, clean it up)
    const textPreview = data.text
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 60) + (data.text.length > 60 ? '...' : '');

    // Use custom name if set, otherwise show text preview
    const displayName = data.name || textPreview;

    // Calculate text length for display
    const textLength = data.text?.length || 0;
    const textLengthDisplay = textLength > 1000 ? `${(textLength / 1000).toFixed(1)}k` : textLength;

    // Message info from metadata. For windowed EventBase chunks, show the source
    // window's message range plus the event's order within that window (decoded
    // from the same fields that drive the timeline sort) — e.g. "Msg 2527–2531 ·
    // #3" — so multiple events extracted from one big window are told apart.
    // Legacy chunks (no window fields) keep the plain "Msg <n>" form.
    const msgId = chunk.metadata?.messageId ?? chunk.index ?? '?';
    const windowStart = chunk.metadata?.source_window_start;
    const windowEnd = chunk.metadata?.source_window_end;
    const eventOrder = chunk.metadata?.window_event_order;
    let msgLabel = `Msg ${msgId}`;
    if (windowStart != null && windowEnd != null && windowEnd !== windowStart) {
        msgLabel = `Msg ${windowStart}–${windowEnd}`;
    }
    if (typeof eventOrder === 'number') {
        msgLabel += ` · #${eventOrder + 1}`;
    }
    const chunkIdx = chunk.metadata?.chunkIndex ?? 0;
    const totalChunks = chunk.metadata?.totalChunks ?? 1;

    // Build info badges
    const infoBadges = [];
    infoBadges.push(`<span class="vecttauri-chunk-item-badge msg">${msgLabel}</span>`);
    if (totalChunks > 1) {
        infoBadges.push(`<span class="vecttauri-chunk-item-badge chunk-part">${chunkIdx + 1}/${totalChunks}</span>`);
    }
    infoBadges.push(`<span class="vecttauri-chunk-item-badge chars">${textLengthDisplay} chars</span>`);

    // Build feature badges
    const featureBadges = [];
    if (hasConditions) featureBadges.push(`<span class="vecttauri-chunk-item-badge conditions" title="Has ${data.conditions.rules.length} condition(s)">⚡${data.conditions.rules.length}</span>`);
    if (hasKeywords) featureBadges.push(`<span class="vecttauri-chunk-item-badge keywords" title="Has ${data.keywords.length} keyword(s)">🏷️${data.keywords.length}</span>`);

    const bulkCheckbox = bulkSelectMode
        ? `<input type="checkbox" class="vecttauri-bulk-checkbox" data-uid="${chunk.uniqueId}" ${selectedChunksSet.has(chunk.uniqueId) ? 'checked' : ''} title="Select for bulk action">`
        : '';

    return `
        <div class="vecttauri-chunk-item ${isSelected ? 'selected' : ''} ${!data.enabled ? 'disabled' : ''} ${bulkSelectMode && selectedChunksSet.has(chunk.uniqueId) ? 'bulk-checked' : ''}"
             data-uid="${chunk.uniqueId}" data-list-index="${listIndex}">
            ${bulkCheckbox}
            <div class="vecttauri-chunk-item-content">
                <div class="vecttauri-chunk-item-header">
                    <span class="vecttauri-chunk-item-index">${displayNumber}.</span>
                    <span class="vecttauri-chunk-item-name">${StringUtils.escapeHtml(displayName)}</span>
                </div>
                <div class="vecttauri-chunk-item-stats">
                    <div class="vecttauri-chunk-item-badges info-badges">${infoBadges.join('')}</div>
                    ${featureBadges.length > 0 ? `<div class="vecttauri-chunk-item-badges feature-badges">${featureBadges.join('')}</div>` : ''}
                </div>
            </div>
        </div>
    `;
}

function updateStatusBar() {
    const shown = filteredChunks.length;
    let withConditions = 0;
    let withKeywords = 0;
    for (const c of allChunks) {
        if (c.data.conditions?.enabled && c.data.conditions?.rules?.length > 0) withConditions++;
        if (c.data.keywords?.length > 0) withKeywords++;
    }

    $('#VectTauri_list_status').html(`
        <span>${shown} chunks</span>
        ${withKeywords > 0 ? `<span>• 🏷️${withKeywords}</span>` : ''}
        ${withConditions > 0 ? `<span>• ⚡${withConditions}</span>` : ''}
    `);
}

// ============================================================================
// DETAIL PANEL RENDERING
// ============================================================================

function renderDetailPanel() {
    const panel = $('#VectTauri_detail_panel');

    if (!selectedChunkId) {
        panel.html('<div class="vecttauri-detail-empty">Select a chunk to view details</div>');
        return;
    }

    // PERF: Use Map for O(1) lookup instead of O(n) find()
    const chunk = allChunksMap.get(selectedChunkId);
    if (!chunk) {
        console.error('VectTauri: Chunk not found for uniqueId:', selectedChunkId);
        panel.html('<div class="vecttauri-detail-empty">Chunk not found</div>');
        return;
    }

    const data = chunk.data;
    const wordCount = data.text.split(/\s+/).filter(Boolean).length;
    const tokenEstimate = Math.round(wordCount * 1.3);

    // PERF: Use Map for O(1) lookup instead of O(n) findIndex()
    const listPosition = filteredChunksMap.get(selectedChunkId);
    const displayNumber = listPosition !== undefined ? listPosition + 1 : '?';

    const hasConditions = data.conditions?.enabled && data.conditions?.rules?.length > 0;
    const hasSummaries = data.summaries?.length > 0;

    // Feature gating — EventBase chat ignores per-chunk enabled/keywords/conditions/links
    // (its retrieval re-ranks by importance/persist/recency). XML tag and injection
    // position still apply because they're consumed at the post-retrieval injection stage.
    const isEventBase = isEventBaseCollection();
    const showEnabledToggle = !isEventBase;
    const showKeywords = !isEventBase;
    const showConditions = !isEventBase;
    const showChunkLinks = !isEventBase;

    panel.html(`
        <!-- Header -->
        <div class="vecttauri-detail-header">
            <!-- Chunk Name - Primary/Biggest -->
            <div class="vecttauri-detail-name-section">
                <input type="text" class="vecttauri-chunk-name-input" id="VectTauri_chunk_name"
                       placeholder="Name this chunk..."
                       value="${StringUtils.escapeHtml(data.name || '')}">
            </div>
            <button class="vecttauri-detail-delete${bulkSelectMode ? ' vecttauri-btn-dimmed' : ''}" id="VectTauri_delete_chunk" ${bulkSelectMode ? 'disabled' : ''}>
                <i class="fa-solid fa-trash"></i> Delete
            </button>
        </div>

        <!-- Chunk Info Bar - Secondary -->
        <div class="vecttauri-detail-info-bar">
            <span class="vecttauri-info-item">
                <span class="vecttauri-info-label">Chunk</span>
                <span class="vecttauri-info-value">#${displayNumber}</span>
            </span>
            <span class="vecttauri-info-divider">•</span>
            <span class="vecttauri-info-item">
                <span class="vecttauri-info-label">from Message</span>
                <span class="vecttauri-info-value">#${chunk.index}</span>
            </span>
            ${data.realWorldDate ? `
            <span class="vecttauri-info-divider">•</span>
            <span class="vecttauri-info-item" title="Real-world send time of the source message (fallback date anchor — NOT the in-story TIME)">
                <span class="vecttauri-info-label">Real-world</span>
                <span class="vecttauri-info-value">${StringUtils.escapeHtml(String(data.realWorldDate))}</span>
            </span>` : ''}
            <span class="vecttauri-info-divider">•</span>
            <span class="vecttauri-info-item vecttauri-info-hash" title="Click to copy hash" id="VectTauri_copy_hash">
                <span class="vecttauri-info-value">${chunk.hash}</span>
            </span>
        </div>

        <!-- Content -->
        <div class="vecttauri-detail-content">
            <!-- Text Block - Inline Editable -->
            <div class="vecttauri-detail-text-block">
                <div class="vecttauri-detail-text" id="VectTauri_chunk_text" contenteditable="true">${StringUtils.escapeHtml(data.text)}</div>
                <div class="vecttauri-detail-text-meta">
                    <span>${wordCount} words • ~${tokenEstimate} tokens</span>
                    <button class="vecttauri-detail-save-btn vecttauri-hidden" id="VectTauri_save_text">
                        <i class="fa-solid fa-save"></i> Save & Re-embed
                    </button>
                </div>
            </div>

            <!-- EventBase Metadata Section (read-only) -->
            ${isEventBase ? `
            <div class="vecttauri-detail-section vecttauri-eventbase-meta">
                <div class="vecttauri-detail-section-title">
                    <i class="fa-solid fa-database"></i> Event Metadata
                    <span class="vecttauri-section-hint">(extracted by EventBase)</span>
                </div>
                <div class="vecttauri-eventbase-meta-grid">
                    <div class="vecttauri-meta-row">
                        <span class="vecttauri-meta-label">Type</span>
                        <span class="vecttauri-meta-value">${data.eventType
                            ? `<span class="vecttauri-event-type-badge">${StringUtils.escapeHtml(data.eventType)}</span>`
                            : '<span class="vecttauri-meta-empty">—</span>'}</span>
                    </div>
                    <div class="vecttauri-meta-row">
                        <span class="vecttauri-meta-label">Importance</span>
                        <span class="vecttauri-meta-value">${data.importance != null
                            ? `<span class="vecttauri-importance-badge vecttauri-imp-${Math.min(10, Math.max(1, Math.round(data.importance)))}">${data.importance}<span class="vecttauri-imp-scale">/10</span></span>`
                            : '<span class="vecttauri-meta-empty">—</span>'}</span>
                    </div>
                    <div class="vecttauri-meta-row">
                        <span class="vecttauri-meta-label">Concepts</span>
                        <span class="vecttauri-meta-value">${data.concepts.length
                            ? data.concepts.map(c => `<span class="vecttauri-concept-tag">${StringUtils.escapeHtml(c)}</span>`).join('')
                            : '<span class="vecttauri-meta-empty">—</span>'}</span>
                    </div>
                    <div class="vecttauri-meta-row">
                        <span class="vecttauri-meta-label">Items</span>
                        <span class="vecttauri-meta-value">${data.eventItems.length
                            ? data.eventItems.map(it => `<span class="vecttauri-concept-tag">${StringUtils.escapeHtml(it)}</span>`).join('')
                            : '<span class="vecttauri-meta-empty">—</span>'}</span>
                    </div>
                    ${data.openThreads.length ? `
                    <div class="vecttauri-meta-row vecttauri-meta-row-full">
                        <span class="vecttauri-meta-label">Open Threads</span>
                        <ul class="vecttauri-open-threads-list">
                            ${data.openThreads.map(t => `<li>${StringUtils.escapeHtml(t)}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                </div>
            </div>
            ` : ''}

            <!-- Status Section -->
            ${showEnabledToggle ? `
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-title">Status</div>
                <div class="vecttauri-detail-status-row">
                    ${showEnabledToggle ? `
                    <div class="vecttauri-detail-toggle-item">
                        <span class="vecttauri-toggle-label">Enabled</span>
                        <label class="vecttauri-toggle-switch">
                            <input type="checkbox" id="VectTauri_detail_enabled" ${data.enabled ? 'checked' : ''}>
                            <span class="vecttauri-toggle-slider"></span>
                        </label>
                    </div>
                    ` : ''}
                </div>
            </div>
            ` : ''}

            <!-- Prompt Context Section -->
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-title">
                    <i class="fa-solid fa-quote-left"></i> Prompt Context
                    <span class="vecttauri-section-hint">(help AI understand this chunk)</span>
                </div>
                <div class="vecttauri-detail-context">
                    <textarea class="vecttauri-chunk-context-input" id="VectTauri_chunk_context"
                              placeholder="e.g., A secret {{char}} keeps hidden from {{user}}"
                              rows="2">${StringUtils.escapeHtml(data.context || '')}</textarea>
                    <div class="vecttauri-context-xmltag-row">
                        <label>XML tag:</label>
                        <input type="text" class="vecttauri-chunk-xmltag-input" id="VectTauri_chunk_xmltag"
                               placeholder="e.g., secret" value="${StringUtils.escapeHtml(data.xmlTag || '')}">
                    </div>
                    <div class="vecttauri-context-injection-row">
                        <label>Injection position:</label>
                        <select id="VectTauri_chunk_position" class="vecttauri-chunk-position-select">
                            <option value="" ${data.position == null ? 'selected' : ''}>Use default</option>
                            <option value="2" ${data.position === 2 ? 'selected' : ''}>Before Main Prompt</option>
                            <option value="0" ${data.position === 0 ? 'selected' : ''}>After Main Prompt</option>
                            <option value="1" ${data.position === 1 ? 'selected' : ''}>In-Chat @ Depth</option>
                        </select>
                    </div>
                    <div class="vecttauri-context-depth-row" id="VectTauri_chunk_depth_row" style="display: ${data.position === 1 ? 'flex' : 'none'};">
                        <label>Depth: <span id="VectTauri_chunk_depth_value">${data.depth ?? 2}</span></label>
                        <input type="range" id="VectTauri_chunk_depth" class="vecttauri-chunk-depth-slider"
                               min="0" max="50" step="1" value="${data.depth ?? 2}">
                    </div>
                    <div class="vecttauri-context-hint">Supports {{user}} and {{char}}. XML tag wraps just this chunk.</div>
                </div>
            </div>

            <!-- Keywords Section -->
            ${showKeywords ? `
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-header">
                    <span class="vecttauri-detail-section-title">Keywords <span class="vecttauri-section-hint">(boost when query matches)</span></span>
                    <button class="vecttauri-keyword-mode-toggle" id="VectTauri_keyword_mode" title="Toggle plaintext mode">
                        <i class="fa-solid ${plaintextKeywordMode ? 'fa-tag' : 'fa-code'}"></i>
                    </button>
                </div>
                <div class="vecttauri-detail-keywords" id="VectTauri_keywords_container">
                    ${plaintextKeywordMode ? `
                        <textarea class="vecttauri-keyword-plaintext" id="VectTauri_keywords_plaintext" placeholder="keyword:1.5x, another:2x, plain">${data.keywords.map(k => k.weight !== 1.0 ? `${k.text}:${k.weight}x` : k.text).join(', ')}</textarea>
                        <div class="vecttauri-keyword-plaintext-hint">Format: keyword:2x for boost, or just keyword (defaults to 1.5x)</div>
                    ` : `
                        <div class="vecttauri-keywords-list">
                            ${data.keywords.map((k, idx) => `
                                <span class="vecttauri-keyword-tag" data-index="${idx}">
                                    <span class="vecttauri-keyword-tag-text">${StringUtils.escapeHtml(k.text || 'unnamed')}</span>
                                    <span class="vecttauri-keyword-tag-weight">${k.weight}x</span>
                                    <i class="fa-solid fa-xmark vecttauri-keyword-remove" data-index="${idx}"></i>
                                </span>
                            `).join('')}
                        </div>
                        <button class="vecttauri-keyword-add" id="VectTauri_add_keyword">+ Add keyword...</button>
                    `}
                </div>
            </div>
            ` : ''}

            <!-- Conditions Section -->
            ${showConditions ? `
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-title">Conditions</div>
                <div class="vecttauri-detail-conditions">
                    <div class="vecttauri-conditions-header">
                        <label class="vecttauri-conditions-toggle">
                            <input type="checkbox" id="VectTauri_conditions_enabled" ${data.conditions?.enabled ? 'checked' : ''}>
                            <span>Enable conditional activation</span>
                        </label>
                        <div class="vecttauri-conditions-logic">
                            <button class="vecttauri-logic-btn ${data.conditions?.logic === 'AND' ? 'active' : ''}" data-logic="AND">AND</button>
                            <button class="vecttauri-logic-btn ${data.conditions?.logic === 'OR' ? 'active' : ''}" data-logic="OR">OR</button>
                        </div>
                    </div>
                    <div class="vecttauri-conditions-list" id="VectTauri_conditions_list">
                        ${(data.conditions?.rules || []).map((rule, i) => `
                            <div class="vecttauri-condition-item" data-index="${i}">
                                <span class="vecttauri-condition-item-num">${i + 1}.</span>
                                <span class="vecttauri-condition-item-text">${StringUtils.escapeHtml(formatConditionRule(rule))}</span>
                                <i class="fa-solid fa-xmark vecttauri-condition-item-remove"></i>
                            </div>
                        `).join('')}
                    </div>
                    <button class="vecttauri-add-condition-btn" id="VectTauri_add_condition">+ Add Condition Rule</button>
                </div>
            </div>
            ` : ''}

            <!-- Chunk Links Section -->
            ${showChunkLinks ? `
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-title">
                    <i class="fa-solid fa-link"></i> Chunk Links
                    <span class="vecttauri-section-hint">(pull related chunks into results)</span>
                </div>
                <div class="vecttauri-detail-links">
                    <div class="vecttauri-links-list" id="VectTauri_links_list">
                        ${(data.chunkLinks || []).map((link, i) => `
                            <div class="vecttauri-link-item ${link.mode}" data-index="${i}">
                                <span class="vecttauri-link-mode-badge ${link.mode}">${link.mode === 'force' ? '🔗 Force' : '〰️ Soft'}</span>
                                <span class="vecttauri-link-target" title="Target hash: ${link.targetHash}">${link.targetHash.toString().substring(0, 12)}...</span>
                                <i class="fa-solid fa-xmark vecttauri-link-item-remove"></i>
                            </div>
                        `).join('')}
                    </div>
                    <div class="vecttauri-links-help">
                        <span class="vecttauri-help-badge force">Force</span> = Target chunk MUST appear if this chunk appears<br>
                        <span class="vecttauri-help-badge soft">Soft</span> = Target chunk gets score boost if this chunk appears
                    </div>
                    <button class="vecttauri-add-link-btn" id="VectTauri_add_link">+ Add Link</button>
                </div>
            </div>
            ` : ''}

            <!-- Summaries Section -->
            <div class="vecttauri-detail-section">
                <div class="vecttauri-detail-section-title">Dual-Vector Summaries</div>
                <div class="vecttauri-detail-summaries">
                    <div class="vecttauri-summaries-header">
                        <span>Alternative search vectors for this chunk</span>
                    </div>
                    <div class="vecttauri-summaries-list" id="VectTauri_summaries_list">
                        ${(data.summaries || []).map((summary, i) => {
                            const summaryHash = getStringHash(summary);
                            return `
                            <div class="vecttauri-summary-item" data-index="${i}">
                                <div class="vecttauri-summary-item-content">
                                    <span class="vecttauri-summary-item-text">${StringUtils.escapeHtml(summary)}</span>
                                    <span class="vecttauri-summary-item-hash" title="Summary vector hash">#${summaryHash}</span>
                                </div>
                                <i class="fa-solid fa-xmark vecttauri-summary-item-remove"></i>
                            </div>
                        `}).join('')}
                    </div>
                    <button class="vecttauri-add-summary-btn" id="VectTauri_add_summary">+ Add Summary</button>
                </div>
            </div>
        </div>
    `);

    bindDetailEvents();
}

function formatConditionRule(rule) {
    if (!rule || !rule.type) return 'Unknown condition';

    const negation = rule.negated ? 'NOT ' : '';
    const value = rule.settings?.value || rule.value || '';  // Support both formats

    switch (rule.type) {
        case 'pattern':
            return `${negation}Pattern: "${value}"`;
        case 'speaker':
            return `${negation}Speaker: ${value || 'undefined'}`;
        case 'messageCount':
            // Extract operator and number if value is like ">=100" or just "100"
            const match = value.match(/^([><=!]+)?(\d+)$/);
            if (match) {
                const operator = match[1] || '>=';
                const count = match[2];
                return `${negation}Message Count ${operator} ${count}`;
            }
            return `${negation}Message Count: ${value}`;
        case 'isGroupChat':
            return `${negation}Is Group Chat`;
        case 'timeOfDay':
            // Handle different time formats
            if (!value) return `${negation}Time of Day: (no time set)`;
            return `${negation}Time of Day: ${value}`;
        case 'randomChance':
            // Value should be a percentage
            const percent = value || rule.settings?.percent || '50';
            return `${negation}Random Chance: ${percent}%`;
        default:
            return `${negation}${rule.type}: ${value || '(empty)'}`;
    }
}

// ============================================================================
// EVENT BINDING
// ============================================================================

function bindEvents() {
    // Save
    $('#VectTauri_visualizer_save').on('click', saveAllChanges);

    // Close
    $('#VectTauri_visualizer_close').on('click', closeVisualizer);
    // Stop mousedown propagation (ST closes drawers on mousedown/touchstart)
    $('#VectTauri_visualizer_modal').on('mousedown touchstart', function(e) {
        e.stopPropagation();
    });
    // Close on background click
    $('#VectTauri_visualizer_modal').on('click', function(e) {
        if (e.target === this) closeVisualizer();
    });

    // Search
    $('#VectTauri_chunk_search').on('input', debounce(function() {
        searchQuery = $(this).val();
        applyFilters();
        renderChunkList();
    }, 200));

    // Sort
    $('#VectTauri_chunk_sort').on('change', function() {
        sortBy = $(this).val();
        applyFilters();
        renderChunkList();
    });

    // Filter
    $('#VectTauri_chunk_filter').on('change', function() {
        filterBy = $(this).val();
        applyFilters();
        renderChunkList();
    });

    // Fetch limit (0 = no limit)
    $('#VectTauri_fetch_limit').on('change', function() {
        const val = parseInt($(this).val());
        chunkFetchLimit = isNaN(val) || val < 0 ? 0 : val;
        $(this).val(chunkFetchLimit);
    });

    // Reload button
    $('#VectTauri_reload_chunks').off('click').on('click', function() {
        if (onReloadCallback) onReloadCallback(chunkFetchLimit);
    });

    // Chunk selection - bind to container, not document (because modal stops propagation)
    $('#VectTauri_visualizer_modal').on('click', '.vecttauri-chunk-item', function(e) {
        // Let the checkbox handle its own click/change — e.preventDefault() below would cancel the toggle
        if ($(e.target).hasClass('vecttauri-bulk-checkbox')) return;
        e.preventDefault();
        e.stopPropagation();
        const uid = $(this).attr('data-uid');
        if (currentSettings?.eventbase_debug_logging) console.log('VectTauri: Clicked chunk with uniqueId:', uid);
        if (!uid) {
            console.error('VectTauri: No uniqueId found on clicked element');
            return;
        }
        // Warn if switching chunks with unsaved changes
        if (hasUnsavedChanges && uid !== selectedChunkId) {
            if (!confirm('You have unsaved text changes. Switch chunks anyway?')) {
                return;
            }
            hasUnsavedChanges = false;
        }
        selectedChunkId = uid;
        renderChunkList();
        renderDetailPanel();
    });

    // Load more
    $('#VectTauri_visualizer_modal').on('click', '#VectTauri_load_more', function() {
        displayLimit += 50;
        renderChunkList();
    });

    // Bulk mode
    $('#VectTauri_bulk_mode').on('change', function() {
        bulkSelectMode = $(this).is(':checked');
        if (!bulkSelectMode) {
            selectedChunksSet.clear();
            $('#VectTauri_bulk_delete').text('Delete Selected');
        }
        $('#VectTauri_bulk_buttons').toggle(bulkSelectMode);
        $('#VectTauri_delete_chunk').prop('disabled', bulkSelectMode).toggleClass('vecttauri-btn-dimmed', bulkSelectMode);
        renderChunkList();
    });

    // Per-chunk bulk checkboxes (delegated — list is re-rendered frequently)
    $('#VectTauri_chunk_list').on('change', '.vecttauri-bulk-checkbox', function(e) {
        e.stopPropagation();
        const uid = $(this).data('uid');
        if ($(this).is(':checked')) {
            selectedChunksSet.add(uid);
        } else {
            selectedChunksSet.delete(uid);
        }
        // Update the row highlight without a full re-render
        $(this).closest('.vecttauri-chunk-item').toggleClass('bulk-checked', $(this).is(':checked'));
        // Update button labels to show selection count
        const count = selectedChunksSet.size;
        const label = count > 0 ? ` (${count})` : '';
        $('#VectTauri_bulk_enable').text(`Enable All${label}`);
        $('#VectTauri_bulk_disable').text(`Disable All${label}`);
        $('#VectTauri_bulk_delete').text(count > 0 ? `Delete Selected (${count})` : 'Delete Selected');
    });

    $('#VectTauri_bulk_enable').on('click', () => bulkSetEnabled(true));
    $('#VectTauri_bulk_disable').on('click', () => bulkSetEnabled(false));
    $('#VectTauri_bulk_delete').on('click', () => bulkDelete());
}

function bindDetailEvents() {
    // PERF: Use Map for O(1) lookup instead of O(n) find()
    const chunk = allChunksMap.get(selectedChunkId);
    if (!chunk) return;

    const originalText = chunk.data.text;

    // Chunk name input
    $('#VectTauri_chunk_name').on('input', debounce(function() {
        const name = $(this).val().trim();
        chunk.data.name = name || null;
        updateChunkData(chunk.hash, { name: chunk.data.name });
        renderChunkList();
    }, 300));

    // Inline text editing - track changes
    $('#VectTauri_chunk_text').on('input', function() {
        const newText = $(this).text().trim();
        if (newText !== originalText) {
            hasUnsavedChanges = true;
            $('#VectTauri_save_text').removeClass('vecttauri-hidden');
        } else {
            hasUnsavedChanges = false;
            $('#VectTauri_save_text').addClass('vecttauri-hidden');
        }
    });

    // Save text changes
    $('#VectTauri_save_text').on('click', async function() {
        const newText = $('#VectTauri_chunk_text').text().trim();
        if (!newText) return;

        $(this).prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Saving...');

        try {
            // Delete old
            await deleteVectorItems(currentCollectionId, [chunk.hash], currentSettings);

            // Insert new with new hash (keep as number for Qdrant compatibility)
            const newHash = getStringHash(newText);
            // Carry existing metadata onto the NEW backend point. Re-embedding creates a
            // fresh point with a new hash; the backend is the source of truth, so the
            // payload must be carried over — merge the backend payload over any legacy
            // ext_settings entry. Without this, text-editing wipes name/context/keywords
            // etc. See plans/chunk-metadata-read-source-fix.md (R8).
            const oldStored = getChunkMetadata(String(chunk.hash)) || {};
            const carriedMeta = { ...oldStored, ...(chunk.metadata || {}) };
            delete carriedMeta.hash;
            delete carriedMeta.text;
            await insertVectorItems(currentCollectionId, [{
                hash: newHash,
                text: newText,
                index: chunk.index,
                metadata: carriedMeta,
            }], currentSettings);

            // Backend fields were carried onto the new point above (Phase B: backend is the
            // source of truth). In ext_settings, only migrate client-only state (summaries)
            // to the new hash and drop the old entry.
            deleteChunkMetadata(String(chunk.hash));
            const carriedClientOnly = {};
            for (const k of CLIENT_ONLY_CHUNK_FIELDS) {
                if (k in oldStored) carriedClientOnly[k] = oldStored[k];
            }
            if (Object.keys(carriedClientOnly).length > 0) {
                saveChunkMetadata(String(newHash), carriedClientOnly);
            }

            // Update local state
            chunk.hash = newHash;
            chunk.text = newText;
            chunk.data.text = newText;
            hasUnsavedChanges = false;

            renderChunkList();
            renderDetailPanel();
            toastr.success('Chunk updated successfully', 'VectTauri');
        } catch (error) {
            console.error('Failed to update chunk:', error);
            toastr.error('Failed to update chunk', 'VectTauri');
            $(this).prop('disabled', false).html('<i class="fa-solid fa-save"></i> Save & Re-embed');
        }
    });

    // Enabled toggle
    $('#VectTauri_detail_enabled').on('change', function() {
        const enabled = $(this).is(':checked');
        updateChunkData(chunk.hash, { enabled });
        chunk.data.enabled = enabled;
        renderChunkList();
    });

    // Prompt context input
    $('#VectTauri_chunk_context').on('input', debounce(function() {
        const context = $(this).val();
        chunk.data.context = context || '';
        updateChunkData(chunk.hash, { context: chunk.data.context });
    }, 300));

    // XML tag input (sanitize to alphanumeric + underscore/hyphen)
    $('#VectTauri_chunk_xmltag').on('input', debounce(function() {
        const sanitized = $(this).val().replace(/[^a-zA-Z0-9_-]/g, '');
        $(this).val(sanitized);
        chunk.data.xmlTag = sanitized || '';
        updateChunkData(chunk.hash, { xmlTag: chunk.data.xmlTag });
    }, 300));

    // Injection position select
    $('#VectTauri_chunk_position').on('change', function() {
        const val = $(this).val();
        const position = val === '' ? null : parseInt(val);
        chunk.data.position = position;
        updateChunkData(chunk.hash, { position: chunk.data.position });
        // Show/hide depth row
        $('#VectTauri_chunk_depth_row').toggle(position === 1);
    });

    // Injection depth slider
    $('#VectTauri_chunk_depth').on('input', function() {
        const depth = parseInt($(this).val()) || 2;
        $('#VectTauri_chunk_depth_value').text(depth);
        chunk.data.depth = depth;
        updateChunkData(chunk.hash, { depth: chunk.data.depth });
    });

    // Delete chunk
    $('#VectTauri_delete_chunk').on('click', () => deleteChunk(chunk));

    // Keyword mode toggle (plaintext vs badge)
    $('#VectTauri_keyword_mode').on('click', function() {
        // If in plaintext mode, parse and save before switching
        if (plaintextKeywordMode) {
            const plaintext = $('#VectTauri_keywords_plaintext').val();
            chunk.data.keywords = parsePlaintextKeywords(plaintext);
            updateChunkData(chunk.hash, { keywords: chunk.data.keywords });
        }
        plaintextKeywordMode = !plaintextKeywordMode;
        renderDetailPanel();
    });

    // Plaintext keywords - save on blur
    $('#VectTauri_keywords_plaintext').on('blur', function() {
        const plaintext = $(this).val();
        chunk.data.keywords = parsePlaintextKeywords(plaintext);
        updateChunkData(chunk.hash, { keywords: chunk.data.keywords });
    });

    // Keywords - add new
    $('#VectTauri_add_keyword').on('click', function() {
        $(this).replaceWith('<input type="text" class="vecttauri-keyword-input" id="VectTauri_keyword_input" placeholder="Enter keyword...">');
        $('#VectTauri_keyword_input').focus().on('keydown', function(e) {
            if (e.key === 'Enter') {
                const keyword = $(this).val().trim();
                if (keyword && !chunk.data.keywords.some(k => k.text === keyword)) {
                    chunk.data.keywords.push({ text: keyword, weight: 1.5 }); // Default 1.5x boost
                    updateChunkData(chunk.hash, { keywords: chunk.data.keywords });
                }
                renderDetailPanel();
            } else if (e.key === 'Escape') {
                renderDetailPanel();
            }
        }).on('blur', function() {
            renderDetailPanel();
        });
    });

    // Keyword remove button
    $('.vecttauri-keyword-remove').on('click', function() {
        const index = $(this).data('index');
        chunk.data.keywords.splice(index, 1);
        updateChunkData(chunk.hash, { keywords: chunk.data.keywords });
        renderDetailPanel();
    });

    // Conditions
    $('#VectTauri_conditions_enabled').on('change', function() {
        chunk.data.conditions.enabled = $(this).is(':checked');
        updateChunkData(chunk.hash, { conditions: chunk.data.conditions });
    });

    $('.vecttauri-logic-btn').on('click', function() {
        const logic = $(this).data('logic');
        chunk.data.conditions.logic = logic;
        updateChunkData(chunk.hash, { conditions: chunk.data.conditions });
        $('.vecttauri-logic-btn').removeClass('active');
        $(this).addClass('active');
    });

    $('.vecttauri-condition-item-remove').on('click', function() {
        const index = $(this).closest('.vecttauri-condition-item').data('index');
        chunk.data.conditions.rules.splice(index, 1);
        updateChunkData(chunk.hash, { conditions: chunk.data.conditions });
        renderDetailPanel();
        renderChunkList();
    });

    // Add condition rule
    $('#VectTauri_add_condition').on('click', function() {
        openConditionEditor(chunk);
    });

    // Chunk links
    $('#VectTauri_add_link').on('click', function() {
        openLinkEditor(chunk);
    });

    $('.vecttauri-link-item-remove').on('click', function() {
        const index = $(this).closest('.vecttauri-link-item').data('index');
        chunk.data.chunkLinks.splice(index, 1);
        updateChunkData(chunk.hash, { chunkLinks: chunk.data.chunkLinks });
        renderDetailPanel();
    });

    // Summaries
    $('.vecttauri-summary-item-remove').on('click', function() {
        const index = $(this).closest('.vecttauri-summary-item').data('index');
        const summaryText = chunk.data.summaries[index];

        // Track for deletion on save
        if (!chunk.data._deletedSummaries) chunk.data._deletedSummaries = [];
        chunk.data._deletedSummaries.push(summaryText);

        // Remove from local data
        chunk.data.summaries.splice(index, 1);
        updateChunkData(chunk.hash, { summaries: chunk.data.summaries, _deletedSummaries: chunk.data._deletedSummaries });
        renderDetailPanel();
    });

    $('#VectTauri_add_summary').on('click', function() {
        const summary = prompt('Enter summary text:');
        if (summary && summary.trim()) {
            const summaryText = summary.trim();

            // Track for vectorization on save
            if (!chunk.data._newSummaries) chunk.data._newSummaries = [];
            chunk.data._newSummaries.push(summaryText);

            // Add to local data
            chunk.data.summaries.push(summaryText);
            updateChunkData(chunk.hash, { summaries: chunk.data.summaries, _newSummaries: chunk.data._newSummaries });
            renderDetailPanel();
        }
    });
}

/**
 * Parse plaintext keywords format: "keyword:2x, another:1.5x, plain"
 */
function parsePlaintextKeywords(text) {
    if (!text || !text.trim()) return [];

    return text.split(',').map(item => {
        const trimmed = item.trim();
        if (!trimmed) return null;

        // Check for weight suffix like :2x or :1.5x
        const match = trimmed.match(/^(.+?):(\d+\.?\d*)x?$/i);
        if (match) {
            return { text: match[1].trim(), weight: parseFloat(match[2]) };
        }
        // No weight specified, default to 1.5x
        return { text: trimmed, weight: 1.5 };
    }).filter(Boolean);
}

// ============================================================================
// TEXT EDITOR
// ============================================================================

function openTextEditor(chunk) {
    const overlay = $(`
        <div class="vecttauri-text-editor-overlay" id="VectTauri_text_editor_overlay">
            <div class="vecttauri-text-editor-modal">
                <div class="vecttauri-text-editor-header">
                    <h4>Edit Chunk Text</h4>
                </div>
                <div class="vecttauri-text-editor-body">
                    <textarea class="vecttauri-text-editor-textarea" id="VectTauri_text_editor_textarea">${StringUtils.escapeHtml(chunk.data.text)}</textarea>
                </div>
                <div class="vecttauri-text-editor-footer">
                    <button class="vecttauri-text-editor-btn vecttauri-text-editor-cancel" id="VectTauri_text_cancel">Cancel</button>
                    <button class="vecttauri-text-editor-btn vecttauri-text-editor-save" id="VectTauri_text_save">Save & Re-embed</button>
                </div>
            </div>
        </div>
    `);

    $('.vecttauri-visualizer-container').append(overlay);

    $('#VectTauri_text_cancel').on('click', () => overlay.remove());
    overlay.on('click', function(e) {
        if (e.target === this) overlay.remove();
    });

    $('#VectTauri_text_save').on('click', async function() {
        const newText = $('#VectTauri_text_editor_textarea').val().trim();
        if (!newText) return;

        $(this).prop('disabled', true).text('Saving...');

        try {
            // Delete old
            await deleteVectorItems(currentCollectionId, [chunk.hash], currentSettings);

            // Insert new with new hash (keep as number for Qdrant compatibility)
            const newHash = getStringHash(newText);
            // Carry existing metadata onto the NEW backend point. Re-embedding creates a
            // fresh point with a new hash; the backend is the source of truth, so the
            // payload must be carried over — merge the backend payload over any legacy
            // ext_settings entry. Without this, text-editing wipes name/context/keywords
            // etc. See plans/chunk-metadata-read-source-fix.md (R8).
            const oldStored = getChunkMetadata(String(chunk.hash)) || {};
            const carriedMeta = { ...oldStored, ...(chunk.metadata || {}) };
            delete carriedMeta.hash;
            delete carriedMeta.text;
            await insertVectorItems(currentCollectionId, [{
                hash: newHash,
                text: newText,
                index: chunk.index,
                metadata: carriedMeta,
            }], currentSettings);

            // Backend fields were carried onto the new point above (Phase B: backend is the
            // source of truth). In ext_settings, only migrate client-only state (summaries)
            // to the new hash and drop the old entry.
            deleteChunkMetadata(String(chunk.hash));
            const carriedClientOnly = {};
            for (const k of CLIENT_ONLY_CHUNK_FIELDS) {
                if (k in oldStored) carriedClientOnly[k] = oldStored[k];
            }
            if (Object.keys(carriedClientOnly).length > 0) {
                saveChunkMetadata(String(newHash), carriedClientOnly);
            }

            // Update local state - update hash but keep same uniqueId for selection
            chunk.hash = newHash;
            chunk.text = newText;
            chunk.data.text = newText;
            // selectedChunkId stays the same since uniqueId doesn't change

            overlay.remove();
            renderChunkList();
            renderDetailPanel();
            toastr.success('Chunk updated successfully', 'VectTauri');
        } catch (error) {
            console.error('Failed to update chunk:', error);
            toastr.error('Failed to update chunk', 'VectTauri');
            $(this).prop('disabled', false).text('Save & Re-embed');
        }
    });
}

// ============================================================================
// CONDITION EDITOR
// ============================================================================

const CONDITION_TYPES = [
    { value: 'pattern', label: 'Pattern Match', icon: '🔍' },
    { value: 'speaker', label: 'Speaker', icon: '💬' },
    { value: 'messageCount', label: 'Message Count', icon: '📊' },
    { value: 'isGroupChat', label: 'Group Chat', icon: '👥' },
    { value: 'timeOfDay', label: 'Time of Day', icon: '🕐' },
    { value: 'randomChance', label: 'Random Chance', icon: '🎲' },
];

function openConditionEditor(chunk) {
    const overlay = $(`
        <div class="vecttauri-editor-overlay" id="VectTauri_condition_editor">
            <div class="vecttauri-editor-modal">
                <div class="vecttauri-editor-header">
                    <h4><i class="fa-solid fa-bolt"></i> Add Condition Rule</h4>
                    <button class="vecttauri-editor-close" id="VectTauri_condition_close">×</button>
                </div>
                <div class="vecttauri-editor-body">
                    <div class="vecttauri-editor-field">
                        <label>Condition Type</label>
                        <select id="VectTauri_condition_type" class="vecttauri-editor-select">
                            ${CONDITION_TYPES.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="vecttauri-editor-field" id="VectTauri_condition_settings">
                        <label>Pattern</label>
                        <input type="text" id="VectTauri_condition_value" class="vecttauri-editor-input" placeholder="Enter pattern or value...">
                    </div>
                    <div class="vecttauri-editor-field">
                        <label class="vecttauri-editor-checkbox">
                            <input type="checkbox" id="VectTauri_condition_negate">
                            <span>Negate (NOT)</span>
                        </label>
                    </div>
                </div>
                <div class="vecttauri-editor-footer">
                    <button class="vecttauri-editor-btn cancel" id="VectTauri_condition_cancel">Cancel</button>
                    <button class="vecttauri-editor-btn primary" id="VectTauri_condition_add">Add Condition</button>
                </div>
            </div>
        </div>
    `);

    $('.vecttauri-visualizer-container').append(overlay);

    $('#VectTauri_condition_close, #VectTauri_condition_cancel').on('click', () => overlay.remove());
    overlay.on('click', function(e) {
        if (e.target === this) overlay.remove();
    });

    $('#VectTauri_condition_add').on('click', function() {
        const type = $('#VectTauri_condition_type').val();
        const value = $('#VectTauri_condition_value').val().trim();
        const negated = $('#VectTauri_condition_negate').is(':checked');

        if (!value && type !== 'isGroupChat' && type !== 'randomChance') {
            toastr.warning('Please enter a value', 'VectTauri');
            return;
        }

        const rule = {
            type,
            negated,
            settings: { value }
        };

        if (!chunk.data.conditions.rules) {
            chunk.data.conditions.rules = [];
        }
        chunk.data.conditions.rules.push(rule);
        updateChunkData(chunk.hash, { conditions: chunk.data.conditions });

        overlay.remove();
        renderDetailPanel();
        renderChunkList();
        toastr.success('Condition added', 'VectTauri');
    });
}

// ============================================================================
// LINK EDITOR
// ============================================================================

function openLinkEditor(chunk) {
    // Get available chunks to link to (excluding self)
    const availableChunks = allChunks.filter(c => c.hash !== chunk.hash);

    const overlay = $(`
        <div class="vecttauri-editor-overlay" id="VectTauri_link_editor">
            <div class="vecttauri-editor-modal">
                <div class="vecttauri-editor-header">
                    <h4><i class="fa-solid fa-link"></i> Add Chunk Link</h4>
                    <button class="vecttauri-editor-close" id="VectTauri_link_close">×</button>
                </div>
                <div class="vecttauri-editor-body">
                    <div class="vecttauri-editor-field">
                        <label>Link Mode</label>
                        <div class="vecttauri-link-mode-selector">
                            <label class="vecttauri-link-mode-option">
                                <input type="radio" name="link_mode" value="force" checked>
                                <span class="vecttauri-link-mode-card force">
                                    <span class="icon">🔗</span>
                                    <span class="title">Force Link</span>
                                    <span class="desc">Target MUST appear when this chunk appears</span>
                                </span>
                            </label>
                            <label class="vecttauri-link-mode-option">
                                <input type="radio" name="link_mode" value="soft">
                                <span class="vecttauri-link-mode-card soft">
                                    <span class="icon">〰️</span>
                                    <span class="title">Soft Link</span>
                                    <span class="desc">Target gets score boost when this chunk appears</span>
                                </span>
                            </label>
                        </div>
                    </div>
                    <div class="vecttauri-editor-field">
                        <label>Target Chunk</label>
                        <select id="VectTauri_link_target" class="vecttauri-editor-select">
                            ${availableChunks.map(c => {
                                const preview = c.data.text.substring(0, 40).replace(/\s+/g, ' ') + '...';
                                const name = c.data.name || preview;
                                return `<option value="${c.hash}">[Msg #${c.index}] ${StringUtils.escapeHtml(name)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                </div>
                <div class="vecttauri-editor-footer">
                    <button class="vecttauri-editor-btn cancel" id="VectTauri_link_cancel">Cancel</button>
                    <button class="vecttauri-editor-btn primary" id="VectTauri_link_add">Add Link</button>
                </div>
            </div>
        </div>
    `);

    $('.vecttauri-visualizer-container').append(overlay);

    $('#VectTauri_link_close, #VectTauri_link_cancel').on('click', () => overlay.remove());
    overlay.on('click', function(e) {
        if (e.target === this) overlay.remove();
    });

    $('#VectTauri_link_add').on('click', function() {
        const mode = $('input[name="link_mode"]:checked').val();
        const targetHash = $('#VectTauri_link_target').val();

        if (!targetHash) {
            toastr.warning('Please select a target chunk', 'VectTauri');
            return;
        }

        // Check for duplicate
        if (chunk.data.chunkLinks.some(l => l.targetHash === targetHash)) {
            toastr.warning('Link to this chunk already exists', 'VectTauri');
            return;
        }

        chunk.data.chunkLinks.push({ targetHash, mode });
        updateChunkData(chunk.hash, { chunkLinks: chunk.data.chunkLinks });

        overlay.remove();
        renderDetailPanel();
        toastr.success('Link added', 'VectTauri');
    });
}

// ============================================================================
// DELETE CHUNK
// ============================================================================

async function deleteChunk(chunk) {
    if (!confirm(`Delete chunk #${chunk.index}?`)) return;

    try {
        await deleteVectorItems(currentCollectionId, [chunk.hash], currentSettings);
        deleteChunkMetadata(chunk.hash);

        // Remove from local state by uniqueId
        const idx = allChunks.findIndex(c => c.uniqueId === chunk.uniqueId);
        if (idx !== -1) allChunks.splice(idx, 1);

        selectedChunkId = null;
        applyFilters();
        renderChunkList();
        renderDetailPanel();
        toastr.success('Chunk deleted', 'VectTauri');
    } catch (error) {
        console.error('Failed to delete chunk:', error);
        toastr.error('Failed to delete chunk', 'VectTauri');
    }
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

async function bulkDelete() {
    const targets = selectedChunksSet.size > 0
        ? filteredChunks.filter(c => selectedChunksSet.has(c.uniqueId))
        : [];
    if (targets.length === 0) {
        toastr.warning('No chunks selected', 'VectTauri');
        return;
    }
    if (!confirm(`Delete ${targets.length} selected chunk${targets.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;

    try {
        const hashes = targets.map(c => c.hash);
        await deleteVectorItems(currentCollectionId, hashes, currentSettings);
        for (const chunk of targets) {
            deleteChunkMetadata(chunk.hash);
            const idx = allChunks.findIndex(c => c.uniqueId === chunk.uniqueId);
            if (idx !== -1) allChunks.splice(idx, 1);
        }
        selectedChunksSet.clear();
        if (targets.some(c => c.uniqueId === selectedChunkId)) selectedChunkId = null;
        $('#VectTauri_bulk_delete').text('Delete Selected');
        applyFilters();
        renderChunkList();
        renderDetailPanel();
        toastr.success(`Deleted ${targets.length} chunk${targets.length !== 1 ? 's' : ''}`, 'VectTauri');
    } catch (error) {
        console.error('Failed to bulk delete chunks:', error);
        toastr.error('Failed to delete chunks', 'VectTauri');
    }
}

function bulkSetEnabled(enabled) {
    // Operate on checked items when any are selected; otherwise on all filtered chunks.
    const targets = selectedChunksSet.size > 0
        ? filteredChunks.filter(c => selectedChunksSet.has(c.uniqueId))
        : filteredChunks;
    for (const chunk of targets) {
        chunk.data.enabled = enabled;
        updateChunkData(chunk.hash, { enabled });
    }
    renderChunkList();
    if (selectedChunkId) renderDetailPanel();
    // Reset button labels after action
    $('#VectTauri_bulk_enable').text('Enable All');
    $('#VectTauri_bulk_disable').text('Disable All');
    $('#VectTauri_bulk_delete').text('Delete Selected');
    selectedChunksSet.clear();
    toastr.success(`${enabled ? 'Enabled' : 'Disabled'} ${targets.length} chunk${targets.length !== 1 ? 's' : ''}`, 'VectTauri');
}


function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the chunk visualizer module
 * Called from index.js on extension load
 */
export function initializeVisualizer() {
    log.lifecycle('VectTauri: Chunk visualizer initialized');
    // No DOM setup needed - modal is created dynamically when opened
}

// ============================================================================
// EXPORTS
// ============================================================================

export { openVisualizer as default };
