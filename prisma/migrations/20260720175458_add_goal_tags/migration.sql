-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
