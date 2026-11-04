/**
 * ============================================================================
 * CONNECTION TESTS (Core tab)
 * ============================================================================
 * Buttons in the Core tab that answer "is my configured endpoint actually
 * reachable right now?" without running a full vectorization:
 *
 *  - testEmbeddingConnection() — runs ONE real embedding through the exact
 *    production insert path (so provider, model, apiUrl and the on-device path
 *    are all exercised), then purges the throwaway collection. There is no
 *    standalone get-embedding route in builtin mode (the shim returns 501), so
 *    the vector insert path is the only honest test.
 *
 *  - testLlmConnection() — sends a tiny chat completion through the same proxy
 *    the summarizer / EventBase use, so auth, base URL, model and request shape
 *    (reasoning-model flags) are all validated.
 *
 * Both return { ok, message } and never throw — the UI shows the message in a
 * toast, so a failure is actionable instead of a console-only stack trace.
 * ============================================================================
 */

import { insertVectorItems, purgeVectorIndex } from './core-vector-api.js';
import { postChatCompletion, resolveModelParameterStyle } from './llm-provider-call.js';

const EMBED_TIMEOUT_MS = 60000;
const LLM_TIMEOUT_MS = 30000;

/**
 * Test the configured embedding provider by embedding one short text through a
 * temporary collection.
 *
 * @param {object} settings
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function testEmbeddingConnection(settings) {
    const source = settings?.embedding_provider || 'transformers';
    const collectionId = `vf_test_embed_${Date.now()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    try {
        await insertVectorItems(
            collectionId,
            [{ hash: 1, text: 'VectTauri embedding connection test', index: 0 }],
            settings,
            null,
            controller.signal,
        );
        return { ok: true, message: `Embedding OK — "${source}" responded and the vector was stored.` };
    } catch (e) {
        const message = controller.signal.aborted
            ? `Embedding timed out after ${EMBED_TIMEOUT_MS / 1000}s — is the endpoint running and reachable?`
            : (e?.message || String(e));
        return { ok: false, message };
    } finally {
        clearTimeout(timer);
        // Best-effort cleanup of the throwaway collection.
        try { await purgeVectorIndex(collectionId, settings); } catch { /* ignore */ }
    }
}

/**
 * Test the configured summarization / EventBase LLM with a tiny completion.
 *
 * @param {object} settings
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function testLlmConnection(settings, modelOverride = '') {
    const provider = String(settings?.chat_provider || 'openrouter').toLowerCase();
    const model = String(modelOverride || settings?.chat_model || '').trim();
    if (!model) {
        return { ok: false, message: 'No LLM model is set — pick one first.' };
    }

    const style = resolveModelParameterStyle(settings);

    try {
        const { content } = await postChatCompletion({
            messages: [
                { role: 'system', content: 'This is a connectivity test.' },
                { role: 'user', content: 'Reply with exactly: OK' },
            ],
            model,
            provider: (provider === 'vllm' || provider === 'custom') ? 'vllm' : 'openrouter',
            vllmUrl: settings?.chat_vllm_url || '',
            maxTokens: 16,
            temperature: 0.1,
            timeoutMs: LLM_TIMEOUT_MS,
            contextLabel: 'LLM connection test',
            // The button owns the toast, so don't let the shared call raise a second one.
            shouldNotifyProviderFailure: false,
            sendTemperature: style.sendTemperature,
            tokenLimitParameter: style.tokenLimitParameter,
            reasoningEffort: style.reasoningEffort,
        });
        const preview = String(content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        return { ok: true, message: `LLM OK — ${provider} · ${model}: ${preview || '(empty reply)'}` };
    } catch (e) {
        return { ok: false, message: e?.message || String(e) };
    }
}