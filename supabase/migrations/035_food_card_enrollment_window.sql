-- 035_food_card_enrollment_window.sql
-- Adds Director-configurable opening and closing date window for Food Cards in system_config.

INSERT INTO system_config (key, value, description) VALUES
  ('food_card_open_from',  '2026-01-01', 'Opening date for Food Card registration window (YYYY-MM-DD). Customers cannot open a Food Card before this date.'),
  ('food_card_open_until', '2026-11-30', 'Closing date for Food Card registration window (YYYY-MM-DD). Customers cannot open a Food Card after this date.')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description;
