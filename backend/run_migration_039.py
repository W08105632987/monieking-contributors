"""
Migration 039: Promo banner images, layout styles, and CTA link validation

Changes:
  1. Create 'promo-banners' bucket in Supabase storage (public read)
  2. Setup storage policies on storage.objects for promo-banners
  3. Create promo_banner_layout_style enum ('gradient_only', 'full_bleed_image', 'split_image_text')
  4. Add layout_style, image_url, image_focal_x, image_focal_y to promo_banners
  5. Sanitize existing promo_banners rows for link_target integrity
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
from sqlalchemy import text
from app.core.database import engine

STATEMENTS = [
    # ── 1. Create storage bucket for promo-banners (public read) ───────────
    """
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('promo-banners', 'promo-banners', true)
    ON CONFLICT (id) DO NOTHING;
    """,

    # ── 2. Storage policies on storage.objects ─────────────────────────────
    """
    DROP POLICY IF EXISTS "promo_banners_public_read" ON storage.objects;
    """,
    """
    CREATE POLICY "promo_banners_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'promo-banners');
    """,
    """
    DROP POLICY IF EXISTS "promo_banners_upload" ON storage.objects;
    """,
    """
    CREATE POLICY "promo_banners_upload" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'promo-banners' AND auth.role() = 'authenticated');
    """,
    """
    DROP POLICY IF EXISTS "promo_banners_update" ON storage.objects;
    """,
    """
    CREATE POLICY "promo_banners_update" ON storage.objects
      FOR UPDATE USING (bucket_id = 'promo-banners' AND auth.role() = 'authenticated');
    """,

    # ── 3. Layout style enum ───────────────────────────────────────────────
    """
    DO $$ BEGIN
      CREATE TYPE promo_banner_layout_style AS ENUM ('gradient_only', 'full_bleed_image', 'split_image_text');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    """,

    # ── 4. Add columns to promo_banners ───────────────────────────────────
    """
    ALTER TABLE promo_banners
      ADD COLUMN IF NOT EXISTS layout_style promo_banner_layout_style NOT NULL DEFAULT 'gradient_only',
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS image_focal_x FLOAT NOT NULL DEFAULT 0.5,
      ADD COLUMN IF NOT EXISTS image_focal_y FLOAT NOT NULL DEFAULT 0.5;
    """,

    # ── 5. Data sanitization on existing promo_banners ─────────────────────
    """
    UPDATE promo_banners
    SET link_target = NULL
    WHERE link_type = 'none' AND link_target IS NOT NULL;
    """,
    """
    UPDATE promo_banners
    SET link_target = NULL, link_type = 'none'
    WHERE link_type = 'external_url' AND (link_target IS NULL OR link_target NOT LIKE 'https://%');
    """,
]

async def main():
    print("Applying migration 039 (promo banner images + layout styles + CTA validation)...", flush=True)
    async with engine.connect() as conn:
        for i, stmt in enumerate(STATEMENTS, 1):
            stmt_clean = stmt.strip()
            if not stmt_clean:
                continue
            preview = stmt_clean[:60].replace("\n", " ")
            print(f"  [{i}/{len(STATEMENTS)}] {preview}...", flush=True)
            await conn.execute(text(stmt_clean))
        await conn.commit()
    print("SUCCESS: Migration 039 applied!", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
