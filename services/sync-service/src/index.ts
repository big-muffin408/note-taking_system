import cors from 'cors';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3005);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    service: 'sync-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.get('/pull', (_req, res) => {
  res.json({
    cursor: 'mock-sync-cursor',
    changes: [],
    message: 'No remote changes in mock sync service.'
  });
});

app.post('/push', (req, res) => {
  res.status(202).json({
    accepted: true,
    receivedChanges: Array.isArray(req.body?.changes) ? req.body.changes.length : 0,
    cursor: `mock-cursor-${Date.now()}`
  });
});

app.listen(port, () => {
  console.log(`sync-service listening on ${port}`);
});
