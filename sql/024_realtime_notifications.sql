-- 024_realtime_notifications.sql
-- Enable Supabase Realtime on notifications table for live toasts + event strip

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
