-- AlterTable
ALTER TABLE "Title" ADD COLUMN     "watchLink" TEXT,
ADD COLUMN     "watchProviders" JSONB NOT NULL DEFAULT '[]';
