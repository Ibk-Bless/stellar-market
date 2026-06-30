-- Add tokenVersion to User: incremented on password change so previously-issued
-- JWTs (which embed the value at sign time) can be rejected on mismatch,
-- immediately invalidating tokens stolen before the change (issue #787).
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
