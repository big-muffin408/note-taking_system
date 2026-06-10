import { app } from './app.js';

const port = Number(process.env.PORT ?? 3002);

app.listen(port, () => {
  console.log(`document-service listening on ${port}`);
});
