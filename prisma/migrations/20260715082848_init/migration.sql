-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('MOVIE', 'TV');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('WANT', 'WATCHED');

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "imdbId" TEXT,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "posterUrl" TEXT,
    "overview" TEXT,
    "runtime" INTEGER,
    "genres" TEXT[],
    "cast" JSONB NOT NULL DEFAULT '[]',
    "director" TEXT,
    "tmdbScore" DOUBLE PRECISION,
    "imdbScore" TEXT,
    "rtScore" TEXT,
    "metacriticScore" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "Status" NOT NULL DEFAULT 'WANT',
    "note" TEXT,
    "myRating" INTEGER,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchedAt" TIMESTAMP(3),

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Title_tmdbId_mediaType_key" ON "Title"("tmdbId", "mediaType");
