/*
  Warnings:

  - You are about to drop the `SavedList` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SavedList" DROP CONSTRAINT "SavedList_userId_fkey";

-- DropTable
DROP TABLE "SavedList";

-- CreateTable
CREATE TABLE "BankTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTaskTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTask_userId_idx" ON "BankTask"("userId");

-- CreateIndex
CREATE INDEX "BankTaskTemplate_userId_idx" ON "BankTaskTemplate"("userId");

-- AddForeignKey
ALTER TABLE "BankTask" ADD CONSTRAINT "BankTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTaskTemplate" ADD CONSTRAINT "BankTaskTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
