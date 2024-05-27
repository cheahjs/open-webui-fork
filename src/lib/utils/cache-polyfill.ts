// Adapted from https://github.com/jimmywarting/cache-polyfill/blob/bda23f4937afbb6efe2d7fccb9d359b2abda9112/src/cache.js
// MIT License
//
// Copyright (c) 2018 Jimmy Wärting
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const map = new WeakMap<Cache, string>();
const wm = (o: Cache): string => map.get(o) as string;

const isReq = (req: unknown): req is Request => req !== undefined && req instanceof Request;

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve) => {
		// Open (or create) the database
		const open = indexedDB.open('cachestorage', 4);
		// Create the schema
		open.onupgradeneeded = () => {
			const db = open.result;
			// contains all storage containers
			db.createObjectStore('storages', { keyPath: 'cacheName' });
			// contains all cache of request and responses
			const cacheStore = db.createObjectStore('caches', { autoIncrement: true });
			cacheStore.createIndex('cacheName', 'cacheName', { unique: false });
		};

		open.onsuccess = () => {
			// Start a new transaction
			resolve(open.result);
		};
	});
}

interface CacheData {
	cacheName: string;
	headers: Array<[string, string]>;
	status: number;
	statusText: string;
	body: ArrayBuffer;
	reqUrl: string;
	resUrl: string;
	reqMethod: string;
}

interface CacheOptions {
	ignoreSearch?: boolean;
	ignoreMethod?: boolean;
	ignoreVary?: boolean;
}

export class Cache {
	constructor(cacheName: string) {
		map.set(this, cacheName);
	}

	/**
	 * Returns a Promise that resolves to the response associated
	 * with the first matching request in the Cache object.
	 */
	async match(request: RequestInfo, options?: CacheOptions): Promise<Response | undefined> {
		return (await this.matchAll(request, options))[0];
	}

	// Returns a Promise that resolves to an array
	// of all matching requests in the Cache object.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async matchAll(request?: RequestInfo, options: CacheOptions = {}): Promise<Response[]> {
		const req = request ? new Request(request) : undefined;
		if (req && req.method === 'HEAD') return [];

		const cacheName = wm(this);
		const db = await openDB();
		const result: Response[] = [];

		// Start a new transaction
		const tx = db.transaction('caches', 'readonly');
		const caches = tx.objectStore('caches');
		const index = caches.index('cacheName');
		const requestCursor = index.openCursor(IDBKeyRange.only(cacheName));

		requestCursor.onsuccess = (event: Event): void => {
			const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

			if (cursor) {
				if (req && (req.url || req) === cursor.value.reqUrl) {
					const initData = Object.assign(
						{
							url: cursor.value.resUrl
						},
						cursor.value
					);

					const res = new Response(cursor.value.body, initData);
					result.push(res);
				}
				cursor.continue();
			}
		};

		return new Promise<Response[]>((resolve) => (tx.oncomplete = () => resolve(result)));
	}

	// Takes a URL, retrieves it and adds the resulting response
	// object to the given cache. This is functionally equivalent
	// to calling fetch(), then using put() to add the results to the cache
	async add(request: RequestInfo): Promise<void> {
		return this.addAll([request]);
	}

	// Takes an array of URLs, retrieves them, and adds the
	// resulting response objects to the given cache.
	async addAll(requests: RequestInfo[]): Promise<void> {
		const results: Promise<[Request, Response]>[] = [];

		for (const req of requests) {
			const request = new Request(req);

			if (!/^((http|https):\/\/)/.test(request.url)) {
				throw new TypeError(`Add/AddAll does not support schemes other than "http" or "https"`);
			}

			if (request.method !== 'GET') {
				throw new TypeError(`Add/AddAll only supports the GET request method`);
			}

			const clone = request.clone();

			results.push(
				fetch(clone).then((res) => {
					if (res.status === 206) {
						throw new TypeError('Partial response (status code 206) is unsupported');
					}

					if (!res.ok) {
						throw new TypeError('Request failed');
					}

					return [request, res];
				})
			);
		}

		await Promise.all(results.map((promise) => promise.then((a) => this.put(...a))));
	}

	/**
	 * Takes both a request and its response and adds it to the given cache.
	 */
	async put(req: RequestInfo, res: Response): Promise<void> {
		const request = isReq(req) ? req : new Request(req);

		await this.delete(request);

		if (!/^((http|https):\/\/)/.test(request.url)) {
			throw new TypeError(`Request scheme '${request.url.split(':')[0]}' is unsupported`);
		}

		if (request.method !== 'GET') {
			throw new TypeError(`Request method '${request.method}' is unsupported`);
		}

		if (res.status === 206) {
			throw new TypeError('Partial response (status code 206) is unsupported');
		}

		const varyHeaders = res.headers.get('Vary');

		if (varyHeaders && varyHeaders.includes('*')) {
			throw new TypeError('Vary header contains *');
		}

		if (res.body != null && res.bodyUsed) {
			throw new TypeError('Response body is already used');
		}

		const folder = wm(this);
		const cache: CacheData = {
			cacheName: folder,
			headers: [...res.headers],
			status: res.status,
			statusText: res.statusText,
			body: await res.arrayBuffer(),
			reqUrl: request.url.replace(/#.*$/, ''),
			resUrl: res.url.replace(/#.*$/, ''),
			reqMethod: request.method
		};

		const db = await openDB();

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('caches', 'readwrite');
			const store = tx.objectStore('caches');

			// Add some data
			store.put(cache);

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	// Finds the Cache entry whose key is the request, and if found,
	// deletes the Cache entry and returns a Promise that resolves to true.
	// If no Cache entry is found, it returns false.
	async delete(request: RequestInfo, options: CacheOptions = {}): Promise<boolean> {
		const cacheName = wm(this);

		const { ignoreMethod } = options;
		const r = isReq(request) ? request : new Request(request);

		if (!['GET', 'HEAD'].includes(r.method) && ignoreMethod) {
			return false;
		}

		const { method } = r;
		const url = r.url.replace(/#.*$/, '');
		const db = await openDB();

		// Start a new transaction
		const tx = db.transaction('caches', 'readwrite');
		const caches = tx.objectStore('caches');
		const index = caches.index('cacheName');
		const query = index.openCursor(IDBKeyRange.only(cacheName));

		let deleted = false;

		query.onsuccess = (event: Event): void => {
			const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

			if (cursor) {
				if (url === cursor.value.reqUrl && (ignoreMethod || method === cursor.value.reqMethod)) {
					deleted = true;
					caches.delete(cursor.primaryKey);
				}
				cursor.continue();
			}
		};

		return new Promise((resolve) => (tx.oncomplete = () => resolve(deleted)));
	}

	// Returns a Promise that resolves to an array of Cache keys.
	async keys(request?: RequestInfo, options: CacheOptions = {}): Promise<Request[]> {
		let url: string | undefined;
		const folder = wm(this);
		const { ignoreMethod = false, ignoreSearch = false } = options;

		// using new Request to normalize fragment and trailing slash
		if (request !== undefined) {
			const req = new Request(request);

			url = req.url.split('#')[0];

			if (req.method !== 'GET' && !ignoreMethod) return [];
		}

		const search =
			request === undefined
				? (a: CacheData[]) => a
				: (a: CacheData[]) =>
						a.filter((a) => {
							if (ignoreSearch) {
								a = { ...a, reqUrl: a.reqUrl.split('?')[0] };
								url = url?.split('?')[0];
							}
							return url !== undefined && a.reqUrl === url;
						});

		const db = await openDB();

		const responses: CacheData[] = await new Promise((resolve) => {
			const tx = db.transaction('caches', 'readonly');
			const store = tx.objectStore('caches');
			const cacheName = store.index('cacheName');
			const request = cacheName.getAll(IDBKeyRange.only(folder));
			request.onsuccess = () => resolve(request.result);
		});

		return search(responses).map((response) => new Request(response.reqUrl));
	}
}
