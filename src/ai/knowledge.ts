import { knowledgeStore } from './knowledge-store.js';
import { KnowledgeIngestionWorker } from './knowledge-worker.js';
import { retrieveFromChunks, type KnowledgeRetrievalResult, type RetrievalChunk } from './knowledge-retrieval.js';

let cachedKnowledgeBase = '';
let cachedChunks: RetrievalChunk[] = [];
let isLoaded = false;

export const refreshKnowledgeCache = async () => {
    [cachedChunks, cachedKnowledgeBase] = await Promise.all([knowledgeStore.getActiveChunks(), knowledgeStore.getActiveKnowledgeBase()]);
    isLoaded = true;
};

export const knowledgeWorker = new KnowledgeIngestionWorker({ onActivated: refreshKnowledgeCache });

export const loadKnowledgeBase = async (reason = 'reload') => {
    const queued = await knowledgeWorker.enqueue(reason);
    knowledgeWorker.wake();
    const completed = await knowledgeWorker.waitFor(queued.id);
    if (completed.status !== 'succeeded') throw new Error(completed.last_error || 'Ingestion knowledge gagal.');
    await refreshKnowledgeCache();
    return completed;
};

export const initializeKnowledgeBase = async () => {
    await refreshKnowledgeCache();
    if (!cachedChunks.length) await loadKnowledgeBase('startup');
    knowledgeWorker.wake();
};

export const getKnowledgeBase = (): string => {
    if (!isLoaded) console.warn('Knowledge base belum selesai dimuat.');
    return cachedKnowledgeBase;
};

export const retrieveKnowledge = (query: string, options: { maxChars?: number; limit?: number } = {}): KnowledgeRetrievalResult =>
    retrieveFromChunks(cachedChunks, query, options);

export const stopKnowledgeWorker = () => knowledgeWorker.stop();
