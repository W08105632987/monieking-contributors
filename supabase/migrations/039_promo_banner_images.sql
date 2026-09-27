-- Migration 039: Promo banner image upload + layout styles + CTA validation sanitization

-- 1. Storage bucket for promo banner images
INSERT INTO storage.buckets (id, name, public)
VALUES ('promo-banners', 'promo-banners', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for promo-banners bucket
DROP POLICY IF EXISTS "promo_banners_public_read" ON storage.objects;
CREATE POLICY "promo_banners_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'promo-banners');

DROP POLICY IF EXISTS "promo_banners_upload" ON storage.objects;
CREATE POLICY "promo_banners_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'promo-banners' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "promo_banners_update" ON storage.objects;
CREATE POLICY "promo_banners_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'promo-banners' AND auth.role() = 'authenticated');

-- 2. Layout style enum + columns on promo_banners
DO $$ BEGIN
  CREATE TYPE promo_banner_layout_style AS ENUM ('gradient_only', 'full_bleed_image', 'split_image_text');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE promo_banners
  ADD COLUMN IF NOT EXISTS layout_style promo_banner_layout_style NOT NULL DEFAULT 'gradient_only',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_focal_x FLOAT NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS image_focal_y FLOAT NOT NULL DEFAULT 0.5;

-- 3. One-time data sanitization on existing promo_banners rows:
-- Ensure link_type = 'none' rows have link_target = NULL
UPDATE promo_banners
SET link_target = NULL
WHERE link_type = 'none' AND link_target IS NOT NULL;

-- Sanitize any external_url rows that do not start with https://
UPDATE promo_banners
SET link_target = NULL, link_type = 'none'
WHERE link_type = 'external_url' AND (link_target IS NULL OR link_target NOT LIKE 'https://%');
