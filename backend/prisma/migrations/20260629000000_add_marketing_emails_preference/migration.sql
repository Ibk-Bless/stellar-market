-- AlterTable: add marketing email preference to NotificationPreference
ALTER TABLE "NotificationPreference" ADD COLUMN "marketingEmails" BOOLEAN NOT NULL DEFAULT true;
