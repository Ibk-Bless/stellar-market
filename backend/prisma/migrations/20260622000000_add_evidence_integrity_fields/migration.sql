-- AlterTable — add SHA-256 and Stellar anchor tx hash for evidence integrity
ALTER TABLE "Attachment"
  ADD COLUMN "sha256"       TEXT,
  ADD COLUMN "anchorTxHash" TEXT;
