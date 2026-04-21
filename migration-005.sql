-- migration-005: Seed superuser
INSERT OR IGNORE INTO users (id, email, role, stores, status, created_at)
VALUES (
  'usr_superuser_001',
  'bhoward@bargainlane.com',
  'superuser',
  NULL,
  'active',
  datetime('now')
);
