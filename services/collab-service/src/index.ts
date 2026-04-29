import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

const app = express();
const port = Number(process.env.PORT ?? 3004);
const docs = new Map<string, Y.Doc>();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    service: 'collab-service',
    status: 'ok',
    documents: docs.size,
    timestamp: new Date().toISOString()
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

function getDocumentId(request: IncomingMessage) {
  const url = new URL(request.url ?? '/ws/collab/default', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/collab\/([^/]+)$/);
  return match?.[1] ?? null;
}

server.on('upgrade', (request, socket, head) => {
  const documentId = getDocumentId(request);

  if (!documentId) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit('connection', websocket, request);
  });
});

wss.on('connection', (socket, request) => {
  const documentId = getDocumentId(request) ?? 'default';

  if (!docs.has(documentId)) {
    docs.set(documentId, new Y.Doc());
  }

  socket.send(JSON.stringify({
    type: 'connected',
    documentId,
    message: 'Mock collaboration channel connected. Full Yjs sync will be implemented later.'
  }));

  socket.on('message', (rawMessage) => {
    const message = rawMessage.toString();
    socket.send(JSON.stringify({
      type: 'echo',
      documentId,
      message
    }));
  });
});

server.listen(port, () => {
  console.log(`collab-service listening on ${port}`);
});
