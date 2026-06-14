import { createApp } from './app';

const PORT = parseInt(process.env.PORT || '4000');

async function main() {
  const app = await createApp();

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║  🚌 ZUUP — Demand-Aware Bus Platform         ║
║  HTTP API:   http://localhost:${PORT}           ║
║  WebSocket:  ws://localhost:4001              ║
║  Dashboard:  http://localhost:5173            ║
╚══════════════════════════════════════════════╝
  `);
  });
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
