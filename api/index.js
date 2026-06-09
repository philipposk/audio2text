// Vercel serverless entry — wraps the Express app as a single catch-all function.
// WebSockets, ffmpeg, and youtube-dl are disabled in this context.
import { createApp } from '../server/index.js';

let app;

export default async function handler(req, res) {
  if (!app) {
    app = createApp({ withWebsocket: false });
  }
  return app(req, res);
}
