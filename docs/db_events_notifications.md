# Database Tables: Events & Notifications

## Overview

This document describes the `frontend_events` and `notifications` tables used for analytics tracking and user notifications in the sillymarket application.

---

## frontend_events Table

**Purpose**: Track user interactions and page views for analytics and product insights.

### Schema

```sql
CREATE TABLE public.frontend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pubkey text,                    -- Nullable for anonymous users
  event_type text NOT NULL,            -- 'page_view', 'click', 'bet_modal_open', etc.
  event_properties jsonb,              -- Flexible event-specific data
  page text,                           -- Current page/route
  market_pubkey text,                  -- Related market if applicable
  session_id text,                     -- Session identifier
  user_agent text,                     -- Browser/device info
  created_at timestamptz DEFAULT now()
);
```

### Indexes

- `idx_frontend_events_user_pubkey` - User activity queries
- `idx_frontend_events_event_type` - Event type filtering
- `idx_frontend_events_market_pubkey` - Market-specific analytics
- `idx_frontend_events_created_at` - Time-based queries
- `idx_frontend_events_session_id` - Session tracking
- `idx_frontend_events_user_created` - Composite for user activity over time

### RLS Policies

- **INSERT**: Anyone can insert (for anonymous tracking)
- **SELECT**: Only service role (analytics/admin only)
- **UPDATE**: Not allowed (events are immutable)
- **DELETE**: Only service role

### Usage

Events are logged via the backend API endpoint `POST /events`:

```typescript
// Frontend
import { logEvent, logPageView, logClick } from '@/lib/analytics';

// Track page view
logPageView('market_details', { market_pubkey: marketId });

// Track click
logClick('trending_market', { market_pubkey: market.pubkey, position: 1 });

// Track custom event
logEvent('bet_modal_open', { outcome_index: 0 }, marketPubkey);
```

### Event Types

- `page_view` - Page views
- `click` - User clicks on elements
- `bet_modal_open` - Bet modal opens (intent tracking)
- `share` - Share button clicks
- `search` - Search queries
- `filter_change` - Filter changes
- `notification` - Notification interactions

---

## notifications Table

**Purpose**: Store user notifications for market events and activities.

### Schema

```sql
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pubkey text NOT NULL,
  type text NOT NULL,                  -- Notification type
  title text NOT NULL,
  body text,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

### Indexes

- `idx_notifications_user_pubkey` - User notifications lookup
- `idx_notifications_user_unread` - Unread notifications (partial index)
- `idx_notifications_created_at` - Time-based queries
- `idx_notifications_type` - Notification type filtering

### RLS Policies

- **SELECT**: Users can read their own notifications (matched by `user_pubkey`)
- **INSERT**: Only service role (backend-generated)
- **UPDATE**: Users can update (mark as read) their own notifications
- **DELETE**: Only service role

### Notification Types

- `claimable_winnings` - User has winnings to claim
- `market_closing` - Market closing soon (user has position)
- `market_resolved` - Market resolved (user has position)
- `bet_placed` - Bet successfully placed
- `market_created` - User's market was created

### Usage

**Backend (Generate Notifications)**:
```typescript
// When market resolves
await pool.query(
  `INSERT INTO notifications (user_pubkey, type, title, body, metadata)
   VALUES ($1, $2, $3, $4, $5)`,
  [
    userPubkey,
    'market_resolved',
    'Market Resolved',
    `Your market "${marketTitle}" has been resolved.`,
    JSON.stringify({ market_id: marketId, action_url: `/market/${marketId}` })
  ]
);
```

**Frontend (Read Notifications)**:
```typescript
// Fetch user notifications
const { data: notifications } = useQuery({
  queryKey: ['notifications', publicKey?.toBase58()],
  queryFn: async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_pubkey', publicKey.toBase58())
      .order('created_at', { ascending: false })
      .limit(50);
    return data || [];
  },
  enabled: !!publicKey
});

// Mark as read
await supabase
  .from('notifications')
  .update({ is_read: true })
  .eq('id', notificationId);
```

**Real-time Subscription**:
```typescript
useEffect(() => {
  if (!publicKey) return;
  
  const channel = supabase
    .channel('user-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_pubkey=eq.${publicKey.toBase58()}`
    }, (payload) => {
      // Handle new notification
      addNotification(payload.new);
    })
    .subscribe();
  
  return () => { channel.unsubscribe(); };
}, [publicKey]);
```

---

## Applying Migrations

### Using Supabase CLI

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. **Link to your Supabase project**:
   ```bash
   cd client/web
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Apply migrations**:
   ```bash
   supabase db push
   ```

   This will apply all pending migrations in the `supabase/migrations/` directory.

4. **Verify migrations**:
   ```bash
   supabase db diff
   ```

### Manual Application (Supabase Dashboard)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open each migration file in order:
   - `0009_create_frontend_events_table.sql`
   - `0010_create_notifications_table.sql`
4. Execute each migration

### Migration Files

Located in: `client/web/supabase/migrations/`

- **0009_create_frontend_events_table.sql** - Analytics events table
- **0010_create_notifications_table.sql** - User notifications table

---

## Security Considerations

### frontend_events

- **Anonymous tracking**: Allows inserts without authentication for anonymous user tracking
- **Read-only for service**: Only service role can query events (prevents data leakage)
- **Immutable**: Events cannot be updated or deleted from frontend

### notifications

- **User isolation**: RLS ensures users can only see their own notifications
- **Backend-generated**: Only service role can create notifications (prevents spam)
- **User control**: Users can mark notifications as read
- **Secure deletion**: Only service role can delete notifications

---

## Database Indexes

Both tables are optimized with indexes for common query patterns:

- **User lookups**: Fast retrieval of user-specific data
- **Time-based queries**: Efficient sorting and filtering by date
- **Partial indexes**: Optimized for unread notifications
- **Composite indexes**: Support complex queries (user + time)

---

## Realtime Subscriptions

Both tables are enabled for Supabase Realtime:

- **frontend_events**: Not typically subscribed to from frontend
- **notifications**: Frontend subscribes to receive new notifications in real-time

---

## Maintenance

### Archiving Old Events

Consider archiving or deleting old analytics events periodically:

```sql
-- Delete events older than 90 days
DELETE FROM frontend_events 
WHERE created_at < NOW() - INTERVAL '90 days';
```

### Notification Cleanup

Clean up old read notifications:

```sql
-- Delete read notifications older than 30 days
DELETE FROM notifications 
WHERE is_read = true 
  AND created_at < NOW() - INTERVAL '30 days';
```

---

## Future Enhancements

### frontend_events

- Add event aggregation views for common analytics queries
- Implement data retention policies
- Add event validation triggers

### notifications

- Add notification preferences table (user settings)
- Implement notification batching (digest emails)
- Add push notification support
- Add notification templates

---

**Last Updated**: 2025-11-27  
**Migration Version**: 0010
