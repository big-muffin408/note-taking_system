import cors from 'cors';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    service: 'user-service',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/register', (req, res) => {
  const email = req.body?.email ?? 'demo@example.com';
  res.status(201).json({
    id: 'mock-user-001',
    email,
    displayName: req.body?.displayName ?? 'Demo User',
    message: 'Mock registration accepted. Real password hashing is planned for a later iteration.'
  });
});

app.post('/login', (req, res) => {
  res.json({
    token: 'mock-jwt-token',
    user: {
      id: 'mock-user-001',
      email: req.body?.email ?? 'demo@example.com',
      displayName: 'Demo User'
    }
  });
});

app.get('/me', (_req, res) => {
  res.json({
    id: 'mock-user-001',
    email: 'demo@example.com',
    displayName: 'Demo User',
    role: 'user'
  });
});

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});
