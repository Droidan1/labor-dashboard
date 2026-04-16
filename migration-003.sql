-- migration-003: Track original item name for sale-name restoration
ALTER TABLE sale_schedules ADD COLUMN original_name TEXT;
