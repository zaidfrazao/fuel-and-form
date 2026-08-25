ALTER TABLE "users" ADD COLUMN "ip_hash" text;--> statement-breakpoint
CREATE INDEX "users_demo_ip_hash_idx" ON "users" USING btree ("ip_hash","created_at") WHERE "kind" = 'demo';