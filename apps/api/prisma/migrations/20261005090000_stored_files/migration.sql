-- CreateTable
CREATE TABLE "stored_files" (
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("key")
);
