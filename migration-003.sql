-- migration-003: Track original item name for sale-name restoration + optional sale label
ALTER TABLE sale_schedules ADD COLUMN original_name TEXT;
ALTER TABLE sale_schedules ADD COLUMN sale_label TEXT;
