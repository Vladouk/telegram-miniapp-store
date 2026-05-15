CREATE TABLE IF NOT EXISTS "Image" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Image_filename_key" ON "Image"("filename");
CREATE INDEX IF NOT EXISTS "Image_filename_idx" ON "Image"("filename");
