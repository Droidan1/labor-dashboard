-- migration-017: Flow Calendar spanning bands (the bottom of the F26 sheet).
-- The weekly rows live in marketing_flow (migration-016). This table holds the
-- multi-week "band" rows: seasonal launch lifecycles (OTS->Production->Set->
-- SL->Clearance), End Cap Focus, Leadership Training, and Beyond Bargains.
-- One row per band segment; grouped into display rows by (sort_order, row_label).
-- Spans/colors are best-effort transcribed from the sheet and editable later.
-- Apply: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-017.sql

CREATE TABLE IF NOT EXISTS flow_segments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year  TEXT NOT NULL DEFAULT 'F26',
  sort_order   INTEGER NOT NULL,   -- row order in the matrix
  row_label    TEXT NOT NULL,      -- left-column label for the band row
  section      TEXT,               -- 'seasonal' | 'program'
  start_week   INTEGER NOT NULL,   -- 14..52
  end_week     INTEGER NOT NULL,
  label        TEXT,               -- text shown inside the band
  color        TEXT NOT NULL,      -- key: sl|ots|prod|set|clr|otb|focus|endcap|lead|beyondB|beyondO
  detail       TEXT                -- optional (pallet/unit notes etc.)
);

CREATE INDEX IF NOT EXISTS idx_flow_seg ON flow_segments(fiscal_year, sort_order, start_week);

DELETE FROM flow_segments WHERE fiscal_year = 'F26';

INSERT INTO flow_segments (fiscal_year, sort_order, row_label, section, start_week, end_week, label, color) VALUES
  ('F26',10,'SL · Spring Apparel','seasonal',14,30,'SL: Spring Summer Apparel','sl'),
  ('F26',10,'SL · Spring Apparel','seasonal',31,35,'Summer Clearance','clr'),
  ('F26',20,'SL · Spring Footwear','seasonal',14,30,'SL: Spring Summer Footwear','sl'),
  ('F26',20,'SL · Spring Footwear','seasonal',31,35,'Summer Clearance','clr'),
  ('F26',30,'SL · Easter','seasonal',14,14,'SL: Easter','sl'),
  ('F26',30,'SL · Easter','seasonal',15,15,'Clearance','clr'),
  ('F26',40,'Mother''s Day','seasonal',16,16,'OTS','ots'),
  ('F26',40,'Mother''s Day','seasonal',17,17,'Production','prod'),
  ('F26',40,'Mother''s Day','seasonal',18,18,'Set','set'),
  ('F26',40,'Mother''s Day','seasonal',19,20,'SL: Mother''s Day','sl'),
  ('F26',40,'Mother''s Day','seasonal',21,21,'Clearance','clr'),
  ('F26',50,'Sporting Goods','seasonal',16,16,'OTB','otb'),
  ('F26',50,'Sporting Goods','seasonal',17,17,'Production','prod'),
  ('F26',50,'Sporting Goods','seasonal',18,18,'Set','set'),
  ('F26',50,'Sporting Goods','seasonal',19,25,'Sporting Goods','focus'),
  ('F26',60,'Independence Day','seasonal',20,20,'OTS','ots'),
  ('F26',60,'Independence Day','seasonal',21,21,'Production','prod'),
  ('F26',60,'Independence Day','seasonal',22,22,'Set','set'),
  ('F26',60,'Independence Day','seasonal',23,26,'Independence Day','sl'),
  ('F26',60,'Independence Day','seasonal',28,28,'Clearance','clr'),
  ('F26',70,'Father''s Day','seasonal',22,22,'OTS','ots'),
  ('F26',70,'Father''s Day','seasonal',23,23,'Production','prod'),
  ('F26',70,'Father''s Day','seasonal',24,24,'Set','set'),
  ('F26',70,'Father''s Day','seasonal',25,26,'SL: Father''s Day','sl'),
  ('F26',70,'Father''s Day','seasonal',27,27,'Clearance','clr'),
  ('F26',80,'Back to School','seasonal',24,24,'OTS','ots'),
  ('F26',80,'Back to School','seasonal',25,25,'Production','prod'),
  ('F26',80,'Back to School','seasonal',26,26,'Set','set'),
  ('F26',80,'Back to School','seasonal',27,33,'SL: Back To School','sl'),
  ('F26',90,'End Cap Focus','program',14,16,'March Madness Snacks & Drinks','endcap'),
  ('F26',100,'Leadership Training','program',14,18,'Building a High-Performing Team','lead'),
  ('F26',100,'Leadership Training','program',19,22,'Coaching & Growing Future Leaders','lead'),
  ('F26',100,'Leadership Training','program',23,26,'Customer Experience Excellence','lead'),
  ('F26',100,'Leadership Training','program',27,31,'Operational Leadership Mastery','lead'),
  ('F26',100,'Leadership Training','program',32,35,'Culture, Engagement & Recognition','lead'),
  ('F26',100,'Leadership Training','program',36,39,'Business Acumen for Store Leaders','lead'),
  ('F26',100,'Leadership Training','program',40,44,'Holiday Readiness & Customer Support','lead'),
  ('F26',100,'Leadership Training','program',45,48,'Leading Through Change & High Volume','lead'),
  ('F26',100,'Leadership Training','program',49,52,'Annual Reviews & Next Year Goals','lead'),
  ('F26',110,'Beyond Bargains','program',14,18,'Spring Food Drive','beyondB'),
  ('F26',110,'Beyond Bargains','program',19,26,'Dress for Success','beyondB'),
  ('F26',110,'Beyond Bargains','program',27,33,'School Supply Drive','beyondO');
