/**
 * ============================================================================
 * VectTauri SEARCH DEBUG MODAL
 * ============================================================================
 * Shows detailed breakdown of the last RAG query pipeline:
 * - Query text used
 * - Initial vector search results
 * - Temporal decay effects
 * - Condition filtering
 * - Final injection results
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import StringUtils from '../utils/string-utils.js';

// ============================================================================
// STATE
// ============================================================================

let lastDebugData = null;
const queryHistory = []; // Store last N queries
const MAX_QUERY_HISTORY = 13;

// ============================================================================
// DATA STRUCTURE
// ============================================================================

/**
 * Structure for debug data - populated during RAG pipeline
 * @typedef {Object} SearchDebugData
 * @property {string} query - The query text used
 * @property {number} timestamp - When the search was performed
 * @property {string} collectionId - Collection that was searched
 * @property {Object} settings - Settings used for the search
 * @property {Object} stages - Data from each pipeline stage
 * @property {Array} stages.initial - Chunks from initial vector query
 * @property {Array} stages.afterConditions - Chunks after condition filtering
 * @property {Array} stages.injected - Chunks that were actually injected
 * @property {Object} stats - Summary statistics
 */

/**
 * Creates empty debug data structure with full tracing support
 * @returns {SearchDebugData}
 */
export function createDebugData() {
    return {
        query: '',
        timestamp: Date.now(),
        collectionId: null,
        settings: {},
        stages: {
            initial: [],
            afterThreshold: [],
            afterConditions: [],
            injected: []
        },
        // Detailed trace log - every operation recorded
        trace: [],
        // Per-chunk tracking - what happened to each chunk
        chunkFates: {},
        stats: {
            totalInCollection: 0,
            retrievedFromVector: 0,
            passedThreshold: 0,
            afterConditions: 0,
            actuallyInjected: 0,
            skippedDuplicates: 0,
            tokensBudget: 0,
            tokensUsed: 0
        }
    };
}

/**
 * Adds a trace entry to debug data
 * @param {SearchDebugData} debugData
 * @param {string} stage - Pipeline stage name
 * @param {string} action - What happened
 * @param {Object} details - Additional details
 */
export function addTrace(debugData, stage, action, details = {}) {
    if (!debugData.trace) debugData.trace = [];
    debugData.trace.push({
        time: Date.now(),
        stage,
        action,
        ...details
    });
}

/**
 * Records the fate of a specific chunk
 * @param {SearchDebugData} debugData
 * @param {string} hash - Chunk hash
 * @param {string} stage - Where it was dropped/passed
 * @param {string} fate - 'passed' | 'dropped'
 * @param {string} reason - Why it was dropped (if dropped)
 * @param {Object} data - Additional data (scores, etc)
 */
export function recordChunkFate(debugData, hash, stage, fate, reason = null, data = {}) {
    if (!debugData.chunkFates) debugData.chunkFates = {};
    if (!debugData.chunkFates[hash]) {
        debugData.chunkFates[hash] = {
            hash,
            stages: [],
            finalFate: null,
            finalReason: null
        };
    }

    debugData.chunkFates[hash].stages.push({
        stage,
        fate,
        reason,
        ...data
    });

    // Update final fate if dropped
    if (fate === 'dropped') {
        debugData.chunkFates[hash].finalFate = 'dropped';
        debugData.chunkFates[hash].finalReason = reason;
        debugData.chunkFates[hash].droppedAt = stage;
    } else if (fate === 'injected') {
        debugData.chunkFates[hash].finalFate = 'injected';
    }
}

/**
 * Stores debug data for the last search
 * @param {SearchDebugData} data
 */
export function setLastSearchDebug(data) {
    lastDebugData = data;

    // Add to history (most recent first)
    queryHistory.unshift(data);

    // Keep only last N queries
    if (queryHistory.length > MAX_QUERY_HISTORY) {
        queryHistory.pop();
    }

    console.log('VectTauri Debug: Stored search debug data', {
        query: data.query?.substring(0, 50) + '...',
        stages: {
            initial: data.stages.initial.length,
            afterConditions: data.stages.afterConditions.length,
            injected: data.stages.injected.length
        },
        historyCount: queryHistory.length
    });
}

/**
 * Gets the query history
 * @returns {Array<SearchDebugData>}
 */
export function getQueryHistory() {
    return queryHistory;
}

/**
 * Gets the last search debug data
 * @returns {SearchDebugData|null}
 */
export function getLastSearchDebug() {
    return lastDebugData;
}

// ============================================================================
// MODAL UI
// ============================================================================

/**
 * Opens the search debug modal
 */
export function openSearchDebugModal() {
    if (!lastDebugData) {
        toastr.info('No search has been performed yet. Send a message to trigger a RAG query.', 'VectTauri');
        return;
    }

    // Remove existing modal
    $('#VectTauri_search_debug_modal').remove();

    const html = createModalHtml(lastDebugData);
    $('body').append(html);

    bindEvents();
    $('#VectTauri_search_debug_modal').fadeIn(200);
}

/**
 * Closes the search debug modal
 */
export function closeSearchDebugModal() {
    $('#VectTauri_search_debug_modal').fadeOut(200, function() {
        $(this).remove();
    });
}

/**
 * Creates the modal HTML
 * @param {SearchDebugData} data
 * @param {number} historyIndex - Which history entry to show (0 = most recent)
 * @returns {string}
 */
function createModalHtml(data, historyIndex = 0) {
    const timeAgo = getTimeAgo(data.timestamp);
    const queryPreview = data.query.length > 100
        ? data.query.substring(0, 100) + '...'
        : data.query;

    // Build history tabs
    const historyTabs = queryHistory.length > 1 ? `
        <div class="vecttauri-debug-history-tabs">
            ${queryHistory.map((q, idx) => {
                const isActive = idx === historyIndex;
                const tabTime = getTimeAgo(q.timestamp);
                const tabQuery = q.query.substring(0, 20) + (q.query.length > 20 ? '...' : '');
                const injectedCount = q.stages.injected?.length || 0;
                const statusClass = injectedCount > 0 ? 'tab-success' : 'tab-empty';
                return `
                    <button class="vecttauri-debug-history-tab ${isActive ? 'active' : ''} ${statusClass}"
                            data-history-index="${idx}"
                            title="${StringUtils.escapeHtml(q.query.substring(0, 100))}">
                        <span class="tab-num">#${idx + 1}</span>
                        <span class="tab-injected">${injectedCount}</span>
                    </button>
                `;
            }).join('')}
        </div>
    ` : '';

    return `
        <div id="VectTauri_search_debug_modal" class="vecttauri-modal" style="display: none;">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content vecttauri-search-debug-content">
                <!-- Header -->
                <div class="vecttauri-modal-header">
                    <h3><i class="fa-solid fa-bug"></i> Search Debug</h3>
                    <button class="vecttauri-debug-copy-btn" id="VectTauri_copy_diagnostic" title="Copy diagnostic dump">
                        <i class="fa-solid fa-copy"></i> Copy Debug
                    </button>
                    <button class="vecttauri-modal-close" id="VectTauri_search_debug_close">✕</button>
                </div>

                <!-- History Tabs -->
                ${historyTabs}

                <!-- Body -->
                <div class="vecttauri-modal-body vecttauri-search-debug-body">

                    <!-- Query Info Card (Clickable to expand) -->
                    <div class="vecttauri-debug-card vecttauri-debug-query-card" id="VectTauri_query_card">
                        <div class="vecttauri-debug-card-header vecttauri-debug-clickable" id="VectTauri_query_header">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <span>Query</span>
                            <span class="vecttauri-debug-timestamp">${timeAgo}</span>
                            <i class="fa-solid fa-chevron-down vecttauri-debug-expand-icon"></i>
                        </div>
                        <div class="vecttauri-debug-card-body">
                            <div class="vecttauri-debug-query-preview">${StringUtils.escapeHtml(queryPreview)}</div>
                            <div class="vecttauri-debug-query-full" style="display: none;">
                                <pre>${StringUtils.escapeHtml(data.query)}</pre>
                            </div>
                        </div>
                    </div>

                    <!-- Pipeline Overview -->
                    <div class="vecttauri-debug-pipeline">
                        <div class="vecttauri-debug-pipeline-title">
                            <i class="fa-solid fa-diagram-project"></i>
                            RAG Pipeline
                        </div>
                        <div class="vecttauri-debug-pipeline-stages">
                            ${createPipelineStage('Vector Search', data.stages.initial.length, data.stages.initial.length, 'fa-database', 'primary', false)}
                            <div class="vecttauri-debug-pipeline-arrow">→</div>
                            ${createKeywordBoostStage(data)}
                            <div class="vecttauri-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Threshold', data.stages.afterThreshold?.length ?? data.stages.initial.filter(c => c.score >= (data.settings.threshold || 0)).length, data.stages.initial.length, 'fa-filter', 'info', false)}
                            <div class="vecttauri-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Conditions', data.stages.afterConditions.length, data.stages.afterThreshold?.length ?? 0, 'fa-code-branch', 'secondary', false)}
                            <div class="vecttauri-debug-pipeline-arrow">→</div>
                            ${createPipelineStage('Injected', data.stages.injected.length, data.stages.afterConditions.length, 'fa-syringe', 'success', false)}
                        </div>
                    </div>

                    <!-- Settings Used -->
                    <div class="vecttauri-debug-card vecttauri-debug-settings">
                        <div class="vecttauri-debug-card-header">
                            <i class="fa-solid fa-gear"></i>
                            <span>Settings Used</span>
                        </div>
                        <div class="vecttauri-debug-card-body">
                            <div class="vecttauri-debug-settings-grid">
                                <div class="vecttauri-debug-setting">
                                    <span class="vecttauri-debug-setting-label">Threshold</span>
                                    <span class="vecttauri-debug-setting-value">${data.settings.threshold || 'N/A'}</span>
                                </div>
                                <div class="vecttauri-debug-setting">
                                    <span class="vecttauri-debug-setting-label">Top K</span>
                                    <span class="vecttauri-debug-setting-value">${data.settings.topK || 'N/A'}</span>
                                </div>
                                <div class="vecttauri-debug-setting">
                                    <span class="vecttauri-debug-setting-label">Collection</span>
                                    <span class="vecttauri-debug-setting-value vecttauri-debug-setting-mono">${data.collectionId || 'Unknown'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Chunks by Stage -->
                    <div class="vecttauri-debug-card">
                        <div class="vecttauri-debug-card-header">
                            <i class="fa-solid fa-layer-group"></i>
                            <span>Chunks by Stage</span>
                        </div>
                        <div class="vecttauri-debug-card-body">
                            <!-- Stage Tabs -->
                            <div class="vecttauri-debug-stage-tabs">
                                <button class="vecttauri-debug-stage-tab active" data-stage="initial">
                                    Initial (${data.stages.initial.length})
                                </button>
                                <button class="vecttauri-debug-stage-tab" data-stage="afterConditions">
                                    After Conditions (${data.stages.afterConditions.length})
                                </button>
                                <button class="vecttauri-debug-stage-tab" data-stage="injected">
                                    Injected (${data.stages.injected.length})
                                </button>
                            </div>

                            <!-- Stage Content -->
                            <div class="vecttauri-debug-stage-content" id="VectTauri_debug_stage_content">
                                ${renderStageChunks(data.stages.initial, 'initial', data)}
                            </div>
                        </div>
                    </div>

                    <!-- Critical Failure Alert (0 injected) -->
                    ${renderCriticalFailure(data)}

                    <!-- Injection Verification (proof it actually happened) -->
                    ${renderInjectionVerification(data)}

                    <!-- Excluded Chunks Analysis -->
                    ${renderExcludedAnalysis(data)}

                    <!-- Developer Trace Log -->
                    ${renderTraceLog(data)}

                    <!-- Per-Chunk Fate Tracking -->
                    ${renderChunkFates(data)}

                </div>
            </div>
        </div>
    `;
}

/**
 * Creates a pipeline stage box
 * @param {string} label - Stage name
 * @param {number} count - Chunks remaining after this stage
 * @param {number} fromCount - Chunks that entered this stage
 * @param {string} icon - FontAwesome icon class
 * @param {string} colorClass - CSS color class
 * @param {boolean} disabled - Whether this stage is disabled/inactive
 */
function createPipelineStage(label, count, fromCount, icon, colorClass, disabled = false) {
    // Only show loss if this stage actually received chunks AND lost some
    const lost = (fromCount > 0 && count < fromCount) ? fromCount - count : 0;
    const disabledClass = disabled ? 'vecttauri-debug-stage-disabled' : '';

    return `
        <div class="vecttauri-debug-pipeline-stage vecttauri-debug-stage-${colorClass} ${disabledClass}">
            <div class="vecttauri-debug-stage-icon">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="vecttauri-debug-stage-count">${count}</div>
            <div class="vecttauri-debug-stage-label">${label}${disabled ? ' (off)' : ''}</div>
            ${lost > 0 ? `<div class="vecttauri-debug-stage-lost">-${lost}</div>` : ''}
        </div>
    `;
}

/**
 * Creates the keyword boost pipeline stage
 * Shows how many chunks had keywords matched
 */
function createKeywordBoostStage(data) {
    const chunks = data.stages.initial || [];
    const boostedCount = chunks.filter(c => c.keywordMatched || c.keywordBoosted || (c.keywordBoost && c.keywordBoost > 1)).length;

    // Count total matched query keywords across all chunks
    const totalMatchedQueryKeywords = chunks.reduce((sum, c) => {
        return sum + (c.matchedQueryKeywords?.length || 0);
    }, 0);

    // Show total matched keywords as the badge
    const badge = totalMatchedQueryKeywords > 0
        ? `<div class="vecttauri-debug-stage-boost">🔑${totalMatchedQueryKeywords}</div>`
        : '';

    return `
        <div class="vecttauri-debug-pipeline-stage vecttauri-debug-stage-keyword">
            <div class="vecttauri-debug-stage-icon">
                <i class="fa-solid fa-tags"></i>
            </div>
            <div class="vecttauri-debug-stage-count">${boostedCount}</div>
            <div class="vecttauri-debug-stage-label">Keywords</div>
            ${badge}
        </div>
    `;
}

/**
 * Renders chunks for a specific stage
 */
function renderStageChunks(chunks, stageName, data) {
    if (!chunks || chunks.length === 0) {
        return `
            <div class="vecttauri-debug-empty">
                <i class="fa-solid fa-inbox"></i>
                <p>No chunks at this stage</p>
            </div>
        `;
    }

    let html = '<div class="vecttauri-debug-chunks-list">';

    chunks.forEach((chunk, idx) => {
        const textPreview = chunk.text
            ? (chunk.text.length > 80 ? chunk.text.substring(0, 80) + '...' : chunk.text)
            : '(text not found)';

        const hasMoreText = chunk.text && chunk.text.length > 80;

        const scoreClass = getScoreClass(chunk.score);

        // Show matched query keywords badge
        const keywordMatchInfo = chunk.matchedQueryKeywords && chunk.matchedQueryKeywords.length > 0
            ? `<span class="vecttauri-debug-keyword-match-badge" title="Matched query keywords: ${chunk.matchedQueryKeywords.join(', ')}">
                   🔑 ${chunk.matchedQueryKeywords.length} keyword${chunk.matchedQueryKeywords.length > 1 ? 's' : ''}
               </span>`
            : '';

        // Build score breakdown showing the math
        const scoreBreakdown = buildScoreBreakdown(chunk);

        // Check if this chunk was excluded in later stages
        const wasExcluded = getExclusionStatus(chunk, stageName, data);

        // Build score display - hybrid vs standard
        const isHybrid = chunk.hybridSearch || (chunk.vectorScore !== undefined && chunk.textScore !== undefined);
        let scoreDisplay;
        if (isHybrid) {
            const isRRF = chunk.fusionMethod === 'rrf';

            // RRF scores are small (0.014), but original vector/text scores are still percentages
            if (isRRF) {
                // Final RRF score is raw decimal, but vector/text are still percentages
                const finalScore = (chunk.score || 0).toFixed(4);
                const vectorPct = ((chunk.vectorScore || 0) * 100).toFixed(0);
                const textPct = ((chunk.textScore || 0) * 100).toFixed(0);
                scoreDisplay = `
                    <span class="vecttauri-debug-chunk-score-hybrid">
                        <span class="vecttauri-score-main ${scoreClass}">${finalScore}</span>
                        <span class="vecttauri-score-mini">
                            <span class="vecttauri-mini-vector" title="Semantic similarity (Qdrant cosine)">🔷${vectorPct}%</span>
                            <span class="vecttauri-mini-text" title="Keyword match score">📝${textPct}%</span>
                        </span>
                    </span>`;
            } else {
                // Show as percentages for weighted fusion
                const finalPct = ((chunk.score || 0) * 100).toFixed(1);
                const vectorPct = ((chunk.vectorScore || 0) * 100).toFixed(0);
                const textPct = ((chunk.textScore || 0) * 100).toFixed(0);
                scoreDisplay = `
                    <span class="vecttauri-debug-chunk-score-hybrid">
                        <span class="vecttauri-score-main ${scoreClass}">${finalPct}%</span>
                        <span class="vecttauri-score-mini">
                            <span class="vecttauri-mini-vector" title="Semantic similarity">🔷${vectorPct}%</span>
                            <span class="vecttauri-mini-text" title="Keyword match">📝${textPct}%</span>
                        </span>
                    </span>`;
            }
        } else {
            scoreDisplay = `<span class="vecttauri-debug-chunk-score ${scoreClass}">${chunk.score?.toFixed(3) || 'N/A'}</span>`;
        }

        // Build full metadata for expanded view
        const fullMeta = {
            hash: chunk.hash,
            index: chunk.index,
            score: chunk.score,
            originalScore: chunk.originalScore,
            keywordBoost: chunk.keywordBoost,
            keywords: chunk.matchedKeywordsWithWeights || chunk.matchedKeywords || [],
            collection: chunk.collection || chunk.collectionId,
            metadata: chunk.metadata
        };

        html += `
            <div class="vecttauri-debug-chunk vecttauri-debug-chunk-expandable ${wasExcluded ? 'vecttauri-debug-chunk-excluded' : ''}" data-chunk-idx="${idx}">
                <div class="vecttauri-debug-chunk-header">
                    <span class="vecttauri-debug-chunk-rank">#${idx + 1}</span>
                    ${scoreDisplay}
                    ${keywordMatchInfo}
                    ${wasExcluded ? `<span class="vecttauri-debug-excluded-badge">${wasExcluded}</span>` : ''}
                    <i class="fa-solid fa-chevron-down vecttauri-debug-chunk-expand-icon"></i>
                </div>
                ${scoreBreakdown}
                <div class="vecttauri-debug-chunk-text-preview">${StringUtils.escapeHtml(textPreview)}</div>

                <!-- Expanded content (hidden by default) -->
                <div class="vecttauri-debug-chunk-expanded" style="display: none;">
                    <div class="vecttauri-debug-chunk-fulltext">
                        <div class="vecttauri-debug-chunk-fulltext-label">Full Text:</div>
                        <pre>${StringUtils.escapeHtml(chunk.text || '(no text)')}</pre>
                    </div>
                    <div class="vecttauri-debug-chunk-meta-full">
                        <div class="vecttauri-debug-meta-grid">
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Hash</span>
                                <span class="meta-value">${chunk.hash}</span>
                            </div>
                            ${chunk.index !== undefined ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Message #</span>
                                <span class="meta-value">${chunk.index}</span>
                            </div>` : ''}
                            ${chunk.collection || chunk.collectionId ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Collection</span>
                                <span class="meta-value">${chunk.collection || chunk.collectionId}</span>
                            </div>` : ''}
                            ${chunk.metadata?.keywords?.length ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Keywords</span>
                                <span class="meta-value">${chunk.metadata.keywords.map(k => typeof k === 'object' ? `${k.text}(${k.weight}x)` : k).join(', ')}</span>
                            </div>` : ''}
                            ${chunk.matchedQueryKeywords?.length ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Matched Query Keywords</span>
                                <span class="meta-value vecttauri-matched-keywords">${chunk.matchedQueryKeywords.join(', ')}</span>
                            </div>` : ''}
                            ${chunk.vectorRank !== undefined ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Vector Rank</span>
                                <span class="meta-value">#${chunk.vectorRank}</span>
                            </div>` : ''}
                            ${chunk.keywordRank !== undefined && chunk.keywordRank !== Infinity ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Keyword Rank</span>
                                <span class="meta-value">#${chunk.keywordRank}</span>
                            </div>` : ''}
                            ${chunk.matchedKeywords !== undefined ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Keywords Matched</span>
                                <span class="meta-value">${chunk.matchedKeywords} keyword${chunk.matchedKeywords !== 1 ? 's' : ''}</span>
                            </div>` : ''}
                            ${chunk.fusionMethod ? `
                            <div class="vecttauri-debug-meta-item">
                                <span class="meta-label">Fusion Method</span>
                                <span class="meta-value">${chunk.fusionMethod.toUpperCase()}</span>
                            </div>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Collapsed meta (shown when collapsed) -->
                <div class="vecttauri-debug-chunk-meta">
                    <span>Hash: ${String(chunk.hash).substring(0, 12)}...</span>
                    ${chunk.index !== undefined ? `<span>Msg #${chunk.index}</span>` : ''}
                    ${hasMoreText ? `<span class="vecttauri-debug-click-hint">Click to expand</span>` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * Determines why a chunk was excluded
 */
function getExclusionStatus(chunk, currentStage, data) {
    // Check each stage in order to find where it was dropped
    const threshold = data.settings.threshold || 0;

    // If we're looking at initial chunks, check what happened to them
    if (currentStage === 'initial') {
        // First check: did it pass threshold?
        const passedThreshold = (chunk.score || 0) >= threshold;
        if (!passedThreshold) {
            return 'Below threshold';
        }

        // Check if in afterThreshold stage
        const inAfterThreshold = data.stages.afterThreshold?.some(c => c.hash === chunk.hash);
        if (data.stages.afterThreshold && !inAfterThreshold) {
            return 'Below threshold';
        }

        // Check if in afterConditions
        const inAfterConditions = data.stages.afterConditions?.some(c => c.hash === chunk.hash);
        if (!inAfterConditions) {
            return 'Failed conditions';
        }

        // Check if injected
        const inInjected = data.stages.injected?.some(c => c.hash === chunk.hash);
        if (!inInjected) {
            return 'Not injected';
        }
    }

    // For other stages, check forward
    if (currentStage === 'afterThreshold') {
        const inAfterConditions = data.stages.afterConditions?.some(c => c.hash === chunk.hash);
        if (!inAfterConditions) {
            return 'Failed conditions';
        }
        const inInjected = data.stages.injected?.some(c => c.hash === chunk.hash);
        if (!inInjected) {
            return 'Not injected';
        }
    }

    if (currentStage === 'afterConditions') {
        const inInjected = data.stages.injected?.some(c => c.hash === chunk.hash);
        if (!inInjected) {
            return 'Not injected';
        }
    }

    return null;
}

/**
 * Builds a score breakdown showing the math behind the final score
 * Shows: vectorScore × keywordBoost = finalScore
 * For hybrid search: shows vector and text scores separately
 */
function buildScoreBreakdown(chunk) {
    // Check if this is a hybrid search result
    const isHybridSearch = chunk.hybridSearch || (chunk.vectorScore !== undefined && chunk.textScore !== undefined);

    if (isHybridSearch) {
        // Hybrid search breakdown - show vector and text scores
        const fusionMethod = chunk.fusionMethod || 'rrf';
        const isRRF = fusionMethod === 'rrf';
        const hasTextMatch = (chunk.textScore || 0) > 0.01;

        let matchIndicator = '';
        if (!hasTextMatch) {
            matchIndicator = '<span class="vecttauri-score-warning" title="No keyword match - semantic only">⚠️</span>';
        } else {
            matchIndicator = '<span class="vecttauri-score-good" title="Both semantic and keyword match">✓</span>';
        }

        // RRF final score is raw, but vector/text scores are still percentages (from Qdrant)
        let vectorDisplay, textDisplay, finalDisplay;
        if (isRRF) {
            vectorDisplay = ((chunk.vectorScore || 0) * 100).toFixed(0) + '%';  // Qdrant cosine
            textDisplay = ((chunk.textScore || 0) * 100).toFixed(0) + '%';     // Keyword match
            finalDisplay = (chunk.score || 0).toFixed(4);                      // RRF fusion
        } else {
            vectorDisplay = ((chunk.vectorScore || 0) * 100).toFixed(0) + '%';
            textDisplay = ((chunk.textScore || 0) * 100).toFixed(0) + '%';
            finalDisplay = ((chunk.score || 0) * 100).toFixed(1) + '%';
        }

        return `<div class="vecttauri-debug-score-breakdown vecttauri-hybrid-breakdown">
            <div class="vecttauri-hybrid-scores">
                <span class="vecttauri-score-vector-badge" title="Semantic similarity">🔷 Vector: ${vectorDisplay}</span>
                <span class="vecttauri-score-text-badge" title="Keyword/BM25 match">📝 Text: ${textDisplay}</span>
                ${matchIndicator}
            </div>
            <div class="vecttauri-score-math">
                <span class="vecttauri-score-fusion">${fusionMethod.toUpperCase()}</span>
                <span class="vecttauri-score-operator">→</span>
                <span class="vecttauri-score-final">${finalDisplay}</span>
            </div>
        </div>`;
    }

    // Standard (non-hybrid) breakdown
    const vectorScore = chunk.originalScore ?? chunk.score;
    const keywordBoost = chunk.keywordBoost ?? 1.0;
    const finalScore = chunk.score;

    const hasKeywordBoost = keywordBoost && keywordBoost !== 1.0;

    if (!hasKeywordBoost && vectorScore === finalScore) {
        return `<div class="vecttauri-debug-score-breakdown">
            <span class="vecttauri-score-math">Vector: ${vectorScore?.toFixed(3) || 'N/A'}</span>
        </div>`;
    }

    let mathParts = [];
    mathParts.push(`<span class="vecttauri-score-vector">${vectorScore?.toFixed(3) || '?'}</span>`);

    if (hasKeywordBoost) {
        let boostTitle = 'Keyword boost';
        if (chunk.matchedKeywordsWithWeights?.length > 0) {
            const kwDetails = chunk.matchedKeywordsWithWeights.map(k =>
                `${k.text}: +${((k.weight - 1) * 100).toFixed(0)}%`
            ).join(', ');
            boostTitle = `Additive boost: ${kwDetails}`;
        } else if (chunk.matchedKeywords?.length > 0) {
            boostTitle = `Matched: ${chunk.matchedKeywords.join(', ')}`;
        }
        mathParts.push(`<span class="vecttauri-score-operator">×</span>`);
        mathParts.push(`<span class="vecttauri-score-boost" title="${boostTitle}">${keywordBoost.toFixed(2)}x</span>`);
    }

    mathParts.push(`<span class="vecttauri-score-operator">=</span>`);
    mathParts.push(`<span class="vecttauri-score-final">${finalScore?.toFixed(3) || '?'}</span>`);

    // Add keyword matches with weights if present
    let keywordInfo = '';
    if (chunk.matchedKeywordsWithWeights?.length > 0) {
        const kwStr = chunk.matchedKeywordsWithWeights.map(k =>
            k.weight !== 1.5 ? `${k.text} (${k.weight}x)` : k.text
        ).join(', ');
        keywordInfo = `<div class="vecttauri-score-keywords">Keywords: ${kwStr}</div>`;
    } else if (chunk.matchedKeywords?.length > 0) {
        keywordInfo = `<div class="vecttauri-score-keywords">Keywords: ${chunk.matchedKeywords.join(', ')}</div>`;
    }

    return `<div class="vecttauri-debug-score-breakdown">
        <div class="vecttauri-score-math">${mathParts.join(' ')}</div>
        ${keywordInfo}
    </div>`;
}

/**
 * Renders critical failure alert when 0 chunks were injected
 * Diagnoses the pipeline and provides actionable fixes
 */
/**
 * Renders injection verification card - proof that injection actually happened
 */
function renderInjectionVerification(data) {
    // Only show if there were injected chunks
    if (!data.injection || data.stages.injected.length === 0) {
        return '';
    }

    const { verified, text, position, depth, charCount } = data.injection;
    const statusClass = verified ? 'vecttauri-verification-success' : 'vecttauri-verification-failed';
    const statusIcon = verified ? 'fa-circle-check' : 'fa-circle-xmark';
    const statusText = verified ? 'VERIFIED' : 'VERIFICATION FAILED';

    // Position label
    const positionLabels = {
        0: 'After Main Prompt',
        1: 'In-chat @ Depth',
        2: 'Before Main Prompt',
        3: 'After Character Defs',
        4: 'Before Character Defs',
        5: 'At End of Chat',
        6: 'Before AN/Author\'s Note'
    };
    const positionLabel = positionLabels[position] || `Position ${position}`;

    return `
        <div class="vecttauri-debug-card vecttauri-debug-verification ${statusClass}">
            <div class="vecttauri-debug-card-header vecttauri-debug-clickable" id="VectTauri_verification_header">
                <i class="fa-solid ${statusIcon}"></i>
                <span>Injection Verification</span>
                <span class="vecttauri-verification-badge ${statusClass}">${statusText}</span>
                <i class="fa-solid fa-chevron-down vecttauri-debug-expand-icon"></i>
            </div>
            <div class="vecttauri-debug-card-body">
                <div class="vecttauri-verification-summary">
                    <div class="vecttauri-verification-stat">
                        <span class="stat-label">Position</span>
                        <span class="stat-value">${positionLabel}</span>
                    </div>
                    <div class="vecttauri-verification-stat">
                        <span class="stat-label">Depth</span>
                        <span class="stat-value">${depth}</span>
                    </div>
                    <div class="vecttauri-verification-stat">
                        <span class="stat-label">Characters</span>
                        <span class="stat-value">${charCount.toLocaleString()}</span>
                    </div>
                </div>
                <div class="vecttauri-verification-text-wrapper" style="display: none;">
                    <div class="vecttauri-verification-text-label">Actual Injected Text:</div>
                    <pre class="vecttauri-verification-text">${StringUtils.escapeHtml(text)}</pre>
                </div>
            </div>
        </div>
    `;
}

function renderCriticalFailure(data) {
    // Only show if we got 0 injected chunks
    if (data.stages.injected.length > 0) {
        return '';
    }

    // Diagnose the pipeline step by step
    const diagnosis = diagnosePipeline(data);

    // Build a one-line summary of what went wrong
    const failedStage = diagnosis.find(d => d.isCause);
    const failureSummary = failedStage
        ? `Failed at: ${failedStage.label}`
        : 'Unknown failure point';

    return `
        <div class="vecttauri-debug-critical-failure">
            <div class="vecttauri-debug-critical-header">
                <div class="vecttauri-debug-critical-icon">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                    <div class="vecttauri-debug-critical-title">No Chunks Injected — ${failureSummary}</div>
                    <div class="vecttauri-debug-critical-subtitle">
                        ${data.stages.initial.length === 0
                            ? 'Vector search returned no results'
                            : `${data.stages.initial.length} chunks retrieved, but all were filtered out before injection`}
                    </div>
                </div>
            </div>

            <div class="vecttauri-debug-diagnosis">
                <div class="vecttauri-debug-diagnosis-title">
                    <i class="fa-solid fa-stethoscope"></i>
                    Pipeline Diagnosis
                </div>

                ${diagnosis.map((item, idx) => `
                    <div class="vecttauri-debug-diagnosis-item ${item.isCause ? 'is-cause' : ''} ${item.isOk ? 'is-ok' : ''}">
                        <div class="vecttauri-debug-diagnosis-number">${idx + 1}</div>
                        <div class="vecttauri-debug-diagnosis-content">
                            <div class="vecttauri-debug-diagnosis-label">
                                ${item.label}
                                <span class="vecttauri-debug-diagnosis-status ${item.isOk ? 'status-ok' : 'status-fail'}">
                                    ${item.isOk ? '✓ OK' : '✗ FAILED'}
                                </span>
                            </div>
                            <div class="vecttauri-debug-diagnosis-detail">${item.detail}</div>
                            ${item.fix ? `
                                <div class="vecttauri-debug-diagnosis-fix">
                                    <strong>Fix:</strong> ${item.fix}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Diagnoses the RAG pipeline to find where and why chunks were lost
 * Returns bespoke, specific fixes based on the actual data
 * @returns {Array<{label: string, detail: string, fix?: string, isCause: boolean, isOk: boolean}>}
 */
function diagnosePipeline(data) {
    const diagnosis = [];
    const threshold = data.settings.threshold || 0;
    const topK = data.settings.topK || 10;

    // Step 1: Initial Vector Search
    const initialCount = data.stages.initial.length;
    if (initialCount === 0) {
        diagnosis.push({
            label: 'Vector Search',
            detail: `No matches returned from vector database for collection "${data.collectionId}".`,
            fix: `Open Database Browser and check if "${data.collectionId}" exists and contains chunks. If empty, send some messages first to build the vector index.`,
            isCause: true,
            isOk: false
        });
        return diagnosis;
    }

    // Analyze initial chunks in detail
    const scores = data.stages.initial.map(c => c.score || 0);
    const bestScore = Math.max(...scores);
    const worstScore = Math.min(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    diagnosis.push({
        label: 'Vector Search',
        detail: `Retrieved ${initialCount} chunks. Scores: best ${bestScore.toFixed(3)}, worst ${worstScore.toFixed(3)}, avg ${avgScore.toFixed(3)}`,
        isCause: false,
        isOk: true
    });

    // Step 2: Threshold Filter - find chunks that would fail
    const aboveThreshold = data.stages.initial.filter(c => (c.score || 0) >= threshold);
    const belowThreshold = data.stages.initial.filter(c => (c.score || 0) < threshold);

    if (aboveThreshold.length === 0) {
        // ALL chunks failed threshold - give very specific fix
        const marginNeeded = (threshold - bestScore).toFixed(3);
        const suggestedThreshold = Math.max(0, bestScore - 0.02).toFixed(2);

        // Find the closest chunk to the threshold
        const closestChunk = data.stages.initial.reduce((closest, chunk) => {
            const diff = threshold - (chunk.score || 0);
            const closestDiff = threshold - (closest.score || 0);
            return diff < closestDiff ? chunk : closest;
        });

        diagnosis.push({
            label: 'Threshold Filter',
            detail: `All ${initialCount} chunks rejected. Your threshold is ${threshold}, but the best match only scored ${bestScore.toFixed(3)} (${marginNeeded} short).`,
            fix: `Change threshold from ${threshold} → ${suggestedThreshold}. Your closest chunk "${truncateText(closestChunk.text, 50)}" scored ${closestChunk.score?.toFixed(3)}.`,
            isCause: true,
            isOk: false
        });
        return diagnosis;
    } else if (belowThreshold.length > 0) {
        // Some chunks failed - show which ones and why
        const justMissed = belowThreshold.filter(c => (c.score || 0) >= threshold - 0.1);
        let detail = `${aboveThreshold.length}/${initialCount} passed threshold (${threshold}).`;
        if (justMissed.length > 0) {
            detail += ` ${justMissed.length} chunks just missed (within 0.1 of threshold).`;
        }
        diagnosis.push({
            label: 'Threshold Filter',
            detail: detail,
            isCause: false,
            isOk: true
        });
    } else {
        diagnosis.push({
            label: 'Threshold Filter',
            detail: `All ${initialCount} chunks passed threshold (${threshold}).`,
            isCause: false,
            isOk: true
        });
    }

    // Step 4: Condition Filtering - analyze what conditions failed
    const afterConditions = data.stages.afterConditions;
    const afterConditionsCount = afterConditions.length;

    // Find chunks lost to conditions
    const lostToConditions = aboveThreshold.filter(chunk => {
        return !afterConditions.some(cc => cc.hash === chunk.hash);
    });

    if (afterConditionsCount === 0 && aboveThreshold.length > 0) {
        // All chunks failed conditions - try to determine why
        const chunksWithConditions = aboveThreshold.filter(c => c.metadata?.conditions);

        if (chunksWithConditions.length > 0) {
            // Chunks had explicit conditions that failed
            const conditionTypes = [...new Set(chunksWithConditions.map(c =>
                c.metadata.conditions?.type || 'unknown'
            ))];
            diagnosis.push({
                label: 'Condition Filtering',
                detail: `All ${aboveThreshold.length} chunks failed their conditions. Condition types present: ${conditionTypes.join(', ')}.`,
                fix: `Check the conditions on your chunks. ${chunksWithConditions.length} chunks have explicit conditions (${conditionTypes.join(', ')}). These may be character filters, keyword requirements, or custom rules that aren't being met.`,
                isCause: true,
                isOk: false
            });
        } else {
            // No explicit conditions - might be protected messages or other filtering
            diagnosis.push({
                label: 'Condition Filtering',
                detail: `All ${aboveThreshold.length} chunks were filtered out. This may be due to message protection settings.`,
                fix: `Check if these messages fall within your "protect recent N messages" setting. Messages in the protected range won't be injected as RAG context.`,
                isCause: true,
                isOk: false
            });
        }
        return diagnosis;
    } else if (lostToConditions.length > 0) {
        diagnosis.push({
            label: 'Condition Filtering',
            detail: `${afterConditionsCount}/${aboveThreshold.length} passed conditions. ${lostToConditions.length} filtered out.`,
            isCause: false,
            isOk: true
        });
    } else {
        diagnosis.push({
            label: 'Condition Filtering',
            detail: `All ${afterConditionsCount} chunks passed.`,
            isCause: false,
            isOk: true
        });
    }

    // Step 5: Final Injection
    const injected = data.stages.injected;
    const injectedCount = injected.length;

    // Find chunks that passed conditions but weren't injected
    const notInjected = afterConditions.filter(chunk => {
        return !injected.some(ic => ic.hash === chunk.hash);
    });

    // Get skipped duplicates count from stats
    const skippedDuplicates = data.stats?.skippedDuplicates || 0;

    if (injectedCount === 0 && afterConditionsCount > 0) {
        if (topK === 0) {
            diagnosis.push({
                label: 'Injection',
                detail: `${afterConditionsCount} chunks ready but Top K is set to 0.`,
                fix: `Set Top K to at least 1. Currently Top K = 0 which means no chunks will ever be injected.`,
                isCause: true,
                isOk: false
            });
        } else if (skippedDuplicates > 0 && skippedDuplicates >= afterConditionsCount) {
            // All chunks were already in context - this is actually fine, not a failure
            diagnosis.push({
                label: 'Injection',
                detail: `All ${afterConditionsCount} retrieved chunks are already in current chat context.`,
                fix: `This is normal! The relevant content is already in your recent messages, so no injection was needed. RAG will inject when older/forgotten content becomes relevant.`,
                isCause: false,
                isOk: true
            });
        } else {
            // No specific failure reason tracked - this shouldn't happen
            diagnosis.push({
                label: 'Injection',
                detail: `${afterConditionsCount} chunks passed all filters but none were injected. No specific reason was recorded.`,
                fix: `This may be a bug. Open DevTools (F12) → Console tab, look for "VectTauri" errors, and report the issue with console output.`,
                isCause: true,
                isOk: false
            });
        }
    } else if (notInjected.length > 0) {
        // Some chunks not injected - explain why
        const reasons = [];
        if (skippedDuplicates > 0) reasons.push(`${skippedDuplicates} already in context`);
        const hitTopK = notInjected.length - skippedDuplicates;
        if (hitTopK > 0) reasons.push(`${hitTopK} hit Top K limit`);
        const reason = reasons.length > 0 ? reasons.join(', ') : `hit Top K limit (${topK})`;

        diagnosis.push({
            label: 'Injection',
            detail: `${injectedCount}/${afterConditionsCount} injected. ${notInjected.length} not injected: ${reason}.`,
            isCause: false,
            isOk: true
        });
    } else if (afterConditionsCount > 0) {
        diagnosis.push({
            label: 'Injection',
            detail: `All ${injectedCount} chunks injected successfully.`,
            isCause: false,
            isOk: true
        });
    }

    // Fallback if we somehow still have 0 injected and no cause found
    if (injectedCount === 0 && !diagnosis.some(d => d.isCause)) {
        diagnosis.push({
            label: 'Unknown',
            detail: 'Pipeline completed but no chunks were injected. No specific cause identified.',
            fix: `This may be a bug. Open DevTools (F12) → Console tab, look for "VectTauri" errors, and report the issue with console output.`,
            isCause: true,
            isOk: false
        });
    }

    return diagnosis;
}

/**
 * Truncates text to specified length with ellipsis
 */
function truncateText(text, maxLength) {
    if (!text) return '(no text)';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Renders analysis of why chunks were excluded
 */
function renderExcludedAnalysis(data) {
    const initial = data.stages.initial;
    const injected = data.stages.injected;
    const excluded = initial.filter(c => !injected.some(i => i.hash === c.hash));

    if (excluded.length === 0) {
        return '';
    }

    // Categorize exclusions
    const belowThreshold = excluded.filter(c => c.score < (data.settings.threshold || 0));
    const failedConditions = excluded.filter(c => {
        const aboveThreshold = c.score >= (data.settings.threshold || 0);
        const inConditions = data.stages.afterConditions.some(d => d.hash === c.hash);
        return aboveThreshold && !inConditions;
    });
    const limitExceeded = excluded.filter(c => {
        const inConditions = data.stages.afterConditions.some(d => d.hash === c.hash);
        const inInjected = data.stages.injected.some(d => d.hash === c.hash);
        return inConditions && !inInjected;
    });

    return `
        <div class="vecttauri-debug-card vecttauri-debug-exclusions">
            <div class="vecttauri-debug-card-header">
                <i class="fa-solid fa-filter-circle-xmark"></i>
                <span>Exclusion Analysis</span>
                <span class="vecttauri-debug-exclusion-count">${excluded.length} chunks excluded</span>
            </div>
            <div class="vecttauri-debug-card-body">
                <div class="vecttauri-debug-exclusion-categories">
                    ${belowThreshold.length > 0 ? `
                        <div class="vecttauri-debug-exclusion-category">
                            <div class="vecttauri-debug-exclusion-icon vecttauri-debug-exclusion-threshold">
                                <i class="fa-solid fa-less-than"></i>
                            </div>
                            <div class="vecttauri-debug-exclusion-info">
                                <strong>${belowThreshold.length}</strong> below threshold
                                <small>Score < ${data.settings.threshold}</small>
                            </div>
                        </div>
                    ` : ''}
                    ${failedConditions.length > 0 ? `
                        <div class="vecttauri-debug-exclusion-category">
                            <div class="vecttauri-debug-exclusion-icon vecttauri-debug-exclusion-conditions">
                                <i class="fa-solid fa-code-branch"></i>
                            </div>
                            <div class="vecttauri-debug-exclusion-info">
                                <strong>${failedConditions.length}</strong> failed conditions
                                <small>Chunk conditions not met</small>
                            </div>
                        </div>
                    ` : ''}
                    ${limitExceeded.length > 0 ? `
                        <div class="vecttauri-debug-exclusion-category">
                            <div class="vecttauri-debug-exclusion-icon vecttauri-debug-exclusion-limit">
                                <i class="fa-solid fa-ban"></i>
                            </div>
                            <div class="vecttauri-debug-exclusion-info">
                                <strong>${limitExceeded.length}</strong> hit injection limit
                                <small>Top K limit reached</small>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Gets CSS class for score value
 */
function getScoreClass(score) {
    if (score >= 0.7) return 'vecttauri-debug-score-high';
    if (score >= 0.4) return 'vecttauri-debug-score-medium';
    return 'vecttauri-debug-score-low';
}

/**
 * Gets human-readable time ago string
 */
function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(timestamp).toLocaleString();
}

// ============================================================================
// DEVELOPER TRACE LOG
// ============================================================================

/**
 * Renders the full trace log for debugging
 */
function renderTraceLog(data) {
    if (!data.trace || data.trace.length === 0) {
        return '';
    }

    const startTime = data.trace[0]?.time || data.timestamp;

    return `
        <div class="vecttauri-debug-card vecttauri-debug-trace">
            <div class="vecttauri-debug-card-header">
                <i class="fa-solid fa-terminal"></i>
                <span>Pipeline Trace Log</span>
                <button class="vecttauri-debug-toggle-btn" id="VectTauri_toggle_trace">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="vecttauri-debug-card-body vecttauri-debug-trace-body" id="VectTauri_trace_body" style="display: none;">
                <div class="vecttauri-debug-trace-list">
                    ${data.trace.map((entry, idx) => {
                        const relTime = entry.time - startTime;
                        const stageClass = getStageClass(entry.stage);
                        const detailsJson = JSON.stringify(
                            Object.fromEntries(
                                Object.entries(entry).filter(([k]) => !['time', 'stage', 'action'].includes(k))
                            ),
                            null, 2
                        );

                        return `
                            <div class="vecttauri-debug-trace-entry ${stageClass}">
                                <div class="vecttauri-debug-trace-time">+${relTime}ms</div>
                                <div class="vecttauri-debug-trace-stage">${entry.stage}</div>
                                <div class="vecttauri-debug-trace-action">${StringUtils.escapeHtml(entry.action)}</div>
                                ${detailsJson !== '{}' ? `
                                    <pre class="vecttauri-debug-trace-details">${StringUtils.escapeHtml(detailsJson)}</pre>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Renders per-chunk fate tracking
 */
function renderChunkFates(data) {
    if (!data.chunkFates || Object.keys(data.chunkFates).length === 0) {
        return '';
    }

    const fates = Object.values(data.chunkFates);
    const dropped = fates.filter(f => f.finalFate === 'dropped');
    const injected = fates.filter(f => f.finalFate === 'injected');

    return `
        <div class="vecttauri-debug-card vecttauri-debug-fates">
            <div class="vecttauri-debug-card-header">
                <i class="fa-solid fa-route"></i>
                <span>Chunk Fate Tracker</span>
                <span class="vecttauri-debug-fate-summary">
                    <span class="vecttauri-fate-injected">${injected.length} injected</span>
                    <span class="vecttauri-fate-dropped">${dropped.length} dropped</span>
                </span>
                <button class="vecttauri-debug-toggle-btn" id="VectTauri_toggle_fates">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="vecttauri-debug-card-body vecttauri-debug-fates-body" id="VectTauri_fates_body" style="display: none;">
                <div class="vecttauri-debug-fates-list">
                    ${fates.map(fate => {
                        const isDropped = fate.finalFate === 'dropped';
                        const hashShort = String(fate.hash).substring(0, 12);

                        return `
                            <div class="vecttauri-debug-fate-entry ${isDropped ? 'fate-dropped' : 'fate-injected'}">
                                <div class="vecttauri-debug-fate-header">
                                    <span class="vecttauri-debug-fate-hash" title="${fate.hash}">${hashShort}...</span>
                                    <span class="vecttauri-debug-fate-result ${isDropped ? 'result-dropped' : 'result-injected'}">
                                        ${isDropped ? `✗ Dropped at ${fate.droppedAt}` : '✓ Injected'}
                                    </span>
                                </div>
                                ${isDropped && fate.finalReason ? `
                                    <div class="vecttauri-debug-fate-reason">${StringUtils.escapeHtml(fate.finalReason)}</div>
                                ` : ''}
                                <div class="vecttauri-debug-fate-journey">
                                    ${fate.stages.map(s => `
                                        <span class="vecttauri-fate-stage ${s.fate === 'dropped' ? 'stage-dropped' : s.fate === 'injected' ? 'stage-injected' : 'stage-passed'}">
                                            ${s.stage}${s.fate === 'dropped' ? ' ✗' : s.fate === 'injected' ? ' ✓' : ''}
                                        </span>
                                    `).join('<span class="vecttauri-fate-arrow">→</span>')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Gets CSS class for trace stage
 */
function getStageClass(stage) {
    const stageClasses = {
        'init': 'trace-init',
        'vector_search': 'trace-search',
        'threshold': 'trace-threshold',
        'decay': 'trace-decay',
        'conditions': 'trace-conditions',
        'injection': 'trace-injection',
        'final': 'trace-final'
    };
    return stageClasses[stage] || 'trace-default';
}

/**
 * Generates diagnostic dump for debugging
 */
function generateDiagnosticDump(data) {
    const d = data;
    const s = d.settings;
    const st = d.stages;

    // Chunk fates - readable format
    const fates = Object.values(d.chunkFates || {});
    const fatesSummary = fates.map(f => {
        const journey = f.stages.map(s => {
            const status = s.fate === 'passed' ? '✓' : s.fate === 'dropped' ? '✗' : '→';
            return `${s.stage}${status}`;
        }).join(' → ');
        const result = f.finalFate === 'dropped'
            ? `DROPPED at ${f.droppedAt}: ${f.finalReason || 'unknown'}`
            : f.finalFate === 'injected' ? 'INJECTED' : 'unknown';
        return `  [${String(f.hash).slice(0,10)}] ${journey}\n    Result: ${result}`;
    });

    // Trace - readable
    const startTime = d.trace?.[0]?.time || d.timestamp;
    const traceLines = (d.trace || []).map(t => {
        const ms = t.time - startTime;
        const details = Object.entries(t)
            .filter(([k]) => !['time', 'stage', 'action'].includes(k))
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(', ');
        return `  +${String(ms).padStart(4)}ms [${t.stage.padEnd(12)}] ${t.action}${details ? '\n           ' + details : ''}`;
    });

    // Injection info - skipped duplicates (chunks already in context)
    const skippedCount = d.stats?.skippedDuplicates || 0;
    const injectionInfo = skippedCount > 0
        ? `  ${skippedCount} chunks skipped (already in current chat context)`
        : '  No chunks skipped';

    // Build human-readable dump
    const dump = `VectTauri DEBUG DUMP
${'='.repeat(50)}
Time: ${new Date(d.timestamp).toLocaleString()}
Collection: ${d.collectionId}

SETTINGS
  Threshold: ${s.threshold}
  Top K: ${s.topK}
  Min Chat Length: ${s.min_chat_length ?? 0} (current: ${s.chatLength} messages)

PIPELINE RESULTS
  Vector Search: ${st.initial?.length || 0} chunks retrieved
  After Threshold: ${st.afterThreshold?.length || 0} passed (threshold: ${s.threshold})
  After Conditions: ${st.afterConditions?.length || 0} passed
  Final Injected: ${st.injected?.length || 0}

INITIAL SCORES (top 10)
  ${st.initial?.slice(0, 10).map((c, i) => {
      const parts = [`#${i+1}: ${c.score?.toFixed(3)}`];
      if (c.originalScore !== undefined && c.originalScore !== c.score) {
          parts.push(`(vector: ${c.originalScore?.toFixed(3)}`);
          if (c.keywordBoost && c.keywordBoost !== 1.0) {
              parts.push(`× ${c.keywordBoost?.toFixed(2)}x boost`);
          }
          parts.push(')');
      }
      if (c.matchedKeywordsWithWeights?.length > 0) {
          const kwStr = c.matchedKeywordsWithWeights.map(k =>
              k.weight !== 1.5 ? `${k.text}(${k.weight}x)` : k.text
          ).join(', ');
          parts.push(`[keywords: ${kwStr}]`);
      } else if (c.matchedKeywords?.length > 0) {
          parts.push(`[keywords: ${c.matchedKeywords.join(', ')}]`);
      }
      parts.push(`[${String(c.hash).slice(0,8)}]`);
      return parts.join(' ');
  }).join('\n  ') || 'none'}

INJECTION STATUS
${injectionInfo}
  Skipped: ${skippedCount} chunks (already in context)
  Injected: ${st.injected?.length || 0} chunks

CHUNK FATES
${fatesSummary.join('\n\n') || '  none'}

TRACE LOG
${traceLines.join('\n') || '  none'}

QUERY (full)
  ${d.query?.replace(/\n/g, '\n  ') || 'empty'}
${'='.repeat(50)}`;

    return dump;
}

/**
 * Copies diagnostic dump to clipboard
 */
async function copyDiagnosticDump() {
    if (!lastDebugData) {
        toastr.warning('No debug data available');
        return;
    }

    try {
        const dump = generateDiagnosticDump(lastDebugData);
        await navigator.clipboard.writeText(dump);
        toastr.success('Diagnostic dump copied to clipboard');
    } catch (err) {
        console.error('Failed to copy diagnostic:', err);
        toastr.error('Failed to copy to clipboard');
    }
}

// ============================================================================
// EVENT BINDING
// ============================================================================

// Track current history index for refreshing modal
let currentHistoryIndex = 0;

function bindEvents() {
    // Close button
    $('#VectTauri_search_debug_close').on('click', closeSearchDebugModal);

    // Copy diagnostic dump
    $('#VectTauri_copy_diagnostic').on('click', copyDiagnosticDump);

    // Stop mousedown propagation (ST closes drawers on mousedown/touchstart)
    $('#VectTauri_search_debug_modal').on('mousedown touchstart', function(e) {
        e.stopPropagation();
    });

    // Close on background click
    $('#VectTauri_search_debug_modal').on('click', function(e) {
        if (e.target === this) {
            closeSearchDebugModal();
        }
    });

    // History tabs - switch between past queries
    $('.vecttauri-debug-history-tab').on('click', function() {
        const historyIndex = parseInt($(this).data('history-index'));
        if (queryHistory[historyIndex]) {
            currentHistoryIndex = historyIndex;
            lastDebugData = queryHistory[historyIndex];
            // Refresh the modal content
            const newHtml = createModalHtml(lastDebugData, historyIndex);
            $('#VectTauri_search_debug_modal').replaceWith(newHtml);
            $('#VectTauri_search_debug_modal').show();
            bindEvents();
        }
    });

    // Query card expand/collapse
    $('#VectTauri_query_header').on('click', function() {
        const $card = $(this).closest('.vecttauri-debug-query-card');
        const $preview = $card.find('.vecttauri-debug-query-preview');
        const $full = $card.find('.vecttauri-debug-query-full');
        const $icon = $(this).find('.vecttauri-debug-expand-icon');

        $preview.slideToggle(200);
        $full.slideToggle(200);
        $icon.toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Verification card expand/collapse (shows actual injected text)
    $('#VectTauri_verification_header').on('click', function() {
        const $card = $(this).closest('.vecttauri-debug-verification');
        const $textWrapper = $card.find('.vecttauri-verification-text-wrapper');
        const $icon = $(this).find('.vecttauri-debug-expand-icon');

        $textWrapper.slideToggle(200);
        $icon.toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Expandable chunks
    $(document).off('click.chunkExpand').on('click.chunkExpand', '.vecttauri-debug-chunk-expandable', function(e) {
        // Don't trigger if clicking on a link or button inside
        if ($(e.target).is('a, button')) return;

        const $chunk = $(this);
        const $expanded = $chunk.find('.vecttauri-debug-chunk-expanded');
        const $preview = $chunk.find('.vecttauri-debug-chunk-text-preview');
        const $meta = $chunk.find('.vecttauri-debug-chunk-meta');
        const $icon = $chunk.find('.vecttauri-debug-chunk-expand-icon');

        $expanded.slideToggle(200);
        $preview.slideToggle(200);
        $meta.slideToggle(200);
        $icon.toggleClass('fa-chevron-down fa-chevron-up');
        $chunk.toggleClass('expanded');
    });

    // Stage tabs
    $('.vecttauri-debug-stage-tab').on('click', function() {
        const stage = $(this).data('stage');
        $('.vecttauri-debug-stage-tab').removeClass('active');
        $(this).addClass('active');

        const data = lastDebugData;
        if (data && data.stages[stage]) {
            $('#VectTauri_debug_stage_content').html(
                renderStageChunks(data.stages[stage], stage, data)
            );
        }
    });

    // Toggle trace log
    $('#VectTauri_toggle_trace').on('click', function() {
        $('#VectTauri_trace_body').slideToggle();
        $(this).find('i').toggleClass('fa-chevron-down fa-chevron-up');
    });

    // Toggle chunk fates
    $('#VectTauri_toggle_fates').on('click', function() {
        $('#VectTauri_fates_body').slideToggle();
        $(this).find('i').toggleClass('fa-chevron-down fa-chevron-up');
    });
}

// ============================================================================
// EVENTBASE QUERY TESTER
// ============================================================================

/**
 * Opens the EventBase Query Tester modal.
 * The user types a test message, clicks Run, and sees the exact
 * <VectTauriMemory> block that would be injected for that message —
 * using all current settings (agentic mode, filters, locked collections).
 */
export function openQueryTestModal() {
    $('#VectTauri_query_tester_modal').remove();

    const sectionStyle = 'display:flex; flex-direction:column; gap:4px; border-left:3px solid; padding-left:8px;';

    const html = `
        <div id="VectTauri_query_tester_modal" class="vecttauri-modal" style="display:none;">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content" style="max-width:700px; max-height:92vh; display:flex; flex-direction:column;">
                <div class="vecttauri-modal-header">
                    <h3><i class="fa-solid fa-flask"></i> VectTauri Query Tester</h3>
                    <button class="vecttauri-modal-close" id="VectTauri_qtester_close">✕</button>
                </div>
                <div class="vecttauri-modal-body" style="padding:16px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; flex:1 1 auto;">
                    <small style="color:var(--SmartThemeQuoteColor,#999);">
                        Dry-run all three pipelines (EventBase, ChunkBase, Lorebook WI) against a test message.
                        Uses your current settings and locked collections. Prompt injection is <b>not</b> affected.
                    </small>
                    <textarea id="VectTauri_qtester_input"
                        class="text_pole"
                        placeholder="e.g. Do you remember how I rescued you?"
                        rows="3"
                        style="resize:vertical; width:100%; box-sizing:border-box;"></textarea>
                    <button id="VectTauri_qtester_run" class="menu_button" style="align-self:flex-start;">
                        <i class="fa-solid fa-play"></i>&nbsp;Run All Pipelines
                    </button>
                    <div id="VectTauri_qtester_status" style="display:none; color:var(--SmartThemeQuoteColor,#999); font-size:0.85em;">
                        <i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Running retrieval…
                    </div>
                    <div id="VectTauri_qtester_result" style="display:none; flex-direction:column; gap:14px;">
                        <div style="${sectionStyle} border-color:#4a9eff;">
                            <small style="font-weight:bold; color:#4a9eff;">EventBase <span id="VectTauri_qtester_meta_eb" style="font-weight:normal; color:var(--SmartThemeQuoteColor,#999);"></span></small>
                            <textarea id="VectTauri_qtester_output_eb" readonly rows="8"
                                style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.78em; resize:vertical; white-space:pre-wrap; overflow-wrap:break-word;"></textarea>
                        </div>
                        <div style="${sectionStyle} border-color:#4dbb6e;">
                            <small style="font-weight:bold; color:#4dbb6e;">ChunkBase <span id="VectTauri_qtester_meta_cb" style="font-weight:normal; color:var(--SmartThemeQuoteColor,#999);"></span></small>
                            <textarea id="VectTauri_qtester_output_cb" readonly rows="8"
                                style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.78em; resize:vertical; white-space:pre-wrap; overflow-wrap:break-word;"></textarea>
                        </div>
                        <div style="${sectionStyle} border-color:#b06fff;">
                            <small style="font-weight:bold; color:#b06fff;">Lorebook WI <span id="VectTauri_qtester_meta_lb" style="font-weight:normal; color:var(--SmartThemeQuoteColor,#999);"></span></small>
                            <textarea id="VectTauri_qtester_output_lb" readonly rows="8"
                                style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.78em; resize:vertical; white-space:pre-wrap; overflow-wrap:break-word;"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);

    $('#VectTauri_query_tester_modal').on('mousedown touchstart', e => e.stopPropagation());
    $('#VectTauri_qtester_close').on('click', _closeQueryTester);
    $('#VectTauri_query_tester_modal').on('click', function (e) {
        if (e.target === this) _closeQueryTester();
    });

    $('#VectTauri_qtester_run').on('click', async function () {
        const testMessage = $('#VectTauri_qtester_input').val().trim();
        if (!testMessage) {
            toastr.warning('Enter a test message first.', 'VectTauri');
            return;
        }

        $('#VectTauri_qtester_run').prop('disabled', true);
        $('#VectTauri_qtester_status').show();
        $('#VectTauri_qtester_result').hide().css('display', 'none');

        try {
            const [
                { extension_settings, getContext },
                { runEventBaseRetrieval },
                { rearrangeChat },
                { runLorebookWIDryRun },
            ] = await Promise.all([
                import('../../../../extensions.js'),
                import('../core/eventbase-workflow.js'),
                import('../core/chat-vectorization.js'),
                import('../core/world-info-integration.js'),
            ]);

            const settings = extension_settings.vecttauri;
            const { chat } = getContext();

            const [ebResult, cbResult, lbResult] = await Promise.all([
                runEventBaseRetrieval({ chat, searchText: testMessage, settings, dryRun: true, testMessage }),
                rearrangeChat(chat, settings, 'normal', { dryRun: true, testMessage }),
                runLorebookWIDryRun({ chat, testMessage, settings }),
            ]);

            $('#VectTauri_qtester_status').hide();

            // --- EventBase ---
            if (ebResult?.injectionText) {
                $('#VectTauri_qtester_meta_eb').text(`— ${ebResult.eventCount ?? '?'} event(s) retrieved`);
                $('#VectTauri_qtester_output_eb').val(ebResult.injectionText);
            } else {
                const locked = (ebResult?.lockedCollectionsCount ?? 0) + (ebResult?.archiveCollectionsCount ?? 0);
                $('#VectTauri_qtester_meta_eb').text('— no results');
                $('#VectTauri_qtester_output_eb').val(
                    locked === 0
                        ? '(no EventBase collections are locked to this chat)'
                        : `(searched ${locked} collection(s) — 0 events matched. Try a more specific query or lower the score threshold.)`
                );
            }

            // --- ChunkBase ---
            if (cbResult?.injectionText) {
                $('#VectTauri_qtester_meta_cb').text(`— ${cbResult.chunkCount ?? '?'} chunk(s) retrieved`);
                $('#VectTauri_qtester_output_cb').val(cbResult.injectionText);
            } else {
                const reason = cbResult?.noCollections ? 'no ChunkBase collections are enabled'
                    : cbResult?.noActive ? 'no collections passed activation filters'
                    : cbResult?.allDuplicates ? 'all chunks already in context (dedup)'
                    : '0 chunks matched the query';
                $('#VectTauri_qtester_meta_cb').text('— no results');
                $('#VectTauri_qtester_output_cb').val(`(${reason})`);
            }

            // --- Lorebook WI ---
            if (lbResult?.injectionText) {
                $('#VectTauri_qtester_meta_lb').text(`— ${lbResult.entryCount ?? '?'} entry/entries retrieved`);
                $('#VectTauri_qtester_output_lb').val(lbResult.injectionText);
            } else {
                const reason = lbResult?.disabled ? 'Lorebook WI is disabled in settings'
                    : lbResult?.noCollections ? 'no vectorized lorebook collections found'
                    : '0 entries matched the query';
                $('#VectTauri_qtester_meta_lb').text('— no results');
                $('#VectTauri_qtester_output_lb').val(`(${reason})`);
            }

            $('#VectTauri_qtester_result').css('display', 'flex').show();
        } catch (err) {
            $('#VectTauri_qtester_status').hide();
            console.error('[VectTauri Query Tester]', err);
            toastr.error(`Retrieval failed: ${err.message}`, 'VectTauri');
        } finally {
            $('#VectTauri_qtester_run').prop('disabled', false);
        }
    });

    $('#VectTauri_query_tester_modal').fadeIn(200);
    setTimeout(() => $('#VectTauri_qtester_input').focus(), 250);
}

function _closeQueryTester() {
    $('#VectTauri_query_tester_modal').fadeOut(200, function () { $(this).remove(); });
}
