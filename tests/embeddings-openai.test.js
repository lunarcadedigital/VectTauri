import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../core/log.js', () => ({
    log: { lifecycle: vi.fn(), verbose: vi.fn(), trace: vi.fn(), warn: vi.fn(), error: vi.fn(), enabled: () => false },
}));

import {
    resolveOpenAiCompatibleBaseUrl,
    getOpenAiCompatibleApiKey,
    createOpenAiCompatibleEmbeddings,
    isEmbeddingModelEntry,
    listOpenAiCompatibleEmbeddingModels,
    ELECTRON_HUB_BASE_URL,
} from '../core/embeddings-openai.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('resolveOpenAiCompatibleBaseUrl', () => {
    it('returns Electron Hub fixed root regardless of settings', () => {
        expect(resolveOpenAiCompatibleBaseUrl({
            embedding_provider: 'electronhub',
            embedding_custom_url: 'https://ignored.example/v1',
        })).toBe(ELECTRON_HUB_BASE_URL);
    });

    it('lets Electron Hub be overridden to a proxy/self-hosted endpoint', () => {
        expect(resolveOpenAiCompatibleBaseUrl({
            embedding_provider: 'electronhub',
            embedding_electronhub_url: 'https://proxy.example/v1/embeddings/',
        })).toBe('https://proxy.example/v1');
    });

    it('accepts a bare, /v1, and /v1/embeddings URL', () => {
        const base = { embedding_provider: 'custom' };
        expect(resolveOpenAiCompatibleBaseUrl({ ...base, embedding_custom_url: 'https://x.example' }))
            .toBe('https://x.example');
        expect(resolveOpenAiCompatibleBaseUrl({ ...base, embedding_custom_url: 'https://x.example/v1' }))
            .toBe('https://x.example/v1');
        expect(resolveOpenAiCompatibleBaseUrl({ ...base, embedding_custom_url: 'https://x.example/v1/embeddings/' }))
            .toBe('https://x.example/v1');
    });

    it('returns empty string when custom URL is unset', () => {
        expect(resolveOpenAiCompatibleBaseUrl({ embedding_provider: 'custom' })).toBe('');
    });
});

describe('getOpenAiCompatibleApiKey', () => {
    it('reads the per-provider settings field', () => {
        expect(getOpenAiCompatibleApiKey({ embedding_provider: 'electronhub', embedding_electronhub_api_key: 'ek-1' }))
            .toBe('ek-1');
        expect(getOpenAiCompatibleApiKey({ embedding_provider: 'custom', embedding_custom_api_key: ' c-2 ' }))
            .toBe('c-2');
    });
});

describe('isEmbeddingModelEntry', () => {
    it('keeps chat models OUT even when a plain listing has no modality info', () => {
        // Electron Hub's real schema: chat model has no `endpoints` and no
        // "embed" in its id — must NOT leak into the embedding picker.
        expect(isEmbeddingModelEntry({ id: 'gpt-4o', name: 'GPT-4o' })).toBe(false);
        expect(isEmbeddingModelEntry({ id: 'claude-3-5-sonnet-20241022' })).toBe(false);
    });

    it('recognizes embedding models via their endpoints list', () => {
        expect(isEmbeddingModelEntry({
            id: 'text-embedding-3-small',
            endpoints: ['/v1/embeddings'],
        })).toBe(true);
    });

    it('rejects an entry whose endpoints list only chat completions', () => {
        expect(isEmbeddingModelEntry({
            id: 'gpt-4o',
            endpoints: ['/v1/chat/completions'],
        })).toBe(false);
    });

    it('falls back to the id naming convention when no endpoints/modalities exist', () => {
        expect(isEmbeddingModelEntry({ id: 'bge-m3-embed' })).toBe(true);
    });
});

describe('listOpenAiCompatibleEmbeddingModels', () => {
    it('issues the embeddings filter first and returns only embedding ids sorted', async () => {
        const fetchMock = vi.fn(async (url) => ({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'z-embed', endpoints: ['/v1/embeddings'] },
                    { id: 'a-embed', name: 'A Embed' },
                    { id: 'gpt-4o', endpoints: ['/v1/chat/completions'] },
                ],
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const ids = await listOpenAiCompatibleEmbeddingModels('https://x.example/v1', 'k');
        expect(ids).toEqual(['a-embed', 'z-embed']);
        expect(String(fetchMock.mock.calls[0][0])).toContain('output_modalities=embeddings');
    });

    it('returns [] instead of throwing when the endpoint is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        await expect(listOpenAiCompatibleEmbeddingModels('https://x.example/v1', 'k'))
            .resolves.toEqual([]);
    });
});

describe('createOpenAiCompatibleEmbeddings', () => {
    const settings = {
        embedding_provider: 'electronhub',
        embedding_electronhub_model: 'text-embedding-3-small',
        embedding_electronhub_api_key: 'ek-test',
    };

    it('posts to <base>/embeddings and maps vectors back by input text', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                data: [
                    { index: 1, embedding: [0.2, 0.2] },
                    { index: 0, embedding: [0.1, 0.1] },
                ],
            }),
        }));
        vi.stubGlobal('fetch', fetchMock);

        const out = await createOpenAiCompatibleEmbeddings(['a', 'b'], settings);

        // out-of-order index must be sorted, not trusted positionally
        expect(out).toEqual({ a: [0.1, 0.1], b: [0.2, 0.2] });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${ELECTRON_HUB_BASE_URL}/embeddings`);
        expect(init.headers.Authorization).toBe('Bearer ek-test');
        expect(JSON.parse(init.body)).toMatchObject({
            input: ['a', 'b'],
            model: 'text-embedding-3-small',
        });
    });

    it('fails loudly instead of returning silently-empty vectors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
        })));

        await expect(createOpenAiCompatibleEmbeddings(['a', 'b'], settings))
            .rejects.toThrow(/1 vector\(s\) for 2 input\(s\)/);
    });

    it('refuses to run without a key', async () => {
        await expect(createOpenAiCompatibleEmbeddings(['a'], {
            embedding_provider: 'custom',
            embedding_custom_url: 'https://x.example/v1',
            embedding_custom_model: 'm',
        })).rejects.toThrow(/API key is not set/);
    });
});