import dotenv from 'dotenv';
import path from 'path';
import { createApp } from './app.js';

import fs from 'fs';

// Load environment from workspace root or current directory
function loadEnv() {
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.resolve(curr, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  dotenv.config();
}
loadEnv();

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const app = createApp();

const server = app.listen(port, () => {
  console.log(`[API] Server running at http://localhost:${port}`);
  console.log(`[API] Health check available at http://localhost:${port}/health`);
  console.log(`[API] Readiness check available at http://localhost:${port}/ready`);
});

// Graceful shutdown handling
const handleShutdown = (signal: string) => {
  console.log(`[API] Received ${signal}, closing HTTP server gracefully...`);
  server.close(() => {
    console.log('[API] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
