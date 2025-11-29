-- 0015_add_notification_triggers.sql
------------------------------------------------

-- Function to notify on new bet (via pg_notify)
CREATE OR REPLACE FUNCTION notify_new_bet()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'new_bet',
    json_build_object(
      'market_pubkey', NEW.market_pubkey,
      'bettor_pubkey', NEW.bettor_pubkey,
      'outcome_index', NEW.outcome_index,
      'amount_sol', NEW.amount_sol
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_bet_inserted ON bets;
CREATE TRIGGER on_bet_inserted
  AFTER INSERT ON bets
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_bet();

-- Function to create notifications when a market is resolved
CREATE OR REPLACE FUNCTION create_resolution_notifications()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (user_pubkey, type, title, body, metadata, is_read)
  SELECT DISTINCT
    bettor_pubkey,
    'market_resolved',
    'Market Resolved',
    'A market you bet on has been resolved. Check if you won!',
    json_build_object('market_id', NEW.market_pubkey),
    false
  FROM bets
  WHERE market_pubkey = NEW.market_pubkey;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_market_resolved ON market_resolutions;
CREATE TRIGGER on_market_resolved
  AFTER INSERT ON market_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION create_resolution_notifications();
