-- Migration 040: Promo Banner Events Table (Hot-Row Contention Fix)
-- Replaces synchronous UPDATE promo_banners SET impressions = impressions + 1 with
-- append-only INSERT into promo_banner_events to eliminate hot-row locking and dead-tuple bloat.

CREATE TABLE IF NOT EXISTS promo_banner_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    banner_id UUID NOT NULL REFERENCES promo_banners(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('impression', 'click')),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compound index for fast aggregation of impressions & clicks per banner
CREATE INDEX IF NOT EXISTS idx_promo_banner_events_lookup 
    ON promo_banner_events(banner_id, event_type, created_at);

-- Index for user activity auditing if needed
CREATE INDEX IF NOT EXISTS idx_promo_banner_events_user 
    ON promo_banner_events(user_id);

-- Enable Row Level Security
ALTER TABLE promo_banner_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (who view banners) to record events
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'promo_banner_events' 
        AND policyname = 'Allow authenticated users to insert promo events'
    ) THEN
        CREATE POLICY "Allow authenticated users to insert promo events"
            ON promo_banner_events
            FOR INSERT
            TO authenticated
            WITH CHECK (true);
    END IF;
END $$;

-- Allow directors/admins to read promo events for analytics
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'promo_banner_events' 
        AND policyname = 'Allow directors and admins to read promo events'
    ) THEN
        CREATE POLICY "Allow directors and admins to read promo events"
            ON promo_banner_events
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM users 
                    WHERE users.id = auth.uid() 
                    AND users.role IN ('director', 'admin')
                )
            );
    END IF;
END $$;

-- Note on counter columns:
-- The impressions and clicks columns on promo_banners are preserved as legacy/cached
-- fields. Going forward, all new events are inserted into promo_banner_events, and
-- director views aggregate live event counts from this table.
