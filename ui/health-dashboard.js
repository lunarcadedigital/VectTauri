/**
 * ============================================================================
 * VEC-18: BACKEND HEALTH DASHBOARD
 * ============================================================================
 * Real-time monitoring dashboard for vector backend health and metrics.
 *
 * Features:
 * - Health status indicator
 * - Query latency statistics
 * - Operation counts (queries, inserts, deletes)
 * - Error tracking and display
 * - Auto-refresh with configurable interval
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import { getBackendMetrics, probeBackendHealth } from '../backends/backend-manager.js';
import { extension_settings } from '../../../../extensions.js';
import { isVectTauriEnabled } from '../core/feature-gate.js';

let refreshInterval = null;
let isModalOpen = false;

/**
 * Get the current backend name from settings
 * @returns {string} Current backend name
 */
function getCurrentBackend() {
    return extension_settings.vecttauri?.vector_backend || 'standard';
}

/**
 * Format a timestamp as a relative time string
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {string} Relative time string
 */
function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

/**
 * Get health status class for styling
 * @param {boolean} healthy - Health status
 * @param {number} errors - Error count
 * @returns {string} CSS class name
 */
function getHealthClass(healthy, errors = 0) {
    if (!healthy) return 'vecttauri-health-error';
    if (errors > 0) return 'vecttauri-health-warning';
    return 'vecttauri-health-ok';
}

/**
 * Get health status icon
 * @param {boolean} healthy - Health status
 * @param {number} errors - Error count
 * @returns {string} Status icon
 */
function getHealthIcon(healthy, errors = 0) {
    if (!healthy) return '&#x2716;'; // X mark
    if (errors > 0) return '&#x26A0;'; // Warning
    return '&#x2714;'; // Check mark
}

/**
 * Render the health dashboard content
 * @returns {string} HTML content
 */
function renderDashboard() {
    const metrics = getBackendMetrics();
    const currentBackend = getCurrentBackend();

    // Find current backend metrics
    const currentMetrics = metrics.backends.find(b => b.name === currentBackend) || {
        name: currentBackend,
        healthy: false,
        queries: 0,
        inserts: 0,
        deletes: 0,
        errors: 0,
        avgLatency: 0,
        minLatency: null,
        maxLatency: null,
    };

    const healthClass = getHealthClass(currentMetrics.healthy, currentMetrics.errors);
    const healthIcon = getHealthIcon(currentMetrics.healthy, currentMetrics.errors);

    return `
        <div class="vecttauri-health-dashboard">
            <!-- Summary Section -->
            <div class="vecttauri-health-summary">
                <div class="vecttauri-health-status ${healthClass}">
                    <span class="vecttauri-health-icon">${healthIcon}</span>
                    <span class="vecttauri-health-label">${currentMetrics.healthy ? 'Healthy' : 'Unhealthy'}</span>
                </div>
                <div class="vecttauri-health-uptime">
                    <small>Uptime: ${metrics.uptimeFormatted}</small>
                </div>
            </div>

            <!-- Current Backend Section -->
            <div class="vecttauri-health-section">
                <h4>Current Backend: ${currentBackend}</h4>
                <div class="vecttauri-health-grid">
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.queries}</span>
                        <span class="vecttauri-stat-label">Queries</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.inserts}</span>
                        <span class="vecttauri-stat-label">Inserts</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.deletes}</span>
                        <span class="vecttauri-stat-label">Deletes</span>
                    </div>
                    <div class="vecttauri-health-stat ${currentMetrics.errors > 0 ? 'vecttauri-stat-error' : ''}">
                        <span class="vecttauri-stat-value">${currentMetrics.errors}</span>
                        <span class="vecttauri-stat-label">Errors</span>
                    </div>
                </div>
            </div>

            <!-- Latency Section -->
            <div class="vecttauri-health-section">
                <h4>Query Latency</h4>
                <div class="vecttauri-health-grid">
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.avgLatency || 0}ms</span>
                        <span class="vecttauri-stat-label">Average</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.minLatency !== null ? currentMetrics.minLatency + 'ms' : '-'}</span>
                        <span class="vecttauri-stat-label">Min</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.maxLatency !== null ? currentMetrics.maxLatency + 'ms' : '-'}</span>
                        <span class="vecttauri-stat-label">Max</span>
                    </div>
                </div>
            </div>

            <!-- Health Checks Section -->
            <div class="vecttauri-health-section">
                <h4>Health Checks</h4>
                <div class="vecttauri-health-grid">
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${currentMetrics.healthChecksPassed || 0}</span>
                        <span class="vecttauri-stat-label">Passed</span>
                    </div>
                    <div class="vecttauri-health-stat ${currentMetrics.healthChecksFailed > 0 ? 'vecttauri-stat-error' : ''}">
                        <span class="vecttauri-stat-value">${currentMetrics.healthChecksFailed || 0}</span>
                        <span class="vecttauri-stat-label">Failed</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${formatRelativeTime(currentMetrics.lastHealthCheck)}</span>
                        <span class="vecttauri-stat-label">Last Check</span>
                    </div>
                </div>
            </div>

            <!-- Last Error Section -->
            ${currentMetrics.lastError ? `
            <div class="vecttauri-health-section vecttauri-health-error-section">
                <h4>Last Error</h4>
                <div class="vecttauri-health-error-box">
                    <span class="vecttauri-error-time">${formatRelativeTime(currentMetrics.lastError.timestamp)}</span>
                    <span class="vecttauri-error-message">${currentMetrics.lastError.message}</span>
                </div>
            </div>
            ` : ''}

            <!-- Global Stats Section -->
            <div class="vecttauri-health-section">
                <h4>Global Statistics</h4>
                <div class="vecttauri-health-grid">
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${metrics.totalQueries}</span>
                        <span class="vecttauri-stat-label">Total Queries</span>
                    </div>
                    <div class="vecttauri-health-stat">
                        <span class="vecttauri-stat-value">${metrics.totalInserts}</span>
                        <span class="vecttauri-stat-label">Total Inserts</span>
                    </div>
                    <div class="vecttauri-health-stat ${metrics.totalErrors > 0 ? 'vecttauri-stat-error' : ''}">
                        <span class="vecttauri-stat-value">${metrics.totalErrors}</span>
                        <span class="vecttauri-stat-label">Total Errors</span>
                    </div>
                </div>
            </div>

            <!-- Active Backends -->
            ${metrics.activeBackends.length > 0 ? `
            <div class="vecttauri-health-section">
                <h4>Active Backends</h4>
                <div class="vecttauri-active-backends">
                    ${metrics.activeBackends.map(name => `<span class="vecttauri-backend-badge">${name}</span>`).join('')}
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

/**
 * Update the dashboard content — probes backend health first for a live reading
 */
async function updateDashboard() {
    const currentBackend = getCurrentBackend();
    const settings = extension_settings.vecttauri;
    await probeBackendHealth(currentBackend, settings);
    const content = document.getElementById('VectTauri_health_content');
    if (content && isModalOpen) {
        content.innerHTML = renderDashboard();
    }
}

/**
 * Start auto-refresh
 * @param {number} intervalMs - Refresh interval in milliseconds
 */
function startAutoRefresh(intervalMs = 5000) {
    stopAutoRefresh();
    refreshInterval = setInterval(updateDashboard, intervalMs);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

/**
 * Open the health dashboard modal
 */
export function openHealthDashboard() {
    isModalOpen = true;
    const modal = document.getElementById('VectTauri_health_modal');
    if (modal) {
        modal.style.display = 'flex';
        updateDashboard();
        startAutoRefresh(5000);
    }
}

/**
 * Close the health dashboard modal
 */
export function closeHealthDashboard() {
    isModalOpen = false;
    stopAutoRefresh();
    const modal = document.getElementById('VectTauri_health_modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Get the health indicator HTML for the main UI
 * @returns {string} HTML for health indicator
 */
export function getHealthIndicatorHtml() {
    const metrics = getBackendMetrics();
    const currentBackend = getCurrentBackend();
    const currentMetrics = metrics.backends.find(b => b.name === currentBackend);

    const healthy = currentMetrics?.healthy ?? false;
    const errors = currentMetrics?.errors ?? 0;
    const healthClass = getHealthClass(healthy, errors);

    return `
        <button id="VectTauri_health_indicator" class="vecttauri-health-indicator ${healthClass}" title="Backend Health">
            <span class="vecttauri-health-dot"></span>
        </button>
    `;
}

/**
 * Get the health modal HTML
 * @returns {string} HTML for health modal
 */
export function getHealthModalHtml() {
    return `
        <div id="VectTauri_health_modal" class="vecttauri-modal" style="display: none;">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content vecttauri-health-modal">
                <div class="vecttauri-modal-header">
                    <h3>Backend Health Dashboard</h3>
                    <button class="vecttauri-modal-close" id="VectTauri_health_close">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="vecttauri-modal-body">
                    <div id="VectTauri_health_content">
                        ${renderDashboard()}
                    </div>
                </div>
                <div class="vecttauri-modal-footer">
                    <small>Auto-refreshes every 5 seconds</small>
                    <button id="VectTauri_health_refresh" class="vecttauri-btn-secondary">Refresh Now</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Run a health probe and refresh the indicator dot.
 */
export async function refreshIndicator() {
    const indicator = document.getElementById('VectTauri_health_indicator');
    if (!indicator) return;
    const currentBackend = getCurrentBackend();
    await probeBackendHealth(currentBackend, extension_settings.vecttauri);
    const metrics = getBackendMetrics();
    const currentMetrics = metrics.backends.find(b => b.name === currentBackend);
    const healthy = currentMetrics?.healthy ?? false;
    const errors = currentMetrics?.errors ?? 0;
    indicator.className = `vecttauri-health-indicator ${getHealthClass(healthy, errors)}`;
}

/**
 * Initialize health dashboard event handlers
 */
export function initializeHealthDashboard() {
    // Health indicator click
    $(document).on('click', '#VectTauri_health_indicator', openHealthDashboard);

    // Close button
    $(document).on('click', '#VectTauri_health_close', closeHealthDashboard);

    // Overlay click
    $(document).on('click', '#VectTauri_health_modal .vecttauri-modal-overlay', closeHealthDashboard);

    // Refresh button
    $(document).on('click', '#VectTauri_health_refresh', updateDashboard);

    // Probe when the VectTauri panel drawer is expanded
    $(document).on('click', '#VectTauri_settings .inline-drawer-toggle', function() {
        const isOpening = $(this).closest('.inline-drawer').find('.inline-drawer-content').is(':hidden')
            || $(this).find('.inline-drawer-icon').hasClass('down');
        if (isOpening) refreshIndicator();
    });

    // Probe immediately on init (Action tab is the default tab on load). Skipped while
    // VectTauri is disabled: opening the panel probes on demand, and switching VectTauri
    // back on refreshes the indicator.
    if (isVectTauriEnabled()) {
        refreshIndicator();
    }
}

/**
 * Get CSS styles for the health dashboard
 * @returns {string} CSS styles
 */
export function getHealthDashboardStyles() {
    return `
        /* Health Indicator */
        .vecttauri-health-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            background: transparent;
            padding: 0;
        }

        .vecttauri-health-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            transition: background-color 0.3s;
        }

        .vecttauri-health-ok .vecttauri-health-dot {
            background-color: #4caf50;
            box-shadow: 0 0 6px rgba(76, 175, 80, 0.5);
        }

        .vecttauri-health-warning .vecttauri-health-dot {
            background-color: #ff9800;
            box-shadow: 0 0 6px rgba(255, 152, 0, 0.5);
        }

        .vecttauri-health-error .vecttauri-health-dot {
            background-color: #f44336;
            box-shadow: 0 0 6px rgba(244, 67, 54, 0.5);
        }

        /* Health Dashboard Modal */
        .vecttauri-health-modal {
            max-width: 500px;
        }

        .vecttauri-health-dashboard {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .vecttauri-health-summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
        }

        .vecttauri-health-status {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 1.1em;
            font-weight: 600;
        }

        .vecttauri-health-status.vecttauri-health-ok {
            color: #4caf50;
        }

        .vecttauri-health-status.vecttauri-health-warning {
            color: #ff9800;
        }

        .vecttauri-health-status.vecttauri-health-error {
            color: #f44336;
        }

        .vecttauri-health-icon {
            font-size: 1.2em;
        }

        .vecttauri-health-section {
            padding: 12px;
            background: rgba(0,0,0,0.1);
            border-radius: 8px;
        }

        .vecttauri-health-section h4 {
            margin: 0 0 12px 0;
            font-size: 0.9em;
            opacity: 0.8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .vecttauri-health-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
            gap: 12px;
        }

        .vecttauri-health-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 8px;
            background: rgba(0,0,0,0.15);
            border-radius: 6px;
        }

        .vecttauri-stat-value {
            font-size: 1.4em;
            font-weight: 600;
        }

        .vecttauri-stat-label {
            font-size: 0.75em;
            opacity: 0.7;
            text-transform: uppercase;
        }

        .vecttauri-stat-error .vecttauri-stat-value {
            color: #f44336;
        }

        .vecttauri-health-error-section {
            border-left: 3px solid #f44336;
        }

        .vecttauri-health-error-box {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px;
            background: rgba(244, 67, 54, 0.1);
            border-radius: 4px;
        }

        .vecttauri-error-time {
            font-size: 0.8em;
            opacity: 0.7;
        }

        .vecttauri-error-message {
            font-size: 0.9em;
            color: #f44336;
            word-break: break-word;
        }

        .vecttauri-active-backends {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .vecttauri-backend-badge {
            padding: 4px 10px;
            background: rgba(255,255,255,0.1);
            border-radius: 12px;
            font-size: 0.85em;
        }

        .vecttauri-modal-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }

        .vecttauri-modal-footer small {
            opacity: 0.6;
        }
    `;
}
