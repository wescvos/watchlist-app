-- CreateTable
CREATE TABLE "RecommendationSet" (
    "id" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationSet_generatedAt_idx" ON "RecommendationSet"("generatedAt");

