-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'WANT',
    "note" TEXT,
    "myRating" INTEGER,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "watchedAt" TIMESTAMP(3),

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ListEntry_userId_status_idx" ON "ListEntry"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ListEntry_userId_titleId_key" ON "ListEntry"("userId", "titleId");

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Backfill: the whole existing list belongs to the owner account.
INSERT INTO "User" ("id", "email", "createdAt")
VALUES (gen_random_uuid()::text, 'wesley@vosk.co.za', now());

INSERT INTO "ListEntry" ("id", "userId", "titleId", "status", "note", "myRating", "pinned", "pinnedAt", "addedAt", "watchedAt")
SELECT gen_random_uuid()::text, u."id", t."id", t."status", t."note", t."myRating", t."pinned", t."pinnedAt", t."addedAt", t."watchedAt"
FROM "Title" t CROSS JOIN "User" u
WHERE u."email" = 'wesley@vosk.co.za';
