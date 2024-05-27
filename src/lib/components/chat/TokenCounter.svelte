<script lang="ts">
	import TokenizerWorker from '$lib/workers/tokenizer.worker?worker';
	import type { TokenizerWorkerResponse } from '$lib/workers/tokenizer';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	const i18n: Writable<i18nType> = getContext('i18n');

	const DEBOUNCE_TIMEOUT_MS = 500;

	export let tokenCount = 0;
	export let tokenLimit = 0;
	export let text = '';
	export let modelId = '';

	export let loading = false;
	export let className = '';

	let worker = new TokenizerWorker();
	let debounceTimer: ReturnType<typeof setTimeout>;

	$: {
		loading = true;
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		// Debounce the worker call
		debounceTimer = setTimeout(() => {
			worker.postMessage({
				modelId,
				text
			});
		}, DEBOUNCE_TIMEOUT_MS);
	}

	worker.onmessage = (event: MessageEvent<TokenizerWorkerResponse>) => {
		tokenCount = event.data.length;
		if (event.data.text == text) {
			loading = false;
		}
	};
</script>

<div class="flex items-center text-nowrap {className}">
	<Tooltip
		content={`${$i18n.t('Estimated token usage')}<br>
						${$i18n.t('Tokenizer: {{modelId}}', {
							modelId
						})}
						${
							tokenLimit > 0
								? `<br>${$i18n.t('Token limit: {{tokenLimit}}', {
										tokenLimit: tokenLimit.toLocaleString()
								  })}`
								: ''
						}`}
	>
		{#if tokenLimit > 0 && tokenCount > tokenLimit}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="1.5"
				stroke="currentColor"
				class="size-4 accent-yellow-400"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
				/>
			</svg>
		{/if}
		<span class={loading ? 'text-gray-600' : 'text-gray-300'}>{tokenCount.toLocaleString()}</span>
	</Tooltip>
</div>
