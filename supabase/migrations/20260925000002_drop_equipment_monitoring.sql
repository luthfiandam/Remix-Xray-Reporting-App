-- ==============================================================================
-- CLEANUP / ROLLBACK: DROP EQUIPMENT MONITORING TABLES IF THEY EXIST
-- ==============================================================================

DROP TABLE IF EXISTS public.equipment_monitoring_history CASCADE;
DROP TABLE IF EXISTS public.equipment_monitoring CASCADE;
