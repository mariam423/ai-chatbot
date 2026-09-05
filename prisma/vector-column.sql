-- OPT-IN PostgreSQL vector search setup (Pipeline 5 — Document RAG & pgvector).
--
-- The RAG pipeline ships with zero-dependency hash embeddings (TEXT column,
-- in-memory cosine scoring). To enable DATABASE-SIDE cosine similarity over
-- an indexed vector column, run this script ONCE against your Postgres
-- database, then set `RAG_VECTOR_MODE=pgvector` in the app environment.
--
-- Prerequisites: your Postgres provider must support the pgvector extension
-- (Neon, Supabase, AWS RDS with the extension enabled, or a local install).
-- Applying this file is a no-op if the column already exists.
--
--   psql "$DATABASE_URL" -f prisma/vector-column.sql
--   # then set RAG_VECTOR_MODE=pgvector (+ optional RAG_VECTOR_MIN_SIMILARITY, default 0.75)
--
-- The embedding source is unchanged (deterministic 128-dim local vectors), so
-- scores are identical to the hash path; this only moves the heavy lifting
-- into the database with an HNSW index. If this script has NOT been applied,
-- the app transparently falls back to hash search and logs a warning.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector vector(128);

-- HNSW index for approximate nearest-neighbour cosine search. ivfflat is the
-- alternative if HNSW memory is a concern on large corpora:
--   CREATE INDEX IF NOT EXISTS document_chunks_embedding_vector_idx
--     ON document_chunks USING ivfflat (embedding_vector vector_cosine_ops)
--     WITH (lists = 100);
CREATE INDEX IF NOT EXISTS document_chunks_embedding_vector_idx
  ON document_chunks USING hnsw (embedding_vector vector_cosine_ops);