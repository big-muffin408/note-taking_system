import { MongoClient, Db } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = 'notes';

let cachedDb: Db | null = null;
let cachedClient: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const client = new MongoClient(MONGO_URL);
  await client.connect();
  cachedClient = client;
  cachedDb = client.db(DB_NAME);

  console.log('Connected to MongoDB');
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}
