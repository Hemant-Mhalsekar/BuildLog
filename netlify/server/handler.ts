import serverless from 'serverless-http';
import type { Context } from '@netlify/functions';
import { createApp } from '../../src/server/app';

/**
 * Runs the existing Express server (src/server/app.ts) as a Netlify Function (v2 format).
 *
 * This file is NOT deployed directly. `npm run build:functions` bundles it (with all
 * dependencies) into netlify/.build/server.mjs, which netlify/functions/api.mjs re-exports.
 * Bundling avoids loading dependencies from node_modules at runtime, where some ESM-only
 * packages (e.g. `jose`, required by firebase-admin -> jwks-rsa) crash on Node 18.
 *
 * The v2 format is required because Netlify only injects the full Netlify Blobs context
 * (including `uncachedEdgeURL`, needed for strong-consistency reads) into v2 functions.
 * Express still expects a Node request, so the web Request is translated into an
 * API Gateway-style event for serverless-http, and the result back into a Response.
 */
const handle = serverless(createApp(), { binary: true });

export default async (request: Request, context: Context): Promise<Response> => {
  // Production deploys use the production blob store; previews stay deploy-scoped.
  process.env.CONTEXT ||= context?.deploy?.context || process.env.BUILDLOG_CONTEXT || '';

  const url = new URL(request.url);
  const multiValueHeaders: Record<string, string[]> = {};
  request.headers.forEach((value, key) => {
    (multiValueHeaders[key] ||= []).push(value);
  });
  const multiValueQueryStringParameters: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => {
    (multiValueQueryStringParameters[key] ||= []).push(value);
  });

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const bodyBuffer = hasBody ? Buffer.from(await request.arrayBuffer()) : null;

  const event = {
    httpMethod: request.method,
    path: url.pathname,
    multiValueHeaders,
    multiValueQueryStringParameters,
    // Raw bytes are passed through untouched (base64) so GitHub webhook HMAC checks still match.
    body: bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer.toString('base64') : null,
    isBase64Encoded: true,
    requestContext: {
      identity: { sourceIp: context?.ip ?? request.headers.get('x-nf-client-connection-ip') ?? '' },
    },
  };

  const result = (await handle(event, {})) as {
    statusCode: number;
    headers?: Record<string, string | number | boolean>;
    multiValueHeaders?: Record<string, Array<string | number | boolean>>;
    body?: string;
    isBase64Encoded?: boolean;
  };

  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    headers.set(key, String(value));
  }
  for (const [key, values] of Object.entries(result.multiValueHeaders ?? {})) {
    headers.delete(key);
    for (const value of values) headers.append(key, String(value));
  }

  const body = result.body
    ? Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8')
    : null;
  const noBody = result.statusCode === 204 || result.statusCode === 304;
  return new Response(noBody ? null : body, { status: result.statusCode, headers });
};
