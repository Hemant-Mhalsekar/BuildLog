import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './src/server/app';

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const app = createApp();

  // Vite dev middleware or production static assets
  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `BuildLog server running on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`
    );
  });
}

void startServer();
