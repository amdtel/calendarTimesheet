CREATE TABLE IF NOT EXISTS ct_auth_consumed_nonces (
  nonce text PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);