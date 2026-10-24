CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE member_role AS ENUM ('owner', 'editor', 'commenter', 'viewer');
CREATE TYPE file_kind AS ENUM ('design', 'diagram', 'board');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    avatar_color CHAR(7) NOT NULL DEFAULT '#5D1C16' CHECK (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL,
    slug VARCHAR(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role member_role NOT NULL DEFAULT 'editor',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, name)
);

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    kind file_kind NOT NULL DEFAULT 'design',
    thumbnail BYTEA CHECK (thumbnail IS NULL OR octet_length(thumbnail) <= 524288),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX files_project_idx ON files (project_id) WHERE deleted_at IS NULL;
CREATE INDEX files_updated_idx ON files (updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE file_permissions (
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role member_role NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, user_id)
);

CREATE TABLE share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    token CHAR(43) NOT NULL UNIQUE,
    role member_role NOT NULL DEFAULT 'viewer' CHECK (role <> 'owner'),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_states (
    file_id UUID PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    state BYTEA NOT NULL,
    state_vector BYTEA NOT NULL,
    last_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
    size_bytes INTEGER GENERATED ALWAYS AS (octet_length(state)) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_updates (
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq > 0),
    payload BYTEA NOT NULL CHECK (octet_length(payload) <= 8388608),
    origin_client BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, seq)
);

CREATE TABLE versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    label VARCHAR(120) NOT NULL,
    state BYTEA NOT NULL,
    seq BIGINT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX versions_file_idx ON versions (file_id, created_at DESC);

CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    page_id VARCHAR(64) NOT NULL,
    node_id VARCHAR(64),
    x DOUBLE PRECISION NOT NULL DEFAULT 0,
    y DOUBLE PRECISION NOT NULL DEFAULT 0,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(80) NOT NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_file_idx ON comments (file_id, created_at);

CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sha256 CHAR(64) NOT NULL,
    mime VARCHAR(64) NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (file_id, sha256)
);

CREATE TABLE library_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (file_id, node_id)
);

CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(columns) = 'array'),
    rows JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (file_id, name)
);
