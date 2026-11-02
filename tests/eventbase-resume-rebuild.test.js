/**
 * eventbase-resume-rebuild.test.js — Resume must continue from the COLLECTION
 * when the local window-fingerprint cache was lost (reload / settings not
 * flushed). Before the fix, Resume had no record of progress and restarted from
 * message 1 even though the collection was full of chunks.
 *
 * Isolation: eventbase-store.js transitively imports ST modules that don't
 * resolve under vitest. Same empty-stub approach as eventbase-write-target.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const UUID = 'cccccccc-3333-4333-8333-cccccccccccc';
const COL = `vf_eventbase_standard_hero_${UUID}`;

vi.mock('../../../../../script.js', () => ({
    saveSettingsDebounced: vi.fn(),
    getRequestHeaders: vi.fn(() => ({})),
    getCurrentChatId: vi.fn(() => 'chat-c.jsonl'),
}));
vi.mock('../../../../extensions.js', () => ({
    extension_settings: { vecttauri: {} },
    getContext: vi.fn(() => ({ chat: [] })),
}));
vi.mock('../core/core-vector-api.js', () => ({
    insertVectorItems: vi.fn(), queryCollection: vi.fn(), deleteVectorItems: vi.fn(),
    getAdditionalArgs: vi.fn(), getSavedHashes: vi.fn(),
}));
vi.mock('../core/collection-ids.js', () => ({
    getChatUUID: vi.fn(() => UUID),
    buildEventBaseCollectionId: vi.fn(),
    getRegistryBackend: vi.fn(() => 'vectra'),
    COLLECTION_PREFIXES: { VECTTAURI_EVENTBASE: 'vf_eventbase_' },
    parseRegistryKey: vi.fn(),
}));
vi.mock('../core/collection-loader.js', () => ({
    registerCollection: vi.fn(),
    getCollectionRegistry: vi.fn(() => []),
    getCollectionListing: vi.fn(() => []),
}));
vi.mock('../core/collection-metadata.js', () => ({
    getChatLockedCollections: vi.fn(() => []),
    isCollectionActiveForContextAnyKey: vi.fn(() => false),
}));
vi.mock('../core/eventbase-schema.js', () => ({ buildEmbedText: vi.fn() }));
vi.mock('../core/log.js', () => ({
    log: {
        lifecycle: vi.fn(), verbose: vi.fn(), trace: vi.fn(),
        warn: vi.fn(), error: vi.fn(), enabled: () => false,
    },
}));
vi.mock('../backends/backend-manager.js', () => ({
    getBackend: vi.fn(async () => ({
        listChunks: vi.fn(async () => ({
            items: [
                { hash: '1', metadata: { source_message_hashes: [111, 222], source_window_end: 1 } },
                { hash: '2', metadata: { source_message_hashes: [333, 444], source_window_end: 3 } },
                // Same window as chunk 1 → same fingerprint, must dedupe to one entry.
                { hash: '3', metadata: { source_message_hashes: [111, 222], source_window_end: 1 } },
                // No hashes → cannot be attributed to a window, must be ignored.
                { hash: '4', metadata: {} },
            ],
        })),
    })),
}));

const { rebuildWindowCacheFromCollection, hasWindowCacheForChat, isWindowAlreadyExtracted } =
    await import('../core/eventbase-store.js');

describe('resume rebuild from collection', () => {
    it('marks windows from each chunk\'s source_message_hashes', async () => {
        const marked = await rebuildWindowCacheFromCollection(COL, {}, UUID);
        // Three chunks carry hashes (one is a duplicate window) → three mark calls.
        expect(marked).toBe(3);

        // The two distinct windows are now recognizable as already extracted.
        expect(await isWindowAlreadyExtracted([111, 222], null, {}, UUID)).toBe(true);
        expect(await isWindowAlreadyExtracted([222, 111], null, {}, UUID)).toBe(true); // order-independent
        expect(await isWindowAlreadyExtracted([333, 444], null, {}, UUID)).toBe(true);
        // A window that never had events stays unmarked → it will be re-extracted.
        expect(await isWindowAlreadyExtracted([555, 666], null, {}, UUID)).toBe(false);

        expect(hasWindowCacheForChat(UUID)).toBe(true);
    });

    it('reports no cache before any rebuild', async () => {
        // A chat with no stored windows has nothing to resume from.
        expect(hasWindowCacheForChat('dddddddd-4444-4444-8444-dddddddddddd')).toBe(false);
    });
});