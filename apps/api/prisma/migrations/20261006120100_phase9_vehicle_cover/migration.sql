-- Phase 9: the first vehicle photo as a joinable column (embedded user views show it without extra queries).
ALTER TABLE "vehicles" ADD COLUMN "cover_upload_id" UUID;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_cover_upload_id_fkey" FOREIGN KEY ("cover_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
