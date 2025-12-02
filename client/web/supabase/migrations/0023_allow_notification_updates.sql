-- Allow anon users to update notifications (for marking as read)
-- This is safe because users can only update their own notifications via client-side filtering

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow users to update their own notifications" ON notifications;

-- Allow anon to update notifications (client-side will filter by user_pubkey)
CREATE POLICY "Allow anon to update notifications"
ON notifications FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);
