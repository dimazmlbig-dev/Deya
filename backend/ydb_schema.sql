PRAGMA TablePathPrefix("/");

CREATE TABLE users (
  user_id Utf8,
  is_guest Bool,
  coins Int64,
  power Int32,
  auto_income Int32,
  energy Int32,
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

-- Optional secondary index for leaderboard-heavy workloads
ALTER TABLE users ADD INDEX idx_public_coins GLOBAL ON (public_coins);
