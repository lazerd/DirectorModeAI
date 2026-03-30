-- Analytics events table for tracking page views, feature usage, and sessions
CREATE TABLE analytics_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,        -- 'page_view', 'feature_use', 'session_start', 'session_end'
  event_name TEXT NOT NULL,        -- e.g. '/mixer/home', 'create_event', 'generate_round'
  product TEXT,                    -- 'mixer', 'lessons', 'stringing', 'courtconnect', 'vault', null for general
  user_id UUID REFERENCES auth.users(id),
  session_id TEXT,                 -- client-generated UUID per browser session
  metadata JSONB DEFAULT '{}',     -- flexible: { duration_ms, referrer, screen_width, etc. }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient dashboard queries
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at);
CREATE INDEX idx_analytics_events_product ON analytics_events(product);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_session ON analytics_events(session_id);

-- RLS: allow inserts from anyone, no client-side selects (service role only)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert for all" ON analytics_events
  FOR INSERT WITH CHECK (true);
