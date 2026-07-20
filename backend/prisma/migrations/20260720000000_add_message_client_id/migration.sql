-- Add clientId to Message: a client-generated id echoed back on the ack so the
-- frontend can reconcile its optimistic message with the server-confirmed one,
-- and so a retried send that actually landed server-side is not inserted twice
-- (issue #878).
ALTER TABLE "Message" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_clientId_key" ON "Message"("clientId");
