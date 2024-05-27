import { env, AutoTokenizer, PreTrainedTokenizer } from '@xenova/transformers';
import { Cache } from '$lib/utils/cache-polyfill';
import type { TokenizerWorkerMessage, TokenizerWorkerResponse } from '$lib/workers/tokenizer';
import { dev } from '$app/environment';

env.allowLocalModels = false;
if (!caches || dev) {
	console.log('Using IndexedDB polyfill for tokenizer cache');
	env.useCustomCache = true;
	env.customCache = new Cache('transformers-cache');
}

// This is a map of all the tokenizer instances that we have loaded.
// model_id -> promise that resolves to tokenizer
const TOKENIZER_MAPPINGS: Map<string, Promise<PreTrainedTokenizer>> = new Map();

// Listen for messages from the main thread
self.onmessage = async (event: MessageEvent<TokenizerWorkerMessage>) => {
	let tokenizerPromise = TOKENIZER_MAPPINGS.get(event.data.modelId);
	// Load the tokenizer if it hasn't been loaded yet
	if (!tokenizerPromise) {
		tokenizerPromise = AutoTokenizer.from_pretrained(event.data.modelId);
		TOKENIZER_MAPPINGS.set(event.data.modelId, tokenizerPromise);
	}

	const tokenizer = await tokenizerPromise;
	const text = event.data.text;
	const token_ids = tokenizer.encode(text);

	const response: TokenizerWorkerResponse = {
		modelId: event.data.modelId,
		text: text,
		length: token_ids.length
	};

	// Send the output back to the main thread
	self.postMessage(response);
};

export default {};
