import { ensureUserSchema } from './db.js';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3001);

await ensureUserSchema();

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});
