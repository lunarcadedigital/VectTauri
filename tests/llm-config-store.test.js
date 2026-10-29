/**
 * LLM config mirror store tests (utils/llm-config-store.js).
 *
 * The mirror exists because ST's debounced settings save can starve on mobile
 * (fill config → hit Vectorize → "model is not set"). These tests pin the
 * write-through/read-through contract and the empty-field fallback rules.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../extensions.js', () => ({
    extension_settings: { vecttauri: {} },
}));

import {
    saveLlmConfigFields,
    readLlmConfigField,
    readLlmConfigMirror,
    applyLlmConfigMirrorFallback,
    clearLlmConfigMirror,
    resetLlmConfigMirrorCache,
} from '../utils/llm-config-store.js';

// Node environment — stub a minimal localStorage on globalThis. The store
// probes availability and degrades gracefully; here we give it a real-ish
// Map-backed implementation so write-through/read-back is exercised.
const __ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (__ls.has(k) ? __ls.get(k) : null),
    setItem: (k, v) => __ls.set(k, String(v)),
    removeItem: (k) => __ls.delete(k),
    clear: () => __ls.clear(),
};
const windowStub = { localStorage: globalThis.localStorage };

beforeEach(() => {
    vi.stubGlobal('window', windowStub);
    __ls.clear();
    resetLlmConfigMirrorCache();
});

describe('llm-config-store write-through', () => {
    it('persists saved fields to localStorage synchronously', () => {
        saveLlmConfigFields({ chat_model: 'glm-5.2', chat_provider: 'custom' });

        const raw = JSON.parse(window.localStorage.getItem('vecttauri_llm_config_mirror_v1'));
        expect(raw.chat_model).toBe('glm-5.2');
        expect(raw.chat_provider).toBe('custom');
    });

    it('readLlmConfigField returns the value immediately after save (no reload needed)', () => {
        saveLlmConfigFields({ chat_vllm_url: 'https://api.kryptonlab.id/v1' });
        expect(readLlmConfigField('chat_vllm_url')).toBe('https://api.kryptonlab.id/v1');
    });

    it('survives a cache reset (simulated app restart) — reads back from localStorage', () => {
        saveLlmConfigFields({ chat_model: 'deepseek-v4.1-flash' });
        resetLlmConfigMirrorCache();
        expect(readLlmConfigField('chat_model')).toBe('deepseek-v4.1-flash');
    });

    it('ignores fields outside the mirrored allowlist', () => {
        saveLlmConfigFields({ evil_key: 'x', chat_model: 'ok' });
        expect(readLlmConfigField('evil_key')).toBeUndefined();
        expect(readLlmConfigField('chat_model')).toBe('ok');
    });

    it('handles corrupted localStorage payloads by returning an empty mirror', () => {
        window.localStorage.setItem('vecttauri_llm_config_mirror_v1', '{not json');
        resetLlmConfigMirrorCache();
        expect(readLlmConfigMirror()).toEqual({});
    });

    it('clearLlmConfigMirror wipes both cache and storage', () => {
        saveLlmConfigFields({ chat_model: 'x' });
        clearLlmConfigMirror();
        expect(readLlmConfigField('chat_model')).toBeUndefined();
        expect(window.localStorage.getItem('vecttauri_llm_config_mirror_v1')).toBeNull();
    });
});

describe('applyLlmConfigMirrorFallback', () => {
    it('fills EMPTY base fields from the mirror', () => {
        saveLlmConfigFields({ chat_model: 'glm-5.2', chat_provider: 'custom', chat_vllm_url: 'https://x/v1' });

        const out = applyLlmConfigMirrorFallback({ chat_model: '', chat_provider: undefined, chat_vllm_url: '   ' });
        expect(out.chat_model).toBe('glm-5.2');
        expect(out.chat_provider).toBe('custom');
        expect(out.chat_vllm_url).toBe('https://x/v1');
    });

    it('NEVER overrides non-empty base values (deliberate globals win over a stale mirror)', () => {
        saveLlmConfigFields({ chat_model: 'stale-from-mirror' });

        const out = applyLlmConfigMirrorFallback({ chat_model: 'fresh-global' });
        expect(out.chat_model).toBe('fresh-global');
    });

    it('preserves base falsy values like 0 or false when the field type allows them', () => {
        saveLlmConfigFields({ should_disable_thinking: false });

        const out = applyLlmConfigMirrorFallback({});
        expect(out.should_disable_thinking).toBe(false);
    });

    it('treats whitespace-only strings as empty and fills them', () => {
        saveLlmConfigFields({ chat_model: 'glm-5.2' });

        const out = applyLlmConfigMirrorFallback({ chat_model: '  \n ' });
        expect(out.chat_model).toBe('glm-5.2');
    });

    it('returns a copy — does not mutate the input object', () => {
        saveLlmConfigFields({ chat_model: 'm1' });
        const base = { chat_model: '' };
        applyLlmConfigMirrorFallback(base);
        expect(base.chat_model).toBe('');
    });
});
