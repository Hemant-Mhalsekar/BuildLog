export function parseApiResponseBody<T>(
  url: string,
  status: number,
  ok: boolean,
  contentType: string,
  rawText: string
): T {
  let parsed: (T & { error?: string }) | null = null;
  const trimmed = rawText.trim();

  if (trimmed.length > 0) {
    try {
      parsed = JSON.parse(trimmed) as T & { error?: string };
    } catch {
      parsed = null;
    }
  }

  if (!ok) {
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error) {
      throw new Error(parsed.error);
    }
    throw new Error(`Request failed with status ${status}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    const looksLikeHtml =
      contentType.toLowerCase().includes('text/html') ||
      trimmed.startsWith('<!') ||
      trimmed.toLowerCase().startsWith('<html');

    if (looksLikeHtml) {
      throw new Error(
        `Server returned HTML instead of JSON from ${url} (HTTP ${status}). Make sure the BuildLog Node server (server.ts) is running and handling /api/* routes on this URL.`
      );
    }

    throw new Error(
      `Server returned an invalid or empty response from ${url} (HTTP ${status}).`
    );
  }

  return parsed;
}
