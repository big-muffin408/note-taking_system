import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? 'localhost',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE ?? 'notes',
  user: process.env.MYSQL_USER ?? 'notes_user',
  password: process.env.MYSQL_PASSWORD ?? 'notes_password',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function ensureUserSchema() {
  const [roleRows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'role'`
  );

  if ((roleRows as unknown[]).length === 0) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN role ENUM('user', 'admin') DEFAULT 'user' AFTER password_hash"
    );
  }

  const [oauthProviderRows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'oauth_provider'`
  );

  if ((oauthProviderRows as unknown[]).length === 0) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN oauth_provider VARCHAR(40) NULL AFTER role'
    );
  }

  const [oauthSubjectRows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'oauth_subject'`
  );

  if ((oauthSubjectRows as unknown[]).length === 0) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN oauth_subject VARCHAR(255) NULL AFTER oauth_provider'
    );
  }

  await pool.query('ALTER TABLE users MODIFY password_hash VARCHAR(255) NULL');

  const [indexRows] = await pool.query(
    "SHOW INDEX FROM users WHERE Key_name = 'idx_users_oauth_provider_subject'"
  );

  if ((indexRows as unknown[]).length === 0) {
    await pool.query(
      'CREATE UNIQUE INDEX idx_users_oauth_provider_subject ON users (oauth_provider, oauth_subject)'
    );
  }
}

export default pool;
