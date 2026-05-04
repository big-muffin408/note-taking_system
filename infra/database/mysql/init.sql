CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  oauth_provider VARCHAR(40) NULL,
  oauth_subject VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_users_oauth_provider_subject (oauth_provider, oauth_subject)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
