-- ISSUE-189 hardening (user-approved 2026-08-22), REDESIGNED by the
-- hundred-fifteenth-pass review:
--
--   · (event_type, session_id, created_at) serves the checkout-started
--     dedupe (eq/eq/range) AND strictly supersedes the original
--     (event_type, created_at) index — which is therefore DROPPED, so
--     the hottest insert path maintains TWO secondaries, not four. A
--     session_id-LED index was the first draft and was rejected: its
--     random uuid leading column dirties a random B-tree page per
--     product view while serving <1% of rows.
--
--   · (created_at, event_type, session_id) makes the dashboard's
--     range-filtered aggregations (per-event distinct sessions, funnel
--     counts) index-only — a bare (created_at) was the first draft and
--     covered neither, so the planner would have seq-scanned anyway.
--
-- ⚠️ Deploy note: plain CREATE INDEX locks funnel_events against writes
-- for the build. Fine while the table is small; on a populated
-- production table this wants CONCURRENTLY in its own non-transactional
-- migration (Prisma wraps this file in a transaction).

-- DropIndex
DROP INDEX "funnel_events_event_type_created_at_idx";

-- CreateIndex
CREATE INDEX "funnel_events_event_type_session_id_created_at_idx" ON "funnel_events"("event_type", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "funnel_events_created_at_event_type_session_id_idx" ON "funnel_events"("created_at", "event_type", "session_id");
