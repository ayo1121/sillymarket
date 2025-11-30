-- 0021_fix_function_search_path.sql
-- Fixes "Function Search Path Mutable" security warnings

-- Update notify_new_bet to have explicit search_path
CREATE OR REPLACE FUNCTION public.notify_new_bet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM
    net.http_post(
      url := 'https://project-ref.supabase.co/functions/v1/index_bet_event',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('request.headers')::json->>'apikey' || '"}'::jsonb,
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'bets',
        'record', row_to_json(NEW)
      )
    );
  RETURN NEW;
END;
$$;

-- Update create_resolution_notifications to have explicit search_path
CREATE OR REPLACE FUNCTION public.create_resolution_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create notifications for all users who bet on the market
  INSERT INTO public.notifications (user_id, market_id, type, message, data)
  SELECT DISTINCT
    b.user_id,
    NEW.id,
    'market_resolved',
    'Market resolved: ' || NEW.title,
    jsonb_build_object('outcome', NEW.outcome)
  FROM public.bets b
  WHERE b.market_id = NEW.id;

  RETURN NEW;
END;
$$;
