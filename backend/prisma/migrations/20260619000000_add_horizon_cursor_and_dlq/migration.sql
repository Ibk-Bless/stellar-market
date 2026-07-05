CREATE TABLE "horizon_cursor" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cursor" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMPTZ,

    CONSTRAINT "horizon_cursor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "horizon_cursor_singleton" CHECK ("id" = 1)
);

CREATE TABLE "horizon_dlq" (
    "id" SERIAL NOT NULL,
    "cursor" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayed_at" TIMESTAMPTZ,

    CONSTRAINT "horizon_dlq_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "horizon_dlq_replayed_at_cursor_idx"
ON "horizon_dlq"("replayed_at", "cursor");

INSERT INTO "horizon_cursor" ("id", "cursor")
VALUES (1, '0')
ON CONFLICT ("id") DO NOTHING;
