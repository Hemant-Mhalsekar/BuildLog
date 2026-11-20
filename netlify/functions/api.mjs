// Netlify Function entry for the BuildLog API (/api/*).
// The real handler lives in netlify/server/handler.ts and is pre-bundled into
// netlify/.build/server.mjs by `npm run build:functions` (run as part of the Netlify build).
import handler from '../.build/server.mjs';

export default handler;

export const config = {
  path: '/api/*',
};
