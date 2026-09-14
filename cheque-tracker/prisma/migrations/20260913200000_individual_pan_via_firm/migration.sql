-- ============================================================================
-- An individual's PAN, if any, belongs to the firm they're affiliated
-- with — never entered directly on the individual (individuals frequently
-- have no PAN of their own at all in practice). This clears any panNo that
-- was previously entered directly on an INDIVIDUAL party, now that the app
-- no longer offers that field for individuals and always reads their PAN
-- from party.firm.panNo instead.
-- ============================================================================

UPDATE "Party" SET "panNo" = NULL WHERE "type" = 'INDIVIDUAL' AND "panNo" IS NOT NULL;
