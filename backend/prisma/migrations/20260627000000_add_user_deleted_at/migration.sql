-- AlterTable: add soft-delete column to User
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
