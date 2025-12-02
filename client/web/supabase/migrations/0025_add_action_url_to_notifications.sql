-- Add action_url column to notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
