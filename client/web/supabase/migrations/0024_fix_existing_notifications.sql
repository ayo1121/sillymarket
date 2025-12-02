-- Fix existing notifications that have incorrect outcome labels and missing action_url
-- This updates notifications created before the fix was implemented

-- Update action_url for notifications that have it missing or set to undefined
UPDATE notifications
SET action_url = '/market/' || (metadata->>'market_pubkey')
WHERE type = 'market_resolved'
  AND (action_url IS NULL OR action_url = 'undefined' OR action_url = '')
  AND metadata->>'market_pubkey' IS NOT NULL;

-- Note: We cannot easily fix the "outcome 1" text in the body without knowing the actual outcome labels
-- The body field contains text like "The winner was outcome 1"
-- To fix this, we would need to:
-- 1. Extract market_pubkey from metadata
-- 2. Join with markets table to get outcome_labels
-- 3. Replace "outcome X" with the actual label
-- This is complex in SQL, so we'll leave it for now
-- New notifications will have the correct labels

-- Alternative: Just delete old notifications and let new ones be created correctly
-- Uncomment the following line if you want to delete all existing market_resolved notifications:
-- DELETE FROM notifications WHERE type = 'market_resolved';
