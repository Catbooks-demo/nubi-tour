-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "cities" TEXT[],
    "nights" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "airline" TEXT NOT NULL,
    "departure_airport" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" TEXT[],
    "includes" TEXT[],
    "excludes" TEXT[],
    "optional_tours" JSONB NOT NULL DEFAULT '[]',
    "shopping_count" INTEGER NOT NULL DEFAULT 0,
    "guide" TEXT NOT NULL,
    "travel_docs" TEXT NOT NULL,
    "base_price" INTEGER NOT NULL,
    "on_sale" BOOLEAN NOT NULL DEFAULT true,
    "sort_rank" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_themes" (
    "product_id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,

    CONSTRAINT "product_themes_pkey" PRIMARY KEY ("product_id","theme_id")
);

-- CreateTable
CREATE TABLE "itinerary_days" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT[],
    "breakfast" TEXT NOT NULL,
    "lunch" TEXT NOT NULL,
    "dinner" TEXT NOT NULL,
    "hotel" TEXT NOT NULL,

    CONSTRAINT "itinerary_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departures" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "depart_date" TEXT NOT NULL,
    "return_date" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "min_pax" INTEGER NOT NULL,
    "price_adult" INTEGER NOT NULL,
    "price_child" INTEGER NOT NULL,
    "price_infant" INTEGER NOT NULL,
    "single_supplement" INTEGER NOT NULL,
    "deposit_per_person" INTEGER NOT NULL DEFAULT 300000,
    "status" TEXT NOT NULL DEFAULT 'open',
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "token_hash" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "booking_counters" (
    "day" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_counters_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_pin_hash" TEXT,
    "departure_id" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "single_rooms" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "deposit_amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "pay_mode" TEXT NOT NULL,
    "pay_deadline" TIMESTAMP(3) NOT NULL,
    "balance_deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "status_before_cancel" TEXT,
    "seats_released_at" TIMESTAMP(3),
    "staff_memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travelers" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name_ko" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "birth_date" TEXT NOT NULL,
    "passport_last4" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "toss_order_id" TEXT,
    "toss_payment_key" TEXT,
    "refund_of_id" TEXT,
    "failure_reason" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellations" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "days_before" INTEGER NOT NULL,
    "fee_rate" DOUBLE PRECISION NOT NULL,
    "fee" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL,
    "refund" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "decided_by" TEXT,
    "decide_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "booking_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answered_by" TEXT,
    "answered_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "themes_code_key" ON "themes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_region_id_idx" ON "products"("region_id");

-- CreateIndex
CREATE INDEX "products_updated_at_idx" ON "products"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "itinerary_days_product_id_day_key" ON "itinerary_days"("product_id", "day");

-- CreateIndex
CREATE INDEX "departures_depart_date_idx" ON "departures"("depart_date");

-- CreateIndex
CREATE INDEX "departures_updated_at_idx" ON "departures"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "departures_product_id_depart_date_key" ON "departures"("product_id", "depart_date");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_updated_at_idx" ON "users"("updated_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "staff_sessions_staff_id_idx" ON "staff_sessions"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "bookings_departure_id_idx" ON "bookings"("departure_id");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_updated_at_idx" ON "bookings"("updated_at");

-- CreateIndex
CREATE INDEX "travelers_booking_id_idx" ON "travelers"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_toss_order_id_key" ON "payments"("toss_order_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_updated_at_idx" ON "payments"("updated_at");

-- CreateIndex
CREATE INDEX "cancellations_booking_id_idx" ON "cancellations"("booking_id");

-- CreateIndex
CREATE INDEX "cancellations_status_idx" ON "cancellations"("status");

-- CreateIndex
CREATE INDEX "cancellations_updated_at_idx" ON "cancellations"("updated_at");

-- CreateIndex
CREATE INDEX "inquiries_status_idx" ON "inquiries"("status");

-- CreateIndex
CREATE INDEX "inquiries_updated_at_idx" ON "inquiries"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_idx" ON "reviews"("product_id");

-- CreateIndex
CREATE INDEX "messages_booking_id_kind_idx" ON "messages"("booking_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_themes" ADD CONSTRAINT "product_themes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_themes" ADD CONSTRAINT "product_themes_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departures" ADD CONSTRAINT "departures_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_id_fkey" FOREIGN KEY ("departure_id") REFERENCES "departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

