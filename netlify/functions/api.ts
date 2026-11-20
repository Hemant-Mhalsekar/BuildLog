import serverless from 'serverless-http';
import { connectLambda } from '@netlify/blobs';
import { createApp } from '../../src/server/app';

/**
 * Runs the existing Express server (src/server/app.ts) as a Netlify Function.
 * netlify.toml rewrites /api/* to this function.
 */
const handle = serverless(createApp());

export const handler = async (event: any, context: any) => {
  // Lambda-compatible functions must wire up the Netlify Blobs context explicitly.
  connectLambda(event);

  // Make sure production deploys use the production blob store
  // (set BUILDLOG_CONTEXT=production in Netlify env vars for the Production context).
  process.env.CONTEXT ||= process.env.BUILDLOG_CONTEXT;

  // Express routes are mounted at /api/*; normalise the function path if Netlify passes it through.
  if (typeof event.path === 'string' && event.path.startsWith('/.netlify/functions/api')) {
    event.path = event.path.replace('/.netlify/functions/api', '/api');
  }

  return handle(event, context);
};
