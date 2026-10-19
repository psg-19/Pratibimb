-- Pratibimb schema. Times are epoch minutes (simulated clock) unless named *_at_ms.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  age INTEGER,
  years_t2d INTEGER,
  city TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  pronoun TEXT NOT NULL DEFAULT 'they',
  meds_short TEXT NOT NULL DEFAULT '',
  meds_long TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT 'b',
  abha_suffix TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  -- 'synthetic' (simulated sensor), 'imported' (uploaded CGM export) or 'empty'
  data_mode TEXT NOT NULL DEFAULT 'empty',
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient', 'clinician')),
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at_ms INTEGER NOT NULL
);

-- Hidden "true" physiology and sensor state of synthetic patients (never shown to the twin).
CREATE TABLE IF NOT EXISTS truth (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  params TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  seed INTEGER NOT NULL,
  sensor_end INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'walk', 'med', 'sleep', 'illness')),
  t INTEGER NOT NULL,
  duration INTEGER,
  carbs REAL,
  true_carbs REAL,
  speed REAL,
  drug TEXT,
  dose REAL,
  severity REAL,
  steps INTEGER,
  label TEXT,
  note TEXT,
  source TEXT,
  -- 1 = known only to the truth simulation (an unlogged meal)
  hidden INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_patient_time ON events (patient_id, t);

CREATE TABLE IF NOT EXISTS readings (
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  mgdl INTEGER NOT NULL,
  PRIMARY KEY (patient_id, t)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS vitals (
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  steps INTEGER,
  resting_hr INTEGER,
  PRIMARY KEY (patient_id, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lab', 'medication')),
  name TEXT NOT NULL,
  value REAL,
  unit TEXT,
  detail TEXT,
  source TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (patient_id, source)
);

CREATE TABLE IF NOT EXISTS consents (
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent TEXT NOT NULL,
  granted INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (patient_id, consent)
);

CREATE TABLE IF NOT EXISTS twins (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  params TEXT NOT NULL,
  log_sd TEXT NOT NULL,
  fit TEXT NOT NULL,
  calibration TEXT NOT NULL,
  routine TEXT NOT NULL,
  insights TEXT NOT NULL,
  -- simulated time of the fit
  fitted_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('predicted-low', 'predicted-high', 'cgm-low')),
  issued_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'snack', 'team', 'dismissed')),
  handled_at INTEGER,
  window_from INTEGER,
  window_to INTEGER,
  lowest REAL,
  lowest_at INTEGER,
  probability REAL,
  drivers TEXT NOT NULL DEFAULT '[]',
  snack_event_id INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_by_patient ON alerts (patient_id, issued_at);

CREATE TABLE IF NOT EXISTS reviews (
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  night TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'reviewed', 'acted')),
  note TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (patient_id, night)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('clinician', 'twin', 'patient')),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  kind TEXT NOT NULL DEFAULT 'message',
  sent_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  input TEXT NOT NULL,
  peak REAL NOT NULL,
  above_min INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  anchor_sim REAL NOT NULL,
  anchor_wall_ms INTEGER NOT NULL,
  speed REAL NOT NULL,
  paused INTEGER NOT NULL,
  demo_start INTEGER NOT NULL
);
