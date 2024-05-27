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

interface FallbackTokenizer {
	countTokens: (text: string) => number;
}

// This is a map of all the tokenizer instances that we have loaded.
// model_id -> promise that resolves to tokenizer
const TOKENIZER_MAPPINGS: Map<string, Promise<PreTrainedTokenizer | FallbackTokenizer>> = new Map();

// Listen for messages from the main thread
self.onmessage = async (event: MessageEvent<TokenizerWorkerMessage>) => {
	let tokenizerPromise = TOKENIZER_MAPPINGS.get(event.data.modelId);
	// Load the tokenizer if it hasn't been loaded yet
	if (!tokenizerPromise) {
		if (event.data.modelId == 'fallback') {
			tokenizerPromise = new Promise((resolve) => {
				const tokenizer: FallbackTokenizer = {
					countTokens: (text: string) => text.length / 4
				};
				resolve(tokenizer);
			});
		} else {
			tokenizerPromise = AutoTokenizer.from_pretrained(event.data.modelId);
		}
		TOKENIZER_MAPPINGS.set(event.data.modelId, tokenizerPromise);
	}

	const tokenizer = await tokenizerPromise;
	const text = event.data.text;
	let tokenLength: number;
	if (tokenizer instanceof PreTrainedTokenizer) {
		const token_ids = tokenizer.encode(text);
		tokenLength = token_ids.length;
	} else {
		tokenLength = tokenizer.countTokens(text);
	}

	const response: TokenizerWorkerResponse = {
		modelId: event.data.modelId,
		text: text,
		length: tokenLength
	};

	// Send the output back to the main thread
	self.postMessage(response);
};

export default {};
