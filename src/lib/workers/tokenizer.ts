export interface TokenizerWorkerMessage {
	modelId: string;
	text: string;
}

export interface TokenizerWorkerResponse {
	modelId: string;
	text: string;
	length: number;
}
