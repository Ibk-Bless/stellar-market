-- Create horizon_cursor table for durable cursor persistence
CREATE TABLE horizon_cursor (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create horizon_dlq table for failed event processing
CREATE TABLE horizon_dlq (
  id           SERIAL PRIMARY KEY,
  cursor       TEXT NOT NULL,
  payload      JSONB NOT NULL,
  error        TEXT NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at  TIMESTAMPTZ
);

-- Create index for DLQ query performance
CREATE INDEX idx_horizon_dlq_replayed_at ON horizon_dlq(replayed_at) WHERE replayed_at IS NULL;
CREATE INDEX idx_horizon_dlq_cursor ON horizon_dlq(cursor);
