-- MyTrack database schema
-- Run this once against an empty database (see scripts/migrate.js for an automated way)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  avatar MEDIUMTEXT NULL,
  action_password VARCHAR(255) NULL,
  require_password_delete TINYINT(1) NOT NULL DEFAULT 0,
  require_password_edit TINYINT(1) NOT NULL DEFAULT 0,
  sidebar_color VARCHAR(20) NULL,
  topbar_color VARCHAR(20) NULL,
  content_color VARCHAR(20) NULL,
  google_email VARCHAR(255) NULL,
  google_refresh_token TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Safe to re-run against a database created before these columns existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar MEDIUMTEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS action_password VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_password_delete TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_password_edit TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sidebar_color VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS topbar_color VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS content_color VARCHAR(20) NULL;
-- Lets "Backup" upload to the signed-in user's own Google Drive (OAuth)
-- instead of a service account's isolated storage.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT NULL;

CREATE TABLE IF NOT EXISTS tracks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  parent_id INT NULL,
  uuid CHAR(36) NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  icon MEDIUMTEXT NULL,
  icon_type VARCHAR(10) NOT NULL DEFAULT 'tag',
  color VARCHAR(20) DEFAULT '#35C2A6',
  page_size INT NOT NULL DEFAULT 25,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tracks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before parent_id existed.
-- Sub-track deletion cascades in application code (see the tracks DELETE route),
-- not via a DB foreign key, so this column intentionally has no FK of its own.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS parent_id INT NULL;
ALTER TABLE tracks ADD INDEX IF NOT EXISTS idx_tracks_parent (parent_id);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS page_size INT NOT NULL DEFAULT 25;
-- How a track lays out its entries: 'table' (the original), 'plain', 'grid' or 'doc'.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS view_type VARCHAR(10) NOT NULL DEFAULT 'table';

-- Safe to re-run against a database created before uuid existed. New tracks
-- get one from the app (crypto.randomUUID()); this backfills anything older,
-- and the track page route itself also lazily backfills as a last resort.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS uuid CHAR(36) NULL;
UPDATE tracks SET uuid = UUID() WHERE uuid IS NULL;
ALTER TABLE tracks ADD UNIQUE INDEX IF NOT EXISTS idx_tracks_uuid (uuid);

-- Safe to re-run against a database created before icon_type existed, or
-- before icon was widened to hold an icon-font class name or an uploaded
-- image (data URL) rather than just a short text tag.
ALTER TABLE tracks MODIFY COLUMN icon MEDIUMTEXT NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS icon_type VARCHAR(10) NOT NULL DEFAULT 'tag';

-- Safe to re-run against a database created before position existed — lets
-- siblings (same parent_id, including top-level tracks sharing NULL) be
-- drag-reordered relative to each other. Backfilled from the previous
-- created_at-DESC display order, but only for a sibling group that's still
-- untouched (MAX(position) = 0 across the whole group), so re-running this
-- never clobbers a manual reorder.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
UPDATE tracks t
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, COALESCE(parent_id, 0) ORDER BY created_at DESC, id DESC) - 1 AS rn
  FROM tracks
  WHERE (user_id, COALESCE(parent_id, 0)) IN (
    SELECT user_id, COALESCE(parent_id, 0) FROM tracks GROUP BY user_id, COALESCE(parent_id, 0) HAVING MAX(position) = 0
  )
) ranked ON ranked.id = t.id
SET t.position = ranked.rn;

CREATE TABLE IF NOT EXISTS track_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  track_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  options TEXT NULL,
  field_length VARCHAR(20) NULL,
  is_auto_increment TINYINT(1) NOT NULL DEFAULT 0,
  next_auto_value BIGINT NOT NULL DEFAULT 1,
  is_filterable TINYINT(1) NOT NULL DEFAULT 0,
  is_searchable TINYINT(1) NOT NULL DEFAULT 0,
  position INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_columns_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before these columns existed.
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS field_length VARCHAR(20) NULL;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_auto_increment TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS next_auto_value BIGINT NOT NULL DEFAULT 1;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_filterable TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_searchable TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS track_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  track_id INT NOT NULL,
  uuid CHAR(36) NULL,
  data JSON NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_entries_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before uuid existed. New rows get
-- one from the app (crypto.randomUUID()); this backfills anything older.
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS uuid CHAR(36) NULL;
UPDATE track_entries SET uuid = UUID() WHERE uuid IS NULL;
ALTER TABLE track_entries ADD UNIQUE INDEX IF NOT EXISTS idx_entries_uuid (uuid);

-- Safe to re-run against a database created before position existed. Rows are
-- backfilled from their previous created_at-DESC display order, but only for
-- a track whose entries are ALL still at the position=0 default — a track
-- with any manual reordering already applied (max(position) > 0) is left
-- alone so re-running this script never clobbers a user's row order.
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
UPDATE track_entries te
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY created_at DESC, id DESC) - 1 AS rn
  FROM track_entries
  WHERE track_id IN (
    SELECT track_id FROM track_entries GROUP BY track_id HAVING MAX(position) = 0
  )
) ranked ON ranked.id = te.id
SET te.position = ranked.rn;

ALTER TABLE tracks ADD INDEX IF NOT EXISTS idx_tracks_user (user_id);
ALTER TABLE track_columns ADD INDEX IF NOT EXISTS idx_columns_track (track_id);
ALTER TABLE track_entries ADD INDEX IF NOT EXISTS idx_entries_track (track_id);

-- A locked entry's data is withheld from every read until the account's
-- privacy password is verified (see /api/tracks/:id/entries/:entryId PATCH).
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS is_locked TINYINT(1) NOT NULL DEFAULT 0;

-- Notes: same nested-tree shape as tracks (parent_id, uuid, position), but
-- each row holds one rich-text document instead of a table of entries.
CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  parent_id INT NULL,
  uuid CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NULL,
  style JSON NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE notes ADD UNIQUE INDEX IF NOT EXISTS idx_notes_uuid (uuid);
ALTER TABLE notes ADD INDEX IF NOT EXISTS idx_notes_user (user_id);
ALTER TABLE notes ADD INDEX IF NOT EXISTS idx_notes_parent (parent_id);

-- ---------------- Task assigner ----------------
-- A board is owned by its admin (owner_id). Members are other registered
-- users the admin adds, each with their own add / edit / delete rights.
-- visibility: 'private' → a member only sees tasks assigned to or created by
-- them; 'public' → every member sees every task on the board.
CREATE TABLE IF NOT EXISTS task_boards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  visibility VARCHAR(10) NOT NULL DEFAULT 'private',
  statuses JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_task_boards_uuid (uuid),
  KEY idx_task_boards_owner (owner_id),
  CONSTRAINT fk_task_boards_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  options TEXT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_columns_board (board_id),
  CONSTRAINT fk_task_columns_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  user_id INT NOT NULL,
  can_add TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_task_members_unique (board_id, user_id),
  KEY idx_task_members_user (user_id),
  CONSTRAINT fk_task_members_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Deleting a task is a soft delete (deleted_at) so the admin can revert it.
CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  board_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
  assignee_id INT NULL,
  due_date DATE NULL,
  data JSON NULL,
  created_by INT NULL,
  updated_by INT NULL,
  position INT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_tasks_uuid (uuid),
  KEY idx_tasks_board (board_id),
  KEY idx_tasks_assignee (assignee_id),
  CONSTRAINT fk_tasks_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Every change on a board. `changes` is a list of
-- { key, label, old, new, oldText, newText } — raw values (for revert) plus
-- display text (user names, file names) captured at the time of the change.
CREATE TABLE IF NOT EXISTS task_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  task_id INT NULL,
  user_id INT NULL,
  user_name VARCHAR(255) NULL,
  action VARCHAR(30) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  changes JSON NULL,
  revert_of BIGINT NULL,
  reverted_by INT NULL,
  reverted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_activity_board (board_id, id),
  KEY idx_task_activity_task (task_id),
  CONSTRAINT fk_task_activity_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Display order of the board table's columns: built-in keys (title, status,
-- priority, assignee, due, updated) and custom columns as "c:<id>".
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS column_order JSON NULL;

-- Who set up an account on someone's behalf (Users page / "Create user" on a
-- task board). That creator can list and edit those accounts; NULL means the
-- person registered themselves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INT NULL;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_created_by (created_by);

-- Admins see and delete every user's tracker screenshots, and can make other
-- people admins from the Users page. The first one is set with
-- `npm run make-admin -- you@example.com`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) NOT NULL DEFAULT 0;

-- Menu items the user chose to hide (profile → Accessibility), as a JSON array of
-- ids from lib/menuItems.js. NULL shows everything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_menus VARCHAR(1000) NULL;

-- Code saver: named code files kept for reference.
CREATE TABLE IF NOT EXISTS code_snippets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  language VARCHAR(40) NOT NULL DEFAULT 'text',
  content LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_code_uuid (uuid),
  KEY idx_code_user (user_id),
  CONSTRAINT fk_code_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Code saver: a snapshot each time the user explicitly saves, so any two
-- states of a file can be compared later.
CREATE TABLE IF NOT EXISTS code_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snippet_id INT NOT NULL,
  label VARCHAR(255) NULL,
  language VARCHAR(40) NOT NULL DEFAULT 'text',
  content LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_code_versions_snippet (snippet_id, id),
  CONSTRAINT fk_code_versions_snippet FOREIGN KEY (snippet_id) REFERENCES code_snippets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Calendar: leave days (a range, inclusive) and a daily log of what was done.
CREATE TABLE IF NOT EXISTS calendar_leaves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type VARCHAR(20) NOT NULL DEFAULT 'casual',
  half_day TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_leaves_user_dates (user_id, start_date, end_date),
  CONSTRAINT fk_leaves_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS calendar_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  activity_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  title VARCHAR(255) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_activities_user_date (user_id, activity_date),
  CONSTRAINT fk_activities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Login audit: one row per successful login, with an optional webcam photo of
-- whoever signed in (captured client-side only if they allow the camera).
CREATE TABLE IF NOT EXISTS login_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  photo MEDIUMTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_login_events_uuid (uuid),
  KEY idx_login_events_user (user_id, created_at),
  CONSTRAINT fk_login_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Activity log: what each user did in MyTrack. Written automatically by the
-- API wrappers (lib/activityLog.js); older history is rebuilt once per user
-- from existing tables (source = 'history'). Task-board actions are read
-- straight from task_activity instead of being copied here.
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  action VARCHAR(20) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  url VARCHAR(500) NULL,
  ref VARCHAR(120) NULL,
  hits INT NOT NULL DEFAULT 1,
  source VARCHAR(10) NOT NULL DEFAULT 'live',
  history_key VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_activity_time (user_id, created_at),
  KEY idx_user_activity_ref (user_id, ref, updated_at),
  UNIQUE KEY idx_user_activity_history (user_id, history_key),
  CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Optional leading "Sr. No." column on a task board (set at creation).
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS show_serial TINYINT(1) NOT NULL DEFAULT 0;

-- IP Locator → IMEI tab: the user's own phones/laptops and their IMEIs, kept
-- so they're at hand for a police complaint or a CEIR block if one is lost.
CREATE TABLE IF NOT EXISTS user_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  imei CHAR(15) NOT NULL,
  imei2 CHAR(15) NULL,
  notes VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_user_devices_imei (user_id, imei),
  CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Last location a device reported about itself ("Share from this device" on
-- the IMEI tab, while that page is open on it).
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_lat DOUBLE NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_lon DOUBLE NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_accuracy FLOAT NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_ip VARCHAR(45) NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NULL;

-- Task board columns the admin hid from the task listing for everyone
-- (keys as in column_order: 'status', 'c:12', ...). Members can still hide
-- more for themselves; that choice stays in their browser.
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS hidden_columns JSON NULL;

-- Daily Expenses (sidebar): one row per thing you paid for.
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  spent_on DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NOT NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'other',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_expenses_user_date (user_id, spent_on),
  CONSTRAINT fk_expenses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Daily Routine (sidebar): the things you do each day, and which days
-- (ISO weekdays as digits, 1 = Monday … 7 = Sunday) they're on.
CREATE TABLE IF NOT EXISTS routine_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  time_of_day TIME NULL,
  days VARCHAR(7) NOT NULL DEFAULT '1234567',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_routine_items_user (user_id),
  CONSTRAINT fk_routine_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- A routine item ticked off on a day.
CREATE TABLE IF NOT EXISTS routine_checks (
  item_id INT NOT NULL,
  user_id INT NOT NULL,
  check_date DATE NOT NULL,
  done_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, check_date),
  KEY idx_routine_checks_user_date (user_id, check_date),
  CONSTRAINT fk_routine_checks_item FOREIGN KEY (item_id) REFERENCES routine_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Optional leading "Sr. No." column in a track's table (new tracks start with it on).
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS show_serial TINYINT(1) NOT NULL DEFAULT 0;

-- Notes on task activity entries. The logged change itself never changes;
-- adding or editing a note is logged as its own 'log_note' entry.
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note TEXT NULL;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note_by INT NULL;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note_at TIMESTAMP NULL;
-- Throttle lookup for 'task_view' entries (one per person per task per 10 min).
ALTER TABLE task_activity ADD INDEX IF NOT EXISTS idx_task_activity_view (task_id, user_id, action, created_at);

-- Comments on task activity entries — a thread per log entry that any board
-- member can add to. Adding / editing / deleting one is itself logged
-- ('log_comment'), and @mentions notify the people named.
CREATE TABLE IF NOT EXISTS task_comments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  activity_id BIGINT NOT NULL,
  task_id INT NULL,
  user_id INT NULL,
  user_name VARCHAR(255) NULL,
  body TEXT NOT NULL,
  mentions JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  KEY idx_task_comments_activity (activity_id),
  CONSTRAINT fk_task_comments_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- In-app notifications (the 🔔 in the top bar) — e.g. "Ann mentioned you".
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  actor_id INT NULL,
  actor_name VARCHAR(255) NULL,
  kind VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  url VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (user_id, read_at, id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Comment attachments: the files (data URLs) and a small name/type/size list
-- that the history loads instead of the files themselves.
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS attachments LONGTEXT NULL;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS attachments_meta JSON NULL;


-- ============================================================
-- my-track2 merge: desktop/sync/agent/system-events/testing
-- (idempotent — IF NOT EXISTS / backfills; duplicates of shared
--  tables are skipped, only new tables & columns are applied)
-- ============================================================

-- MyTrack database schema
-- Run this once against an empty database (see scripts/migrate.js for an automated way)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  avatar MEDIUMTEXT NULL,
  action_password VARCHAR(255) NULL,
  require_password_delete TINYINT(1) NOT NULL DEFAULT 0,
  require_password_edit TINYINT(1) NOT NULL DEFAULT 0,
  sidebar_color VARCHAR(20) NULL,
  topbar_color VARCHAR(20) NULL,
  google_email VARCHAR(255) NULL,
  google_refresh_token TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Safe to re-run against a database created before these columns existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar MEDIUMTEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS action_password VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_password_delete TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_password_edit TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sidebar_color VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS topbar_color VARCHAR(20) NULL;
-- Lets "Backup" upload to the signed-in user's own Google Drive (OAuth)
-- instead of a service account's isolated storage.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT NULL;

CREATE TABLE IF NOT EXISTS tracks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  parent_id INT NULL,
  uuid CHAR(36) NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  icon MEDIUMTEXT NULL,
  icon_type VARCHAR(10) NOT NULL DEFAULT 'tag',
  color VARCHAR(20) DEFAULT '#35C2A6',
  page_size INT NOT NULL DEFAULT 25,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tracks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before parent_id existed.
-- Sub-track deletion cascades in application code (see the tracks DELETE route),
-- not via a DB foreign key, so this column intentionally has no FK of its own.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS parent_id INT NULL;
ALTER TABLE tracks ADD INDEX IF NOT EXISTS idx_tracks_parent (parent_id);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS page_size INT NOT NULL DEFAULT 25;
-- How a track lays out its entries: 'table' (the original), 'plain', 'grid' or 'doc'.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS view_type VARCHAR(10) NOT NULL DEFAULT 'table';

-- Safe to re-run against a database created before uuid existed. New tracks
-- get one from the app (crypto.randomUUID()); this backfills anything older,
-- and the track page route itself also lazily backfills as a last resort.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS uuid CHAR(36) NULL;
UPDATE tracks SET uuid = UUID() WHERE uuid IS NULL;
ALTER TABLE tracks ADD UNIQUE INDEX IF NOT EXISTS idx_tracks_uuid (uuid);

-- Safe to re-run against a database created before icon_type existed, or
-- before icon was widened to hold an icon-font class name or an uploaded
-- image (data URL) rather than just a short text tag.
ALTER TABLE tracks MODIFY COLUMN icon MEDIUMTEXT NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS icon_type VARCHAR(10) NOT NULL DEFAULT 'tag';

-- Safe to re-run against a database created before position existed — lets
-- siblings (same parent_id, including top-level tracks sharing NULL) be
-- drag-reordered relative to each other. Backfilled from the previous
-- created_at-DESC display order, but only for a sibling group that's still
-- untouched (MAX(position) = 0 across the whole group), so re-running this
-- never clobbers a manual reorder.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
UPDATE tracks t
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, COALESCE(parent_id, 0) ORDER BY created_at DESC, id DESC) - 1 AS rn
  FROM tracks
  WHERE (user_id, COALESCE(parent_id, 0)) IN (
    SELECT user_id, COALESCE(parent_id, 0) FROM tracks GROUP BY user_id, COALESCE(parent_id, 0) HAVING MAX(position) = 0
  )
) ranked ON ranked.id = t.id
SET t.position = ranked.rn;

CREATE TABLE IF NOT EXISTS track_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  track_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  options TEXT NULL,
  field_length VARCHAR(20) NULL,
  is_auto_increment TINYINT(1) NOT NULL DEFAULT 0,
  next_auto_value BIGINT NOT NULL DEFAULT 1,
  is_filterable TINYINT(1) NOT NULL DEFAULT 0,
  is_searchable TINYINT(1) NOT NULL DEFAULT 0,
  position INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_columns_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before these columns existed.
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS field_length VARCHAR(20) NULL;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_auto_increment TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS next_auto_value BIGINT NOT NULL DEFAULT 1;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_filterable TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS is_searchable TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS track_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  track_id INT NOT NULL,
  uuid CHAR(36) NULL,
  data JSON NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_entries_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Safe to re-run against a database created before uuid existed. New rows get
-- one from the app (crypto.randomUUID()); this backfills anything older.
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS uuid CHAR(36) NULL;
UPDATE track_entries SET uuid = UUID() WHERE uuid IS NULL;
ALTER TABLE track_entries ADD UNIQUE INDEX IF NOT EXISTS idx_entries_uuid (uuid);

-- Safe to re-run against a database created before position existed. Rows are
-- backfilled from their previous created_at-DESC display order, but only for
-- a track whose entries are ALL still at the position=0 default — a track
-- with any manual reordering already applied (max(position) > 0) is left
-- alone so re-running this script never clobbers a user's row order.
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
UPDATE track_entries te
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY created_at DESC, id DESC) - 1 AS rn
  FROM track_entries
  WHERE track_id IN (
    SELECT track_id FROM track_entries GROUP BY track_id HAVING MAX(position) = 0
  )
) ranked ON ranked.id = te.id
SET te.position = ranked.rn;

ALTER TABLE tracks ADD INDEX IF NOT EXISTS idx_tracks_user (user_id);
ALTER TABLE track_columns ADD INDEX IF NOT EXISTS idx_columns_track (track_id);
ALTER TABLE track_entries ADD INDEX IF NOT EXISTS idx_entries_track (track_id);

-- A locked entry's data is withheld from every read until the account's
-- privacy password is verified (see /api/tracks/:id/entries/:entryId PATCH).
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS is_locked TINYINT(1) NOT NULL DEFAULT 0;

-- Notes: same nested-tree shape as tracks (parent_id, uuid, position), but
-- each row holds one rich-text document instead of a table of entries.
CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  parent_id INT NULL,
  uuid CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NULL,
  style JSON NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE notes ADD UNIQUE INDEX IF NOT EXISTS idx_notes_uuid (uuid);
ALTER TABLE notes ADD INDEX IF NOT EXISTS idx_notes_user (user_id);
ALTER TABLE notes ADD INDEX IF NOT EXISTS idx_notes_parent (parent_id);

-- ---------------- Task assigner ----------------
-- A board is owned by its admin (owner_id). Members are other registered
-- users the admin adds, each with their own add / edit / delete rights.
-- visibility: 'private' → a member only sees tasks assigned to or created by
-- them; 'public' → every member sees every task on the board.
CREATE TABLE IF NOT EXISTS task_boards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  visibility VARCHAR(10) NOT NULL DEFAULT 'private',
  statuses JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_task_boards_uuid (uuid),
  KEY idx_task_boards_owner (owner_id),
  CONSTRAINT fk_task_boards_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_key VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  options TEXT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_columns_board (board_id),
  CONSTRAINT fk_task_columns_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  user_id INT NOT NULL,
  can_add TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_task_members_unique (board_id, user_id),
  KEY idx_task_members_user (user_id),
  CONSTRAINT fk_task_members_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Deleting a task is a soft delete (deleted_at) so the admin can revert it.
CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  board_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(50) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
  assignee_id INT NULL,
  due_date DATE NULL,
  data JSON NULL,
  created_by INT NULL,
  updated_by INT NULL,
  position INT NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_tasks_uuid (uuid),
  KEY idx_tasks_board (board_id),
  KEY idx_tasks_assignee (assignee_id),
  CONSTRAINT fk_tasks_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Every change on a board. `changes` is a list of
-- { key, label, old, new, oldText, newText } — raw values (for revert) plus
-- display text (user names, file names) captured at the time of the change.
CREATE TABLE IF NOT EXISTS task_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  task_id INT NULL,
  user_id INT NULL,
  user_name VARCHAR(255) NULL,
  action VARCHAR(30) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  changes JSON NULL,
  revert_of BIGINT NULL,
  reverted_by INT NULL,
  reverted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_activity_board (board_id, id),
  KEY idx_task_activity_task (task_id),
  CONSTRAINT fk_task_activity_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Display order of the board table's columns: built-in keys (title, status,
-- priority, assignee, due, updated) and custom columns as "c:<id>".
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS column_order JSON NULL;

-- Who set up an account on someone's behalf (Users page / "Create user" on a
-- task board). That creator can list and edit those accounts; NULL means the
-- person registered themselves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INT NULL;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_created_by (created_by);

-- Admins see and delete every user's tracker screenshots, and can make other
-- people admins from the Users page. The first one is set with
-- `npm run make-admin -- you@example.com`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) NOT NULL DEFAULT 0;

-- Menu items the user chose to hide (profile → Accessibility), as a JSON array of
-- ids from lib/menuItems.js. NULL shows everything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_menus VARCHAR(1000) NULL;

-- Code saver: named code files kept for reference.
CREATE TABLE IF NOT EXISTS code_snippets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  language VARCHAR(40) NOT NULL DEFAULT 'text',
  content LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_code_uuid (uuid),
  KEY idx_code_user (user_id),
  CONSTRAINT fk_code_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Code saver: a snapshot each time the user explicitly saves, so any two
-- states of a file can be compared later.
CREATE TABLE IF NOT EXISTS code_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snippet_id INT NOT NULL,
  label VARCHAR(255) NULL,
  language VARCHAR(40) NOT NULL DEFAULT 'text',
  content LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_code_versions_snippet (snippet_id, id),
  CONSTRAINT fk_code_versions_snippet FOREIGN KEY (snippet_id) REFERENCES code_snippets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Calendar: leave days (a range, inclusive) and a daily log of what was done.
CREATE TABLE IF NOT EXISTS calendar_leaves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type VARCHAR(20) NOT NULL DEFAULT 'casual',
  half_day TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_leaves_user_dates (user_id, start_date, end_date),
  CONSTRAINT fk_leaves_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS calendar_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  activity_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  title VARCHAR(255) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_activities_user_date (user_id, activity_date),
  CONSTRAINT fk_activities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Login audit: one row per successful login, with an optional webcam photo of
-- whoever signed in (captured client-side only if they allow the camera).
CREATE TABLE IF NOT EXISTS login_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  photo MEDIUMTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_login_events_uuid (uuid),
  KEY idx_login_events_user (user_id, created_at),
  CONSTRAINT fk_login_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Activity log: what each user did in MyTrack. Written automatically by the
-- API wrappers (lib/activityLog.js); older history is rebuilt once per user
-- from existing tables (source = 'history'). Task-board actions are read
-- straight from task_activity instead of being copied here.
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  action VARCHAR(20) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  url VARCHAR(500) NULL,
  ref VARCHAR(120) NULL,
  hits INT NOT NULL DEFAULT 1,
  source VARCHAR(10) NOT NULL DEFAULT 'live',
  history_key VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_activity_time (user_id, created_at),
  KEY idx_user_activity_ref (user_id, ref, updated_at),
  UNIQUE KEY idx_user_activity_history (user_id, history_key),
  CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Optional leading "Sr. No." column on a task board (set at creation).
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS show_serial TINYINT(1) NOT NULL DEFAULT 0;

-- IP Locator → IMEI tab: the user's own phones/laptops and their IMEIs, kept
-- so they're at hand for a police complaint or a CEIR block if one is lost.
CREATE TABLE IF NOT EXISTS user_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  imei CHAR(15) NOT NULL,
  imei2 CHAR(15) NULL,
  notes VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_user_devices_imei (user_id, imei),
  CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Last location a device reported about itself ("Share from this device" on
-- the IMEI tab, while that page is open on it).
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_lat DOUBLE NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_lon DOUBLE NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_accuracy FLOAT NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_ip VARCHAR(45) NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NULL;

-- Task board columns the admin hid from the task listing for everyone
-- (keys as in column_order: 'status', 'c:12', ...). Members can still hide
-- more for themselves; that choice stays in their browser.
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS hidden_columns JSON NULL;

-- Optional leading "Sr. No." column in a track's table (new tracks start with it on).
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS show_serial TINYINT(1) NOT NULL DEFAULT 0;

-- Notes on task activity entries. The logged change itself never changes;
-- adding or editing a note is logged as its own 'log_note' entry.
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note TEXT NULL;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note_by INT NULL;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS note_at TIMESTAMP NULL;
-- Throttle lookup for 'task_view' entries (one per person per task per 10 min).
ALTER TABLE task_activity ADD INDEX IF NOT EXISTS idx_task_activity_view (task_id, user_id, action, created_at);

-- Comments on task activity entries — a thread per log entry that any board
-- member can add to. Adding / editing / deleting one is itself logged
-- ('log_comment'), and @mentions notify the people named.
CREATE TABLE IF NOT EXISTS task_comments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  board_id INT NOT NULL,
  activity_id BIGINT NOT NULL,
  task_id INT NULL,
  user_id INT NULL,
  user_name VARCHAR(255) NULL,
  body TEXT NOT NULL,
  mentions JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  KEY idx_task_comments_activity (activity_id),
  CONSTRAINT fk_task_comments_board FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- In-app notifications (the 🔔 in the top bar) — e.g. "Ann mentioned you".
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  actor_id INT NULL,
  actor_name VARCHAR(255) NULL,
  kind VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  url VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (user_id, read_at, id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Comment attachments: the files (data URLs) and a small name/type/size list
-- that the history loads instead of the files themselves.
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS attachments LONGTEXT NULL;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS attachments_meta JSON NULL;

-- ===========================================================================
-- Testing feedback (Dashboard -> Testing feedback). An outside tool
-- (automation/ui_test.py) runs UI/responsive tests against a project's URL and
-- pushes the issues it finds here, so they show up in the dashboard with their
-- title, description and a screenshot. External calls use TESTER_API_TOKEN.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS test_projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  uuid CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  base_url VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_test_projects_uuid (uuid),
  KEY idx_test_projects_user (user_id),
  CONSTRAINT fk_test_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_feedback (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  run_id VARCHAR(40) NULL,
  url VARCHAR(500) NULL,
  screen VARCHAR(60) NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  screenshot_path VARCHAR(500) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_test_feedback_project (project_id, id),
  CONSTRAINT fk_test_feedback_project FOREIGN KEY (project_id) REFERENCES test_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------- Two-way sync (web <-> desktop) ----------------
-- Every synced table gets a global id (sync_id) and a last-changed time
-- (sync_at) that the database maintains itself; a delete leaves a tombstone.
-- lib/sync.js uses them to merge changes between two MyTrack installs.
CREATE TABLE IF NOT EXISTS sync_tombstones (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(64) NOT NULL,
  sync_id CHAR(36) NOT NULL,
  deleted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sync_tombstones_time (deleted_at),
  KEY idx_sync_tombstones_row (table_name, sync_id)
) ENGINE=InnoDB;

-- Keys other installs use to sync with this one (only a hash is stored).
CREATE TABLE IF NOT EXISTS sync_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  key_hint VARCHAR(12) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  UNIQUE KEY uq_sync_keys_hash (key_hash),
  CONSTRAINT fk_sync_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- This install's sync settings and progress (remote URL, key, cursors).
CREATE TABLE IF NOT EXISTS sync_state (
  k VARCHAR(64) PRIMARY KEY,
  v MEDIUMTEXT NULL
) ENGINE=InnoDB;

ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE users SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uq_users_sync_id (sync_id);
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_users_sync_ins BEFORE INSERT ON users FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_users_sync_del AFTER DELETE ON users FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('users', OLD.sync_id);
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE tracks SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE tracks ADD UNIQUE INDEX IF NOT EXISTS uq_tracks_sync_id (sync_id);
ALTER TABLE tracks ADD INDEX IF NOT EXISTS idx_tracks_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_tracks_sync_ins BEFORE INSERT ON tracks FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_tracks_sync_del AFTER DELETE ON tracks FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('tracks', OLD.sync_id);
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE track_columns ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE track_columns SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE track_columns ADD UNIQUE INDEX IF NOT EXISTS uq_track_columns_sync_id (sync_id);
ALTER TABLE track_columns ADD INDEX IF NOT EXISTS idx_track_columns_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_track_columns_sync_ins BEFORE INSERT ON track_columns FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_track_columns_sync_del AFTER DELETE ON track_columns FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('track_columns', OLD.sync_id);
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE track_entries ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE track_entries SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE track_entries ADD UNIQUE INDEX IF NOT EXISTS uq_track_entries_sync_id (sync_id);
ALTER TABLE track_entries ADD INDEX IF NOT EXISTS idx_track_entries_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_track_entries_sync_ins BEFORE INSERT ON track_entries FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_track_entries_sync_del AFTER DELETE ON track_entries FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('track_entries', OLD.sync_id);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE notes SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE notes ADD UNIQUE INDEX IF NOT EXISTS uq_notes_sync_id (sync_id);
ALTER TABLE notes ADD INDEX IF NOT EXISTS idx_notes_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_notes_sync_ins BEFORE INSERT ON notes FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_notes_sync_del AFTER DELETE ON notes FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('notes', OLD.sync_id);
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE task_boards ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE task_boards SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE task_boards ADD UNIQUE INDEX IF NOT EXISTS uq_task_boards_sync_id (sync_id);
ALTER TABLE task_boards ADD INDEX IF NOT EXISTS idx_task_boards_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_task_boards_sync_ins BEFORE INSERT ON task_boards FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_task_boards_sync_del AFTER DELETE ON task_boards FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('task_boards', OLD.sync_id);
ALTER TABLE task_columns ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE task_columns ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE task_columns SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE task_columns ADD UNIQUE INDEX IF NOT EXISTS uq_task_columns_sync_id (sync_id);
ALTER TABLE task_columns ADD INDEX IF NOT EXISTS idx_task_columns_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_task_columns_sync_ins BEFORE INSERT ON task_columns FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_task_columns_sync_del AFTER DELETE ON task_columns FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('task_columns', OLD.sync_id);
ALTER TABLE task_members ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE task_members ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE task_members SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE task_members ADD UNIQUE INDEX IF NOT EXISTS uq_task_members_sync_id (sync_id);
ALTER TABLE task_members ADD INDEX IF NOT EXISTS idx_task_members_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_task_members_sync_ins BEFORE INSERT ON task_members FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_task_members_sync_del AFTER DELETE ON task_members FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('task_members', OLD.sync_id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE tasks SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE tasks ADD UNIQUE INDEX IF NOT EXISTS uq_tasks_sync_id (sync_id);
ALTER TABLE tasks ADD INDEX IF NOT EXISTS idx_tasks_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_tasks_sync_ins BEFORE INSERT ON tasks FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_tasks_sync_del AFTER DELETE ON tasks FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('tasks', OLD.sync_id);
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE task_activity SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE task_activity ADD UNIQUE INDEX IF NOT EXISTS uq_task_activity_sync_id (sync_id);
ALTER TABLE task_activity ADD INDEX IF NOT EXISTS idx_task_activity_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_task_activity_sync_ins BEFORE INSERT ON task_activity FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_task_activity_sync_del AFTER DELETE ON task_activity FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('task_activity', OLD.sync_id);
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE task_comments SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE task_comments ADD UNIQUE INDEX IF NOT EXISTS uq_task_comments_sync_id (sync_id);
ALTER TABLE task_comments ADD INDEX IF NOT EXISTS idx_task_comments_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_task_comments_sync_ins BEFORE INSERT ON task_comments FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_task_comments_sync_del AFTER DELETE ON task_comments FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('task_comments', OLD.sync_id);
ALTER TABLE code_snippets ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE code_snippets ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE code_snippets SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE code_snippets ADD UNIQUE INDEX IF NOT EXISTS uq_code_snippets_sync_id (sync_id);
ALTER TABLE code_snippets ADD INDEX IF NOT EXISTS idx_code_snippets_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_code_snippets_sync_ins BEFORE INSERT ON code_snippets FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_code_snippets_sync_del AFTER DELETE ON code_snippets FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('code_snippets', OLD.sync_id);
ALTER TABLE code_versions ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE code_versions ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE code_versions SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE code_versions ADD UNIQUE INDEX IF NOT EXISTS uq_code_versions_sync_id (sync_id);
ALTER TABLE code_versions ADD INDEX IF NOT EXISTS idx_code_versions_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_code_versions_sync_ins BEFORE INSERT ON code_versions FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_code_versions_sync_del AFTER DELETE ON code_versions FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('code_versions', OLD.sync_id);
ALTER TABLE calendar_leaves ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE calendar_leaves ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE calendar_leaves SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE calendar_leaves ADD UNIQUE INDEX IF NOT EXISTS uq_calendar_leaves_sync_id (sync_id);
ALTER TABLE calendar_leaves ADD INDEX IF NOT EXISTS idx_calendar_leaves_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_calendar_leaves_sync_ins BEFORE INSERT ON calendar_leaves FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_calendar_leaves_sync_del AFTER DELETE ON calendar_leaves FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('calendar_leaves', OLD.sync_id);
ALTER TABLE calendar_activities ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE calendar_activities ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE calendar_activities SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE calendar_activities ADD UNIQUE INDEX IF NOT EXISTS uq_calendar_activities_sync_id (sync_id);
ALTER TABLE calendar_activities ADD INDEX IF NOT EXISTS idx_calendar_activities_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_calendar_activities_sync_ins BEFORE INSERT ON calendar_activities FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_calendar_activities_sync_del AFTER DELETE ON calendar_activities FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('calendar_activities', OLD.sync_id);
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE login_events SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE login_events ADD UNIQUE INDEX IF NOT EXISTS uq_login_events_sync_id (sync_id);
ALTER TABLE login_events ADD INDEX IF NOT EXISTS idx_login_events_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_login_events_sync_ins BEFORE INSERT ON login_events FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_login_events_sync_del AFTER DELETE ON login_events FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('login_events', OLD.sync_id);
ALTER TABLE user_activity ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE user_activity ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE user_activity SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE user_activity ADD UNIQUE INDEX IF NOT EXISTS uq_user_activity_sync_id (sync_id);
ALTER TABLE user_activity ADD INDEX IF NOT EXISTS idx_user_activity_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_user_activity_sync_ins BEFORE INSERT ON user_activity FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_user_activity_sync_del AFTER DELETE ON user_activity FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('user_activity', OLD.sync_id);
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE user_devices SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE user_devices ADD UNIQUE INDEX IF NOT EXISTS uq_user_devices_sync_id (sync_id);
ALTER TABLE user_devices ADD INDEX IF NOT EXISTS idx_user_devices_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_user_devices_sync_ins BEFORE INSERT ON user_devices FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_user_devices_sync_del AFTER DELETE ON user_devices FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('user_devices', OLD.sync_id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE notifications SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE notifications ADD UNIQUE INDEX IF NOT EXISTS uq_notifications_sync_id (sync_id);
ALTER TABLE notifications ADD INDEX IF NOT EXISTS idx_notifications_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_notifications_sync_ins BEFORE INSERT ON notifications FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_notifications_sync_del AFTER DELETE ON notifications FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('notifications', OLD.sync_id);
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE test_projects SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE test_projects ADD UNIQUE INDEX IF NOT EXISTS uq_test_projects_sync_id (sync_id);
ALTER TABLE test_projects ADD INDEX IF NOT EXISTS idx_test_projects_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_test_projects_sync_ins BEFORE INSERT ON test_projects FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_test_projects_sync_del AFTER DELETE ON test_projects FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('test_projects', OLD.sync_id);
ALTER TABLE test_feedback ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE test_feedback ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE test_feedback SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE test_feedback ADD UNIQUE INDEX IF NOT EXISTS uq_test_feedback_sync_id (sync_id);
ALTER TABLE test_feedback ADD INDEX IF NOT EXISTS idx_test_feedback_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_test_feedback_sync_ins BEFORE INSERT ON test_feedback FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_test_feedback_sync_del AFTER DELETE ON test_feedback FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('test_feedback', OLD.sync_id);

-- Login history tabs: what kind of entry each login_events row is, and where.
--   kind:   login (signed in) | app_open (desktop app opened while signed in)
--   source: web | desktop
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'login';
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS source VARCHAR(10) NULL;
UPDATE login_events SET kind = 'app_open', source = 'desktop' WHERE kind = 'login' AND user_agent LIKE 'MyTrack desktop — app opened%';

-- "System login" tab: someone started, signed in to, unlocked or woke the
-- computer the desktop app runs on — with a camera photo. Not tied to an
-- account (it's about the machine); admins see them.
CREATE TABLE IF NOT EXISTS system_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  device VARCHAR(255) NULL,
  os VARCHAR(50) NULL,
  photo MEDIUMTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_system_events_uuid (uuid),
  KEY idx_system_events_time (created_at)
) ENGINE=InnoDB;
ALTER TABLE system_events ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE system_events ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE system_events SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE system_events ADD UNIQUE INDEX IF NOT EXISTS uq_system_events_sync_id (sync_id);
ALTER TABLE system_events ADD INDEX IF NOT EXISTS idx_system_events_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_system_events_sync_ins BEFORE INSERT ON system_events FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_system_events_sync_del AFTER DELETE ON system_events FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('system_events', OLD.sync_id);

-- App lock: a separate password asked whenever MyTrack is opened or you come
-- back to it from another app / window / tab. NULL = app lock off.
ALTER TABLE users ADD COLUMN IF NOT EXISTS app_lock_password VARCHAR(255) NULL;

-- Track history: every change to a track, its columns and records, per track
-- (sub-tracks have their own). Record changes keep each field's old and new
-- value (lib/trackLog.js); a deleted record's data is kept in `snapshot` so it
-- can be restored. Notes on entries work like task_activity's.
CREATE TABLE IF NOT EXISTS track_activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  track_id INT NOT NULL,
  entry_id INT NULL,
  entry_uuid CHAR(36) NULL,
  entry_label VARCHAR(255) NULL,
  user_id INT NULL,
  user_name VARCHAR(255) NULL,
  action VARCHAR(30) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  changes LONGTEXT NULL,
  snapshot LONGTEXT NULL,
  revert_of BIGINT NULL,
  reverted_by INT NULL,
  reverted_at TIMESTAMP NULL,
  note TEXT NULL,
  note_by INT NULL,
  note_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_track_activity_track (track_id, id),
  KEY idx_track_activity_entry (entry_id)
) ENGINE=InnoDB;
-- History outlives the track: deleting a track (or sub-track) keeps its log,
-- so owner_id / track_name say whose it was and what it was called.
ALTER TABLE track_activity DROP FOREIGN KEY IF EXISTS fk_track_activity_track;
ALTER TABLE track_activity ADD COLUMN IF NOT EXISTS owner_id INT NULL;
ALTER TABLE track_activity ADD COLUMN IF NOT EXISTS track_name VARCHAR(255) NULL;
UPDATE track_activity a JOIN tracks t ON t.id = a.track_id SET a.owner_id = t.user_id, a.track_name = t.name WHERE a.owner_id IS NULL;
ALTER TABLE track_activity ADD INDEX IF NOT EXISTS idx_track_activity_owner (owner_id, id);

-- Screenshot tool: images shared by link (/api/shots/<token>). The image file
-- lives on disk under the shared-shots folder; this row says whose it is.
CREATE TABLE IF NOT EXISTS shared_screenshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token CHAR(32) NOT NULL,
  user_id INT NOT NULL,
  name VARCHAR(255) NULL,
  mime VARCHAR(50) NOT NULL,
  size INT NOT NULL DEFAULT 0,
  width INT NULL,
  height INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shared_screenshots_token (token),
  KEY idx_shared_screenshots_user (user_id, id)
) ENGINE=InnoDB;

-- ---------- Desktop apps linked to this server ----------
-- A Mac/PC running the MyTrack desktop app signs in to this server once and
-- gets a device key (token_hash = SHA-256 of it). It then syncs its user's
-- data every minute, uploads screenshots and system photos, and picks up the
-- settings / commands an admin set here.
CREATE TABLE IF NOT EXISTS desktop_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  name VARCHAR(255) NULL,
  os VARCHAR(50) NULL,
  app_version VARCHAR(50) NULL,
  token_hash CHAR(64) NOT NULL,
  settings LONGTEXT NULL,
  commands LONGTEXT NULL,
  status LONGTEXT NULL,
  last_seen_at TIMESTAMP NULL,
  last_sync_at TIMESTAMP NULL,
  last_ip VARCHAR(64) NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_desktop_devices_uuid (uuid),
  UNIQUE KEY uq_desktop_devices_token (token_hash),
  KEY idx_desktop_devices_user (user_id)
) ENGINE=InnoDB;

-- System photos uploaded by a linked desktop app: whose computer it was.
ALTER TABLE system_events ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE system_events ADD COLUMN IF NOT EXISTS device_id INT NULL;
ALTER TABLE system_events ADD INDEX IF NOT EXISTS idx_system_events_user (user_id, created_at);

-- Track history travels with sync too. A line can outlive its track, so the
-- track reference may be empty on the other side.
ALTER TABLE track_activity MODIFY track_id INT NULL;
ALTER TABLE track_activity ADD COLUMN IF NOT EXISTS sync_id CHAR(36) NULL;
ALTER TABLE track_activity ADD COLUMN IF NOT EXISTS sync_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);
UPDATE track_activity SET sync_id = UUID() WHERE sync_id IS NULL;
ALTER TABLE track_activity ADD UNIQUE INDEX IF NOT EXISTS uq_track_activity_sync_id (sync_id);
ALTER TABLE track_activity ADD INDEX IF NOT EXISTS idx_track_activity_sync_at (sync_at);
CREATE TRIGGER IF NOT EXISTS trg_track_activity_sync_ins BEFORE INSERT ON track_activity FOR EACH ROW SET NEW.sync_id = IFNULL(NEW.sync_id, UUID());
CREATE TRIGGER IF NOT EXISTS trg_track_activity_sync_del AFTER DELETE ON track_activity FOR EACH ROW INSERT INTO sync_tombstones (table_name, sync_id) VALUES ('track_activity', OLD.sync_id);
