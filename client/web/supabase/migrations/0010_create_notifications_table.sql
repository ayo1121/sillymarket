-- =====================================================================
-- Migration: Create notifications table for user notifications
-- Purpose: Store user notifications with read/unread status
-- =====================================================================

-- NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pubkey text NOT NULL,
  type text NOT NULL, -- 'claimable_winnings', 'market_closing', 'market_resolved', etc.
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_pubkey 
  ON public.notifications(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON public.notifications(user_pubkey, is_read) 
  WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at 
  ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type 
  ON public.notifications(type);

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_pubkey = (SELECT pubkey FROM public.users WHERE id = auth.uid()));

-- RLS Policy: Service role can insert notifications (backend-generated)
DROP POLICY IF EXISTS "notifications_insert_service" ON public.notifications;
CREATE POLICY "notifications_insert_service"
  ON public.notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- RLS Policy: Users can update (mark as read) their own notifications
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_pubkey = (SELECT pubkey FROM public.users WHERE id = auth.uid()))
  WITH CHECK (user_pubkey = (SELECT pubkey FROM public.users WHERE id = auth.uid()));

-- RLS Policy: No deletes from frontend (only service role can delete)
DROP POLICY IF EXISTS "notifications_delete_service" ON public.notifications;
CREATE POLICY "notifications_delete_service"
  ON public.notifications
  FOR DELETE
  TO service_role
  USING (true);

-- Enable realtime for notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN others THEN
    -- If publication cannot be altered in this context, ignore to keep migration idempotent
    NULL;
END;
$$;

-- Comments for documentation
COMMENT ON TABLE public.notifications IS 'User notifications for market events and activities';
COMMENT ON COLUMN public.notifications.user_pubkey IS 'Solana wallet public key of the notification recipient';
COMMENT ON COLUMN public.notifications.type IS 'Notification type: claimable_winnings, market_closing, market_resolved, etc.';
COMMENT ON COLUMN public.notifications.title IS 'Notification title/heading';
COMMENT ON COLUMN public.notifications.body IS 'Notification body/message text';
COMMENT ON COLUMN public.notifications.metadata IS 'Additional notification metadata (market_id, action_url, etc.)';
COMMENT ON COLUMN public.notifications.is_read IS 'Whether the notification has been read by the user';
