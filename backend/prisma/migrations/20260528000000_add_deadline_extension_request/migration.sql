-- CreateEnum
CREATE TYPE "DeadlineExtensionStatus" AS ENUM ('PENDING', 'APPROVED_BY_CLIENT', 'APPROVED_BY_FREELANCER', 'APPROVED_BY_BOTH', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DeadlineExtensionRequest" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "newDeadline" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DeadlineExtensionStatus" NOT NULL DEFAULT 'PENDING',
    "clientApprovedAt" TIMESTAMP(3),
    "freelancerApprovedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "onChainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadlineExtensionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeadlineExtensionRequest_milestoneId_idx" ON "DeadlineExtensionRequest"("milestoneId");

-- CreateIndex
CREATE INDEX "DeadlineExtensionRequest_jobId_idx" ON "DeadlineExtensionRequest"("jobId");

-- CreateIndex
CREATE INDEX "DeadlineExtensionRequest_status_idx" ON "DeadlineExtensionRequest"("status");

-- CreateIndex
CREATE INDEX "DeadlineExtensionRequest_createdAt_idx" ON "DeadlineExtensionRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "DeadlineExtensionRequest" ADD CONSTRAINT "DeadlineExtensionRequest_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtensionRequest" ADD CONSTRAINT "DeadlineExtensionRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtensionRequest" ADD CONSTRAINT "DeadlineExtensionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineExtensionRequest" ADD CONSTRAINT "DeadlineExtensionRequest_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
