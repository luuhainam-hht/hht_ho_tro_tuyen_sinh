-- =============================================================================
-- HHT Tuyển sinh AI – lược đồ PostgreSQL 14+ (Neon tương thích, KHÔNG bắt buộc extension)
-- Idempotent: chạy lại mỗi lần khởi động. TIMESTAMPTZ cho mọi mốc thời gian; CHECK cho mọi
-- cột trạng thái; ON DELETE ghi rõ; index cho cột lọc/JOIN; trigger updated_at.
--
-- Vì sao không dùng pgvector/unaccent bắt buộc: ngân sách 10 triệu/năm, kho tri thức của một
-- trường chỉ vài nghìn đoạn -> embedding lưu REAL[], cosine tính trong Node (cache theo
-- phiên bản kho). Bỏ dấu tiếng Việt làm ở Node (content_norm) nên không cần unaccent.
-- Khi kho lớn (> ~50.000 đoạn) mới cần chuyển sang pgvector + HNSW (xem docs/KIEN-TRUC.md).
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Cán bộ & phiên đăng nhập
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff (
  id                     BIGSERIAL PRIMARY KEY,
  username               TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,50}$'),
  password_hash          TEXT NOT NULL,
  full_name              TEXT NOT NULL,
  email                  TEXT,
  role                   TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR')),
  faculty                TEXT,                         -- bắt buộc với vai trò FACULTY: chỉ quản lý ngành của khoa này
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts  INT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until           TIMESTAMPTZ,
  must_change_password   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff (role);

-- Chỉ lưu SHA-256 của token: lộ CSDL không lộ phiên đăng nhập.
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash    TEXT PRIMARY KEY,
  staff_id      BIGINT NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'LEADER', 'ADMISSION_OFFICE', 'FACULTY', 'ADVISOR')),
  expires_at    TIMESTAMPTZ NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff_id   ON staff_sessions (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires_at ON staff_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Tham số nghiệp vụ (sửa qua Admin, không cần deploy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_configs (
  key          TEXT PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]*$'),
  value        TEXT NOT NULL,
  value_type   TEXT NOT NULL CHECK (value_type IN ('INT', 'NUMBER', 'BOOL', 'STRING', 'TIME', 'LIST', 'JSON')),
  min_bound    NUMERIC,
  max_bound    NUMERIC,
  description  TEXT NOT NULL DEFAULT '',
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,     -- được trả cho trang công khai (hotline, lời chào…)
  updated_by   BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_bound IS NULL OR max_bound IS NULL OR min_bound <= max_bound)
);
CREATE INDEX IF NOT EXISTS idx_system_configs_updated_by ON system_configs (updated_by);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('KB_DOCUMENT', 'FAQ', 'MAJOR', 'HANDOFF', 'CONFIG',
                                                    'STAFF', 'SYSTEM', 'APPOINTMENT', 'ADMISSION_ITEM', 'AI', 'AI_KEY')),
  target_id    TEXT,
  reason       TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor      ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target     ON audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

-- ---------------------------------------------------------------------------
-- M2 – Kho tri thức (chỉ văn bản tuyển sinh chính thức, có phiên bản theo năm)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_documents (
  id                    BIGSERIAL PRIMARY KEY,
  title                 TEXT NOT NULL,
  doc_no                TEXT,                         -- số/ký hiệu văn bản
  source_code           TEXT UNIQUE,                  -- S01… (nguồn trong bộ dữ liệu thu thập)
  issued_date           DATE,
  admission_year        INT NOT NULL CHECK (admission_year BETWEEN 2020 AND 2100),
  source_url            TEXT,
  reliability           CHAR(1) CHECK (reliability IN ('A', 'B', 'C', 'D')),
  file_name             TEXT,
  file_path             TEXT,
  file_sha256           TEXT UNIQUE,                  -- trùng file -> từ chối upload
  mime                  TEXT,
  status                TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'ARCHIVED', 'FAILED')),
  error                 TEXT,
  chunk_count           INT NOT NULL DEFAULT 0,
  replaces_document_id  BIGINT REFERENCES kb_documents (id) ON DELETE SET NULL,
  uploaded_by           BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  published_by          BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_status_year ON kb_documents (status, admission_year);
CREATE INDEX IF NOT EXISTS idx_kb_documents_replaces    ON kb_documents (replaces_document_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_uploaded_by ON kb_documents (uploaded_by);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id               BIGSERIAL PRIMARY KEY,
  document_id      BIGINT NOT NULL REFERENCES kb_documents (id) ON DELETE CASCADE,
  chunk_index      INT NOT NULL CHECK (chunk_index >= 0),
  heading_path     TEXT NOT NULL DEFAULT '',
  page_from        INT,
  page_to          INT,
  content          TEXT NOT NULL,
  content_norm     TEXT NOT NULL,                     -- chữ thường, bỏ dấu (Node) -> khớp "hoc phi" lẫn "học phí"
  token_count      INT NOT NULL DEFAULT 0,
  embedding        REAL[],
  embedding_model  TEXT,
  tsv              TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content_norm)) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS faq_entries (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT UNIQUE,                        -- Q01… từ bộ dữ liệu; NULL với FAQ tạo từ chuyển cán bộ
  topic           TEXT NOT NULL DEFAULT 'KHAC',
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  variants        JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_text_norm TEXT NOT NULL DEFAULT '',           -- câu hỏi + biến thể đã chuẩn hóa
  embedding       REAL[],
  embedding_model TEXT,
  applies_to      TEXT,
  source_codes    TEXT[] NOT NULL DEFAULT '{}',
  reliability     CHAR(1) CHECK (reliability IN ('A', 'B', 'C', 'D')),
  internal_note   TEXT,                               -- không bao giờ trả cho người dùng
  document_id     BIGINT REFERENCES kb_documents (id) ON DELETE SET NULL,
  admission_year  INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'ARCHIVED')),
  created_by      BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  approved_by     BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_faq_status_year ON faq_entries (status, admission_year);
CREATE INDEX IF NOT EXISTS idx_faq_topic       ON faq_entries (topic);
CREATE INDEX IF NOT EXISTS idx_faq_document_id ON faq_entries (document_id);

-- ---------------------------------------------------------------------------
-- M3 – Cẩm nang số: ngành và mục tuyển sinh
-- ---------------------------------------------------------------------------
-- levels là mảng vì một nghề tuyển ở nhiều hệ (9+, Trung cấp, Cao đẳng, Sơ cấp).
CREATE TABLE IF NOT EXISTS majors (
  code                     TEXT PRIMARY KEY,
  occupation_code          TEXT,                       -- mã nghề nhà nước (có thể chưa xác minh)
  name                     TEXT NOT NULL,
  faculty                  TEXT NOT NULL,
  levels                   TEXT[] NOT NULL DEFAULT '{}'
                           CHECK (levels <@ ARRAY['HE_9_PLUS', 'TRUNG_CAP', 'CAO_DANG', 'SO_CAP']::text[]),
  levels_latest            TEXT[] NOT NULL DEFAULT '{}',
  listed_in_latest_table   BOOLEAN NOT NULL DEFAULT TRUE,
  description              TEXT NOT NULL DEFAULT '',
  quota                    INT CHECK (quota IS NULL OR quota >= 0),
  quota_9plus_cs1          INT CHECK (quota_9plus_cs1 IS NULL OR quota_9plus_cs1 >= 0),
  quota_9plus_cs2          INT CHECK (quota_9plus_cs2 IS NULL OR quota_9plus_cs2 >= 0),
  tuition_per_month_min    INT,
  tuition_per_month_max    INT,
  state_support            TEXT,
  enterprise_support       TEXT,
  support_needs_verify     BOOLEAN NOT NULL DEFAULT FALSE,
  duration                 TEXT,
  admission_methods        JSONB NOT NULL DEFAULT '[]'::jsonb,
  career_paths             JSONB NOT NULL DEFAULT '[]'::jsonb,
  skills                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_styles              TEXT[] NOT NULL DEFAULT '{}',          -- WORKSHOP | OFFICE | PEOPLE | OUTDOOR | CREATIVE
  riasec_profile           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {R,I,A,S,E,C: 0–1}
  subject_weights          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {TOAN: 0–1, …}
  profile_is_sample        BOOLEAN NOT NULL DEFAULT TRUE,        -- hồ sơ RIASEC do nhóm đề tài gán, chờ chuyên gia rà soát
  source_codes             TEXT[] NOT NULL DEFAULT '{}',
  internal_note            TEXT,
  admission_year           INT NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  document_id              BIGINT REFERENCES kb_documents (id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_majors_active_year ON majors (is_active, admission_year);
CREATE INDEX IF NOT EXISTS idx_majors_faculty     ON majors (faculty);
CREATE INDEX IF NOT EXISTS idx_majors_levels      ON majors USING GIN (levels);
CREATE INDEX IF NOT EXISTS idx_majors_document_id ON majors (document_id);

CREATE TABLE IF NOT EXISTS admission_items (
  id              BIGSERIAL PRIMARY KEY,
  item_key        TEXT NOT NULL UNIQUE,                -- khóa tự nhiên để seed idempotent
  kind            TEXT NOT NULL CHECK (kind IN ('DOC_CHECKLIST', 'SCHEDULE', 'ONLINE_GUIDE_STEP', 'CONTACT', 'LEVEL_INFO', 'SUPPORT_INFO')),
  audience        TEXT NOT NULL DEFAULT 'ALL',         -- CHINH_QUY | HE_9_PLUS | BO_DOI | nhãn nhóm lịch/liên hệ
  major_code      TEXT REFERENCES majors (code) ON DELETE SET NULL,   -- NULL = mọi ngành
  code            TEXT,                                -- mã giấy tờ (DOC_CHECKLIST)
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL DEFAULT '',
  is_mandatory    BOOLEAN,
  copy_type       TEXT CHECK (copy_type IN ('ORIGINAL', 'COPY', 'CERTIFIED_COPY', 'ORIGINAL_AND_COPY', 'FORM', 'PHOTO')),
  quantity        SMALLINT CHECK (quantity IS NULL OR quantity > 0),
  note            TEXT,
  internal_note   TEXT,
  order_no        INT NOT NULL DEFAULT 0,
  date_from       DATE,
  date_to         DATE,
  source_codes    TEXT[] NOT NULL DEFAULT '{}',
  document_id     BIGINT REFERENCES kb_documents (id) ON DELETE SET NULL,
  admission_year  INT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
);
CREATE INDEX IF NOT EXISTS idx_admission_items_lookup ON admission_items (admission_year, kind, audience);
CREATE INDEX IF NOT EXISTS idx_admission_items_major  ON admission_items (major_code);
CREATE INDEX IF NOT EXISTS idx_admission_items_doc    ON admission_items (document_id);

-- ---------------------------------------------------------------------------
-- M1 – Hội thoại
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id             UUID PRIMARY KEY,
  channel        TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'FANPAGE')),
  visitor_hash   TEXT,                                 -- HMAC theo ngày, không lưu IP thô
  external_ref   TEXT,                                 -- băm PSID Messenger
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_count  INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_at  ON chat_sessions (last_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor  ON chat_sessions (visitor_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_external ON chat_sessions (channel, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_messages (
  id               BIGSERIAL PRIMARY KEY,
  session_id       UUID NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content          TEXT NOT NULL,
  source           TEXT CHECK (source IN ('RULE', 'FAQ', 'RAG', 'CACHE', 'FALLBACK', 'HANDOFF', 'WEB')),
  answer_mode      TEXT CHECK (answer_mode IN ('LLM', 'EXTRACTIVE')),
  intent           TEXT,
  topics           TEXT[] NOT NULL DEFAULT '{}',
  major_codes      TEXT[] NOT NULL DEFAULT '{}',
  cited_chunk_ids  BIGINT[] NOT NULL DEFAULT '{}',
  faq_id           BIGINT REFERENCES faq_entries (id) ON DELETE SET NULL,
  top_score        REAL,
  latency_ms       INT,
  tokens_in        INT NOT NULL DEFAULT 0,
  tokens_out       INT NOT NULL DEFAULT 0,
  rating           SMALLINT CHECK (rating IN (-1, 1)),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role = 'ASSISTANT' OR source IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session    ON chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_source     ON chat_messages (source, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_faq_id     ON chat_messages (faq_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_topics     ON chat_messages USING GIN (topics);
CREATE INDEX IF NOT EXISTS idx_chat_messages_majors     ON chat_messages USING GIN (major_codes);

-- Cache câu trả lời LLM: khóa gồm phiên bản kho -> publish tài liệu mới là cache tự hết hiệu lực.
CREATE TABLE IF NOT EXISTS answer_cache (
  question_hash  TEXT NOT NULL,
  kb_version     TEXT NOT NULL,
  answer         TEXT NOT NULL,
  citations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,
  hit_count      INT NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_hash, kb_version)
);
CREATE INDEX IF NOT EXISTS idx_answer_cache_expires ON answer_cache (expires_at);

CREATE TABLE IF NOT EXISTS token_usage_daily (
  day         DATE PRIMARY KEY,
  tokens_in   BIGINT NOT NULL DEFAULT 0,
  tokens_out  BIGINT NOT NULL DEFAULT 0,
  requests    INT NOT NULL DEFAULT 0
);

-- Khóa API AI do Quản trị viên thêm qua giao diện. Chỉ lưu bản MÃ HÓA (AES-256-GCM) + 4 ký tự cuối để nhận diện;
-- key_hash (SHA-256) chống thêm trùng mà không cần giải mã. Khóa trong .env vẫn dùng song song.
CREATE TABLE IF NOT EXISTS ai_api_keys (
  id                 BIGSERIAL PRIMARY KEY,
  label              TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  provider           TEXT NOT NULL DEFAULT 'GEMINI' CHECK (provider IN ('GEMINI')),
  key_cipher         TEXT NOT NULL,
  key_hash           TEXT NOT NULL UNIQUE,
  key_hint           TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_test_at       TIMESTAMPTZ,
  last_test_ok       BOOLEAN,
  last_test_message  TEXT,
  created_by         BIGINT REFERENCES staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chuyển cán bộ: chỉ lưu liên hệ khi thí sinh tự đồng ý.
CREATE TABLE IF NOT EXISTS handoff_requests (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID REFERENCES chat_sessions (id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  contact_name    TEXT,
  contact_phone   TEXT,
  contact_email   TEXT,
  consent         BOOLEAN NOT NULL CHECK (consent),
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ASSIGNED', 'ANSWERED', 'CLOSED')),
  assigned_to     BIGINT REFERENCES staff (id) ON DELETE SET NULL,
  answer          TEXT,
  answered_at     TIMESTAMPTZ,
  promote_to_faq  BOOLEAN NOT NULL DEFAULT FALSE,
  faq_id          BIGINT REFERENCES faq_entries (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL),
  CHECK (status <> 'ANSWERED' OR (answer IS NOT NULL AND answered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_handoff_status      ON handoff_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_handoff_assigned_to ON handoff_requests (assigned_to);
CREATE INDEX IF NOT EXISTS idx_handoff_session     ON handoff_requests (session_id);
CREATE INDEX IF NOT EXISTS idx_handoff_faq         ON handoff_requests (faq_id);

-- ---------------------------------------------------------------------------
-- M4 – Gợi ý ngành
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendation_sessions (
  id             UUID PRIMARY KEY,
  session_id     UUID REFERENCES chat_sessions (id) ON DELETE SET NULL,
  visitor_hash   TEXT,
  answers        JSONB NOT NULL,
  riasec_scores  JSONB NOT NULL,
  results        JSONB NOT NULL,                 -- [{majorCode, score, parts, reasons}]
  explanation    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recommendation_created ON recommendation_sessions (created_at);
CREATE INDEX IF NOT EXISTS idx_recommendation_session ON recommendation_sessions (session_id);

-- ---------------------------------------------------------------------------
-- Hàng việc nền (trạng thái nằm trong DB: khởi động lại không mất việc)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('INGEST_DOCUMENT', 'REEMBED_ALL', 'CLASSIFY_MESSAGES',
                                             'PURGE_OLD_DATA', 'GENERATE_SLOTS', 'APPOINTMENT_NO_SHOW')),
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key   TEXT UNIQUE,                     -- tác vụ hằng ngày: 'PURGE_OLD_DATA:2026-11-15'
  status       TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by    TEXT,
  locked_at    TIMESTAMPTZ,
  last_error   TEXT,
  result       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs (status, run_after);

-- ---------------------------------------------------------------------------
-- M6 (nhánh ở nhà) – Đặt lịch hẹn nộp hồ sơ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holidays (
  day     DATE PRIMARY KEY,
  reason  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointment_slots (
  id            BIGSERIAL PRIMARY KEY,
  slot_date     DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  capacity      INT NOT NULL CHECK (capacity BETWEEN 0 AND 1000),
  booked_count  INT NOT NULL DEFAULT 0,
  is_closed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_date, start_time),
  CHECK (start_time < end_time),
  CHECK (booked_count BETWEEN 0 AND capacity)
);
CREATE INDEX IF NOT EXISTS idx_slots_date ON appointment_slots (slot_date);

CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID PRIMARY KEY,
  code                VARCHAR(12) NOT NULL UNIQUE CHECK (code ~ '^HS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  slot_id             BIGINT NOT NULL REFERENCES appointment_slots (id) ON DELETE RESTRICT,
  audience            TEXT NOT NULL CHECK (audience IN ('CHINH_QUY', 'HE_9_PLUS', 'BO_DOI')),
  major_code          TEXT REFERENCES majors (code) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'BOOKED'
                      CHECK (status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  checklist_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_name        TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,
  consent             BOOLEAN NOT NULL DEFAULT FALSE,
  visitor_hash        TEXT,
  reschedule_count    INT NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  checked_in_at       TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (consent OR (contact_phone IS NULL AND contact_email IS NULL)),
  CHECK (status <> 'CHECKED_IN' OR checked_in_at IS NOT NULL),
  CHECK (status <> 'COMPLETED'  OR completed_at IS NOT NULL),
  CHECK (status <> 'CANCELLED'  OR cancelled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_appointments_slot_status    ON appointments (slot_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_visitor_status ON appointments (visitor_hash, status);
CREATE INDEX IF NOT EXISTS idx_appointments_phone_status   ON appointments (contact_phone, status);
CREATE INDEX IF NOT EXISTS idx_appointments_major          ON appointments (major_code);

CREATE TABLE IF NOT EXISTS appointment_history (
  id              BIGSERIAL PRIMARY KEY,
  appointment_id  UUID NOT NULL REFERENCES appointments (id) ON DELETE CASCADE,
  from_status     TEXT CHECK (from_status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  to_status       TEXT NOT NULL CHECK (to_status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  actor_id        BIGINT REFERENCES staff (id) ON DELETE SET NULL,   -- NULL = thí sinh/hệ thống
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_history_appt  ON appointment_history (appointment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appointment_history_actor ON appointment_history (actor_id);

-- ---------------------------------------------------------------------------
-- Phiên bản kho tri thức: đổi khi publish/archive tài liệu hoặc duyệt/sửa FAQ của năm hiện hành.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_kb_version AS
SELECT md5(
  COALESCE((SELECT string_agg(d.id || ':' || d.updated_at::text, ',' ORDER BY d.id)
              FROM kb_documents d
             WHERE d.status = 'PUBLISHED'
               AND d.admission_year = (SELECT value::int FROM system_configs WHERE key = 'CURRENT_ADMISSION_YEAR')), '')
  || '|' ||
  COALESCE((SELECT max(f.updated_at)::text FROM faq_entries f WHERE f.status = 'APPROVED'), '')
  -- Ngành và mục cẩm nang (đợt nhận hồ sơ, liên hệ…) cũng là tri thức trả lời: Phòng Tuyển sinh/Khoa sửa
  -- là bộ nhớ đệm câu trả lời tự hết hiệu lực.
  || '|' || COALESCE((SELECT max(m.updated_at)::text FROM majors m), '')
  || '|' || COALESCE((SELECT max(i.updated_at)::text || ':' || count(*)::text FROM admission_items i), '')
) AS kb_version;

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff', 'system_configs', 'kb_documents', 'faq_entries', 'majors', 'admission_items',
                           'handoff_requests', 'jobs', 'appointment_slots', 'appointments', 'ai_api_keys']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;
