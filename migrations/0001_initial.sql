PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed','archived')),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendees (
  event_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  position TEXT,
  organization TEXT,
  registered_at TEXT,
  email_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS attendees_event_name
  ON attendees(event_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS attendees_event_email
  ON attendees(event_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS checkins (
  event_id TEXT NOT NULL,
  attendee_id TEXT NOT NULL,
  checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_by TEXT,
  device_id TEXT,
  PRIMARY KEY (event_id, attendee_id),
  FOREIGN KEY (event_id, attendee_id)
    REFERENCES attendees(event_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS checkins_event_time
  ON checkins(event_id, checked_in_at DESC);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  attendee_id TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id, attendee_id)
    REFERENCES attendees(event_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO events (id, name, status)
VALUES ('default', 'งานอีเวนต์', 'active');
