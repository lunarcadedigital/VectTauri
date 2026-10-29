/**
 * ============================================================================
 * VectTauri TEXT CLEANING MANAGER
 * ============================================================================
 * Standalone UI for managing text cleaning regex patterns.
 * Accessible from the Actions panel.
 *
 * @author Lunarcade Digital
 * @version 1.0.0
 * ============================================================================
 */

import { saveSettingsDebounced } from '../../../../../script.js';
import {
    BUILTIN_PATTERNS,
    CLEANING_PRESETS,
    getCleaningSettings,
    saveCleaningSettings,
    addCustomPattern,
    updateCustomPattern,
    removeCustomPattern,
    exportPatterns,
    importPatterns,
    testPattern,
} from '../core/text-cleaning.js';
import StringUtils from '../utils/string-utils.js';

/**
 * Opens the Text Cleaning Manager modal
 */
export function openTextCleaningManager() {
    // Remove existing modal if present
    $('#VectTauri_text_cleaning_modal').remove();

    const settings = getCleaningSettings();

    const html = `
        <div id="VectTauri_text_cleaning_modal" class="vecttauri-modal">
            <div class="vecttauri-modal-overlay"></div>
            <div class="vecttauri-modal-content vecttauri-text-cleaning-content">
                <div class="vecttauri-modal-header">
                    <h3>
                        <i class="fa-solid fa-broom"></i>
                        Text Cleaning Manager
                    </h3>
                    <button class="vecttauri-modal-close" id="VectTauri_tcm_close">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>

                <div class="vecttauri-tcm-body">
                    <p class="vecttauri-tcm-intro">
                        Configure regex patterns to clean text before vectorization.
                        Patterns are applied in order to remove HTML tags, metadata, and unwanted content.
                    </p>

                    <!-- Current Preset Display -->
                    <div class="vecttauri-tcm-section">
                        <div class="vecttauri-tcm-section-header">
                            <h4>Active Preset</h4>
                        </div>
                        <div class="vecttauri-tcm-preset-info">
                            <select id="VectTauri_tcm_preset" class="vecttauri-select">
                                ${Object.entries(CLEANING_PRESETS).map(([id, preset]) => `
                                    <option value="${id}" ${settings.selectedPreset === id ? 'selected' : ''}>
                                        ${preset.name}
                                    </option>
                                `).join('')}
                                <option value="custom" ${settings.selectedPreset === 'custom' ? 'selected' : ''}>
                                    Custom
                                </option>
                            </select>
                            <span class="vecttauri-tcm-preset-desc" id="VectTauri_tcm_preset_desc">
                                ${getPresetDescription(settings.selectedPreset)}
                            </span>
                        </div>
                    </div>

                    <!-- Built-in Patterns -->
                    <div class="vecttauri-tcm-section">
                        <div class="vecttauri-tcm-section-header">
                            <h4>Built-in Patterns</h4>
                        </div>
                        <div class="vecttauri-tcm-patterns-grid" id="VectTauri_tcm_builtin_patterns">
                            ${renderBuiltinPatterns(settings)}
                        </div>
                    </div>

                    <!-- Custom Patterns -->
                    <div class="vecttauri-tcm-section">
                        <div class="vecttauri-tcm-section-header">
                            <h4>Custom Patterns</h4>
                            <div class="vecttauri-tcm-actions">
                                <button class="vecttauri-btn-sm vecttauri-btn-secondary" id="VectTauri_tcm_add_pattern">
                                    <i class="fa-solid fa-plus"></i> Add
                                </button>
                                <button class="vecttauri-btn-sm vecttauri-btn-secondary" id="VectTauri_tcm_save_template">
                                    <i class="fa-solid fa-bookmark"></i> Save Template
                                </button>
                                <button class="vecttauri-btn-sm vecttauri-btn-secondary" id="VectTauri_tcm_import">
                                    <i class="fa-solid fa-upload"></i> Import
                                </button>
                                <button class="vecttauri-btn-sm vecttauri-btn-secondary" id="VectTauri_tcm_export">
                                    <i class="fa-solid fa-download"></i> Export
                                </button>
                                <input type="file" id="VectTauri_tcm_import_file" accept=".json" hidden>
                            </div>
                        </div>
                        <div class="vecttauri-tcm-custom-list" id="VectTauri_tcm_custom_patterns">
                            ${renderCustomPatterns(settings.customPatterns || [])}
                        </div>
                    </div>

                    <!-- Pattern Tester -->
                    <div class="vecttauri-tcm-section">
                        <div class="vecttauri-tcm-section-header">
                            <h4>Pattern Tester</h4>
                        </div>
                        <div class="vecttauri-tcm-tester">
                            <div class="vecttauri-tcm-tester-row">
                                <input type="text" id="VectTauri_tcm_test_pattern" placeholder="Find regex (e.g. /pattern/gi)" class="vecttauri-input">
                                <input type="text" id="VectTauri_tcm_test_replacement" placeholder="Replace with" class="vecttauri-input">
                                <button class="vecttauri-btn-primary" id="VectTauri_tcm_test_run">
                                    <i class="fa-solid fa-play"></i> Test
                                </button>
                            </div>
                            <textarea id="VectTauri_tcm_test_input" rows="3" placeholder="Sample text to test against..." class="vecttauri-textarea"></textarea>
                            <div class="vecttauri-tcm-test-result" id="VectTauri_tcm_test_result"></div>
                        </div>
                    </div>
                </div>

                <div class="vecttauri-modal-footer">
                    <button class="vecttauri-btn-secondary" id="VectTauri_tcm_cancel">Close</button>
                    <button class="vecttauri-btn-primary" id="VectTauri_tcm_save">
                        <i class="fa-solid fa-save"></i> Save Changes
                    </button>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);
    $('#VectTauri_text_cleaning_modal').fadeIn(200);

    bindEvents();
}

/**
 * Gets preset description
 */
function getPresetDescription(presetId) {
    const descriptions = {
        none: 'No cleaning applied - text vectorized as-is',
        html_formatting: 'Removes font, color, bold/italic tags but keeps text content',
        metadata_blocks: 'Removes hidden divs and details/summary sections',
        ai_reasoning: 'Removes <thinking> and <tucao> AI reasoning tags',
        comprehensive: 'All formatting, metadata, and reasoning tags removed',
        nuclear: 'Strips ALL HTML tags - plain text only',
        custom: 'Uses your selected built-in and custom patterns',
    };
    return descriptions[presetId] || '';
}

/**
 * Renders the built-in patterns grid.
 *
 * The checked set depends on the active preset:
 *   - 'custom' (or none): reflects the user's saved enabledBuiltins, editable.
 *   - a real preset: reflects that preset's patterns and is locked (disabled),
 *     because getActivePatterns() ignores enabledBuiltins unless preset is
 *     'custom'. Showing editable boxes that don't drive cleaning was the
 *     "checkboxes never change" bug.
 *
 * @param {object} settings - cleaning settings (uses selectedPreset + enabledBuiltins)
 * @returns {string} HTML for the grid's inner labels
 */
function renderBuiltinPatterns(settings) {
    const preset = settings.selectedPreset;
    const isCustom = !preset || preset === 'custom';
    const activeIds = isCustom
        ? (settings.enabledBuiltins || [])
        : (CLEANING_PRESETS[preset]?.patterns || []);

    return Object.values(BUILTIN_PATTERNS).map(p => `
        <label class="vecttauri-tcm-pattern-item${isCustom ? '' : ' vecttauri-tcm-pattern-locked'}" title="${StringUtils.escapeHtml(p.pattern)}">
            <input type="checkbox" data-id="${p.id}"
                   ${activeIds.includes(p.id) ? 'checked' : ''}
                   ${isCustom ? '' : 'disabled'}>
            <div class="vecttauri-tcm-pattern-info">
                <span class="vecttauri-tcm-pattern-name">${p.name}</span>
                <code class="vecttauri-tcm-pattern-regex">${StringUtils.escapeHtml(p.pattern.substring(0, 40))}${p.pattern.length > 40 ? '...' : ''}</code>
            </div>
        </label>
    `).join('');
}

/**
 * Renders custom patterns list
 */
function renderCustomPatterns(patterns) {
    if (!patterns || patterns.length === 0) {
        return `<div class="vecttauri-tcm-empty">No custom patterns. Click "Add" or "Import" to create patterns.</div>`;
    }

    return patterns.map(p => {
        // Convert old format (pattern + flags) to /pattern/flags format if needed
        let displayPattern = p.pattern || '';
        if (displayPattern && !displayPattern.startsWith('/') && p.flags) {
            displayPattern = `/${displayPattern}/${p.flags}`;
        }

        return `
            <div class="vecttauri-tcm-custom-item" data-id="${p.id}">
                <input type="checkbox" class="vecttauri-tcm-custom-enabled" ${p.enabled !== false ? 'checked' : ''} title="Enable/disable">
                <input type="text" class="vecttauri-tcm-custom-name" value="${StringUtils.escapeHtml(p.name)}" placeholder="Name">
                <input type="text" class="vecttauri-tcm-custom-pattern" value="${StringUtils.escapeHtml(displayPattern)}" placeholder="/pattern/gi">
                <input type="text" class="vecttauri-tcm-custom-replacement" value="${StringUtils.escapeHtml(p.replacement || '')}" placeholder="Replace with (empty = remove)">
                <button class="vecttauri-btn-icon vecttauri-btn-danger" data-action="delete" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Parses a regex string in /pattern/flags format (like ST's native regex)
 * Also accepts plain patterns (assumes 'gi' flags)
 * @param {string} input - Regex string
 * @returns {{pattern: string, flags: string}|null}
 */
function parseRegexString(input) {
    if (!input) return null;

    // Try to parse /pattern/flags format
    const match = input.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
        return { pattern: match[1], flags: match[2] || 'g' };
    }

    // Plain pattern - use default flags
    return { pattern: input, flags: 'gi' };
}

/**
 * Validates a regex pattern
 * @param {string} pattern
 * @param {string} flags
 * @returns {{valid: boolean, error?: string}}
 */
function validateRegex(pattern, flags) {
    try {
        new RegExp(pattern, flags);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

/**
 * Rebinds delete handlers for custom patterns (scoped to modal, not document)
 */
function rebindDeleteHandlers() {
    // Remove old handlers and bind new ones scoped to the modal
    $('#VectTauri_tcm_custom_patterns [data-action="delete"]').off('click').on('click', function() {
        const id = $(this).closest('.vecttauri-tcm-custom-item').data('id');
        removeCustomPattern(id);

        // Refresh the list
        const settings = getCleaningSettings();
        $('#VectTauri_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
        rebindDeleteHandlers();
        saveSettingsDebounced();
    });
}

/**
 * Binds event handlers
 */
function bindEvents() {
    // Stop mousedown propagation (ST closes drawers on mousedown/touchstart)
    $('#VectTauri_text_cleaning_modal').on('mousedown touchstart', function(e) {
        e.stopPropagation();
    });

    // Close handlers
    $('#VectTauri_tcm_close, #VectTauri_tcm_cancel').on('click', closeModal);
    $('#VectTauri_text_cleaning_modal .vecttauri-modal-overlay').on('click', closeModal);

    // Preset change
    $('#VectTauri_tcm_preset').on('change', function() {
        const presetId = $(this).val();
        $('#VectTauri_tcm_preset_desc').text(getPresetDescription(presetId));
        // Re-render the built-in grid so it reflects the selected preset (locked)
        // or the user's saved Custom selection (editable). Use the dropdown's
        // current value, not the saved one — the user hasn't saved yet.
        const settings = getCleaningSettings();
        $('#VectTauri_tcm_builtin_patterns').html(
            renderBuiltinPatterns({ ...settings, selectedPreset: presetId }),
        );
    });

    // Add custom pattern
    $('#VectTauri_tcm_add_pattern').on('click', () => {
        addCustomPattern({
            name: 'New Pattern',
            pattern: '',
            replacement: '',
            flags: 'gi',
        });

        // Refresh the list
        const settings = getCleaningSettings();
        $('#VectTauri_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
        rebindDeleteHandlers();
        saveSettingsDebounced();
    });

    // Initial bind for delete handlers
    rebindDeleteHandlers();

    // Import patterns
    $('#VectTauri_tcm_import').on('click', () => {
        $('#VectTauri_tcm_import_file').click();
    });

    $('#VectTauri_tcm_import_file').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const result = importPatterns(event.target.result);
            if (result.success) {
                // Check if modal still exists before updating DOM
                if ($('#VectTauri_text_cleaning_modal').length) {
                    const settings = getCleaningSettings();

                    // If template was imported, also update preset and built-in checkboxes
                    if (result.isTemplate) {
                        toastr.success(`Template "${result.templateName}" loaded (${result.count} new patterns)`, 'VectTauri');

                        // Update preset dropdown
                        $('#VectTauri_tcm_preset').val(settings.selectedPreset);
                        $('#VectTauri_tcm_preset_desc').text(getPresetDescription(settings.selectedPreset));

                        // Re-render built-in grid to match the imported preset
                        // (locked) or Custom selection (editable).
                        $('#VectTauri_tcm_builtin_patterns').html(renderBuiltinPatterns(settings));
                    } else {
                        toastr.success(`Imported ${result.count} patterns`, 'VectTauri');
                    }

                    // Surface ReDoS-guard / length-cap skips so the user knows
                    // not every pattern in the file landed (see importPatterns
                    // in core/text-cleaning.js for the skip rules).
                    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
                        for (const w of result.warnings) {
                            toastr.warning(w, 'VectTauri: Pattern skipped', { timeOut: 8000 });
                        }
                    }

                    // Update custom patterns list
                    $('#VectTauri_tcm_custom_patterns').html(renderCustomPatterns(settings.customPatterns));
                    rebindDeleteHandlers();
                }
                saveSettingsDebounced();
            } else {
                toastr.error(`Import failed: ${result.error}`, 'VectTauri');
            }
        };
        reader.readAsText(file);
        $(this).val('');
    });

    // Save as template (prompts for name, saves full config)
    $('#VectTauri_tcm_save_template').on('click', () => {
        const templateName = prompt('Enter a name for this template:', 'My Cleaning Template');
        if (!templateName) return;

        const settings = getCleaningSettings();

        // Gather current UI state. In Custom mode the grid is the source of
        // truth; when a preset is active the grid is locked and mirrors the
        // preset, so preserve the user's saved Custom selection instead.
        const currentPreset = $('#VectTauri_tcm_preset').val();
        let enabledBuiltins;
        if (currentPreset === 'custom') {
            enabledBuiltins = [];
            $('#VectTauri_tcm_builtin_patterns input:checked').each(function() {
                enabledBuiltins.push($(this).data('id'));
            });
        } else {
            enabledBuiltins = settings.enabledBuiltins || [];
        }

        const template = {
            name: templateName,
            version: '1.0',
            createdAt: new Date().toISOString(),
            preset: currentPreset,
            enabledBuiltins: enabledBuiltins,
            customPatterns: settings.customPatterns || [],
        };

        const json = JSON.stringify(template, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vecttauri-template-${templateName.toLowerCase().replace(/\s+/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success(`Template "${templateName}" saved`, 'VectTauri');
    });

    // Export patterns (custom patterns only)
    $('#VectTauri_tcm_export').on('click', () => {
        const json = exportPatterns();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vecttauri-cleaning-patterns.json';
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Patterns exported', 'VectTauri');
    });

    // Test pattern
    $('#VectTauri_tcm_test_run').on('click', () => {
        const rawPattern = $('#VectTauri_tcm_test_pattern').val();
        const replacement = $('#VectTauri_tcm_test_replacement').val();
        const sampleText = $('#VectTauri_tcm_test_input').val();

        if (!rawPattern || !sampleText) {
            toastr.warning('Enter a pattern and sample text');
            return;
        }

        const parsed = parseRegexString(rawPattern);
        if (!parsed) {
            toastr.error('Invalid pattern format');
            return;
        }

        const result = testPattern(parsed.pattern, parsed.flags, replacement, sampleText);
        const resultEl = $('#VectTauri_tcm_test_result');

        if (result.success) {
            resultEl.html(`
                <div class="vecttauri-tcm-test-success">
                    <strong>Result:</strong>
                    <pre>${StringUtils.escapeHtml(result.result)}</pre>
                </div>
            `);
        } else {
            resultEl.html(`
                <div class="vecttauri-tcm-test-error">
                    <i class="fa-solid fa-times-circle"></i> ${StringUtils.escapeHtml(result.error)}
                </div>
            `);
        }
    });

    // Save changes
    $('#VectTauri_tcm_save').on('click', () => {
        const settings = getCleaningSettings();

        // Get selected preset
        settings.selectedPreset = $('#VectTauri_tcm_preset').val();

        // Only sync enabledBuiltins from the grid in Custom mode. When a preset
        // is active the grid is locked and merely mirrors the preset, so writing
        // it back would clobber the user's saved Custom selection (disabled
        // checkboxes still report :checked).
        if (settings.selectedPreset === 'custom') {
            settings.enabledBuiltins = [];
            $('#VectTauri_tcm_builtin_patterns input:checked').each(function() {
                settings.enabledBuiltins.push($(this).data('id'));
            });
        }

        // Validate and get custom pattern updates
        let hasInvalidPattern = false;
        $('#VectTauri_tcm_custom_patterns .vecttauri-tcm-custom-item').each(function() {
            const id = $(this).data('id');
            const rawPattern = $(this).find('.vecttauri-tcm-custom-pattern').val();
            const enabled = $(this).find('.vecttauri-tcm-custom-enabled').is(':checked');

            // Parse /pattern/flags format
            const parsed = parseRegexString(rawPattern);

            // Validate regex if pattern is enabled and has content
            if (enabled && parsed) {
                const validation = validateRegex(parsed.pattern, parsed.flags);
                if (!validation.valid) {
                    hasInvalidPattern = true;
                    $(this).find('.vecttauri-tcm-custom-pattern').css('border-color', 'var(--vecttauri-danger)');
                    toastr.error(`Invalid regex: ${validation.error}`, 'VectTauri');
                    return false; // break out of .each()
                }
            }

            // Reset border
            $(this).find('.vecttauri-tcm-custom-pattern').css('border-color', '');

            const update = {
                enabled: enabled,
                name: $(this).find('.vecttauri-tcm-custom-name').val(),
                pattern: parsed?.pattern || '',
                replacement: $(this).find('.vecttauri-tcm-custom-replacement').val(),
                flags: parsed?.flags || 'gi',
            };
            updateCustomPattern(id, update);
        });

        if (hasInvalidPattern) {
            return; // Don't save if there's an invalid pattern
        }

        saveCleaningSettings(settings);
        saveSettingsDebounced();

        toastr.success('Text cleaning settings saved', 'VectTauri');
        closeModal();
    });
}

/**
 * Closes the modal
 */
function closeModal() {
    $('#VectTauri_text_cleaning_modal').fadeOut(200, function() {
        $(this).remove();
    });
}
