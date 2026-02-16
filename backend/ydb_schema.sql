PRAGMA TablePathPrefix("/");

CREATE TABLE users (
  user_id Utf8,
  is_guest Bool,
  coins Int64,
  power Int32,
  auto_income Int32,
  public_coins Int64,
  created_at Timestamp,
  updated_at Timestamp,
  PRIMARY KEY (user_id)
);

CREATE TABLE profiles (
  user_id Utf8,
  name Utf8,
  avatar_url Utf8,
  updated_at Timestamp,
  PRIMARY KEY (user_id)
);

-- Индекс под лидерборд (TOP by public_coins)
CREATE INDEX idx_users_public_coins GLOBAL ON users (public_coins);