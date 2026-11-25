/**
 * Host-side HTTP helpers for the coal-news plugin.
 *
 * The plugin uses Node's global `fetch` only, so it inherits the Harness
 * outbound proxy policy and needs no dependency of its own.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Normalize a declared charset to one `TextDecoder` accepts. */
export function normalizeEncoding(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === '') return 'utf-8';
  if (value === 'utf8') return 'utf-8';
  if (value === 'gb2312' || value === 'gbk' || value === 'gb18030') return 'gb18030';
  return value;
}

/**
 * Decode a response body using the header charset, then the document meta.
 * @param buffer - raw response bytes.
 * @param contentType - response `content-type` header.
 * @returns decoded text.
 */
export function decodeBody(buffer, contentType = '') {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const headerCharset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const metaCharset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const encoding = normalizeEncoding(headerCharset ?? metaCharset ?? 'utf-8');
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

/** An HTTP status or transport failure that keeps the status code. */
export class HttpError extends Error {
  /**
   * @param message - human readable reason.
   * @param status - HTTP status, or 0 for a transport failure.
   */
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Fetch one page as text with a timeout and caller cancellation.
 * @param url - absolute URL.
 * @param options - abort signal, timeout, extra headers.
 * @returns decoded text plus response facts.
 */
export async function fetchText(url, { signal, timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new HttpError(`超时（${timeoutMs}ms）`, 0)), timeoutMs);
  const forwardAbort = () => controller.abort(signal.reason);
  if (signal !== undefined) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5',
        ...headers,
      },
    });
    if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      bytes: buffer.length,
      text: decodeBody(buffer, response.headers.get('content-type') ?? ''),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
