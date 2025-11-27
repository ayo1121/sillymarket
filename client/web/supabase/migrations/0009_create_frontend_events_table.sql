-- Migration: Create frontend_events table for analytics
-- Purpose: Track user interactions and page views for analytics and product insights

-- Create frontend_events table
CREATE TABLE IF NOT EXISTS public.frontend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pubkey text, -- Nullable for anonymous users
  event_type text NOT NULL, -- 'page_view', 'click', 'bet_modal_open', 'share', etc.
  event_properties jsonb, -- Flexible storage for event-specific data
  page text, -- Current page/route
  market_pubkey text, -- Related market if applicable
  session_id text, -- Session identifier for grouping events
  user_agent text, -- Browser/device info
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_frontend_events_user_pubkey ON public.frontend_events(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_frontend_events_event_type ON public.frontend_events(event_type);
CREATE INDEX IF NOT EXISTS idx_frontend_events_market_pubkey ON public.frontend_events(market_pubkey);
CREATE INDEX IF NOT EXISTS idx_frontend_events_created_at ON public.frontend_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frontend_events_session_id ON public.frontend_events(session_id);

-- Composite index for common queries (user activity over time)
CREATE INDEX IF NOT EXISTS idx_frontend_events_user_created ON public.frontend_events(user_pubkey, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.frontend_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone can insert events (for anonymous tracking)
DROP POLICY IF EXISTS "frontend_events_insert_all" ON public.frontend_events;
CREATE POLICY "frontend_events_insert_all"
  ON public.frontend_events
  FOR INSERT
  TO public
  WITH CHECK (true);

-- RLS Policy: Only service role can read events (analytics/admin only)
DROP POLICY IF EXISTS "frontend_events_select_service_only" ON public.frontend_events;
CREATE POLICY "frontend_events_select_service_only"
  ON public.frontend_events
  FOR SELECT
  TO service_role
  USING (true);

-- RLS Policy: No updates allowed (events are immutable)
DROP POLICY IF EXISTS "frontend_events_no_update" ON public.frontend_events;
CREATE POLICY "frontend_events_no_update"
  ON public.frontend_events
  FOR UPDATE
  TO public
  USING (false);

-- RLS Policy: No deletes from frontend (only service role can delete)
DROP POLICY IF EXISTS "frontend_events_no_delete" ON public.frontend_events;
CREATE POLICY "frontend_events_no_delete"
  ON public.frontend_events
  FOR DELETE
  TO public
  USING (false);

-- Comment on table
COMMENT ON TABLE public.frontend_events IS 'Analytics events tracking user interactions and page views';
COMMENT ON COLUMN public.frontend_events.user_pubkey IS 'Solana wallet public key (nullable for anonymous users)';
COMMENT ON COLUMN public.frontend_events.event_type IS 'Type of event: page_view, click, bet_modal_open, share, etc.';
COMMENT ON COLUMN public.frontend_events.event_properties IS 'Flexible JSONB storage for event-specific metadata';
COMMENT ON COLUMN public.frontend_events.market_pubkey IS 'Related market public key if applicable';
COMMENT ON COLUMN public.frontend_events.session_id IS 'Session identifier for grouping related events';
