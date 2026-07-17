-- migration-016: Marketing Flow Calendar (the F26 promotional pipeline).
-- One row per retail week (W14..W52). Seeded once from the F26 Flow Calendar
-- (Google Sheets export). The app becomes the source of truth: admins edit
-- in-app (Phase 2). Manager-facing fields only -- the seasonal pallet/unit
-- lifecycle is intentionally out of scope for Phase 1.
-- Apply: npx wrangler d1 execute labor-dashboard-db-staging --remote --file=migration-016.sql

CREATE TABLE IF NOT EXISTS marketing_flow (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year   TEXT NOT NULL DEFAULT 'F26',
  retail_week   INTEGER NOT NULL,      -- 14..52
  week_start    TEXT NOT NULL,         -- ISO 'YYYY-MM-DD'
  week_end      TEXT NOT NULL,         -- ISO 'YYYY-MM-DD'
  special_event TEXT,
  weekly_theme  TEXT,
  product_focus TEXT,
  dd_loyalty    TEXT,                  -- 'Double Dip' | 'X2 Points' | NULL
  flash_sale    TEXT,                  -- Wed-Thurs flash
  weekend_event TEXT,                  -- Fri-Sun + store events
  notes         TEXT,
  updated_at    TEXT,
  UNIQUE(fiscal_year, retail_week)
);

CREATE INDEX IF NOT EXISTS idx_flow_week ON marketing_flow(fiscal_year, week_start);

INSERT OR REPLACE INTO marketing_flow
  (fiscal_year, retail_week, week_start, week_end, special_event, weekly_theme, product_focus, dd_loyalty, flash_sale, weekend_event, updated_at)
VALUES
  ('F26',14,'2026-03-29','2026-04-04','Easter Weekend','Easter Week Deals','Candy, Toys, Decor','Double Dip','Candy Blowout Deal B1G1 / Game Day Snacks 25%','Egg Hunt in Bins; GWP Gnome in Coliseum & Dupont (spend $40)','2026-06-12'),
  ('F26',15,'2026-04-05','2026-04-11',NULL,'Pantry Stock-up Week; Spring Apparel Refresh','Snacks, Drinks, Dresses, Tees, Shoes','X2 Points','Pantry / Snacks (25% off)',NULL,'2026-06-12'),
  ('F26',16,'2026-04-12','2026-04-18','Tax Day (Apr. 15)','Tax Savings','Furniture, Appliances, Mattresses',NULL,'RTA 25% Off','Appliances / Mattresses / Rugs 20% off','2026-06-12'),
  ('F26',17,'2026-04-19','2026-04-25',NULL,NULL,NULL,NULL,NULL,NULL,'2026-06-12'),
  ('F26',18,'2026-04-26','2026-05-02',NULL,'Spring Cleaning Essentials','Cleaning, Paper','Double Dip','Pantry / Snacks (25% off)','Employee Sale (27/28)','2026-06-12'),
  ('F26',19,'2026-05-03','2026-05-09','Mother''s Day (May 10)','Mother''s Day','HBA, Gift Sets, Soft Home','X2 Points','Bedding / Home (25% off)','Spend $30; Raffle $100 GC (MD Basket); Holland (Tulip Time Festival)','2026-06-12'),
  ('F26',20,'2026-05-10','2026-05-16','Teacher Appreciation','Customer Appreciation Event','15% OFF STORE WIDE',NULL,'Color Day Sales (10% off)',NULL,'2026-06-12'),
  ('F26',21,'2026-05-17','2026-05-23','Memorial Day (May 25)','Backyard Fun','Toys, Games, Pool, Summer Decor',NULL,'Spring Summer (20% off)',NULL,'2026-06-12'),
  ('F26',22,'2026-05-24','2026-05-30','Graduation Season','Home Essentials','Cleaning, Small Appliances, Hard Home','Double Dip','Small Appliances (20% off)','Spend $30; Raffle $100 GC','2026-06-12'),
  ('F26',23,'2026-05-31','2026-06-06',NULL,'Furniture Sale','Furniture','X2 Points','RTA (25% Off)','Appliances / Mattresses / Rugs 20% off','2026-06-12'),
  ('F26',24,'2026-06-07','2026-06-13','Father''s Day Prep','Father''s Day Prep','Lowes, Mens Apparel, Gifts',NULL,'All Shoes (20% off) Wed-Sun','All Shoes (20% off) Wed-Sun; Coliseum Parking Lot Event 6/7','2026-06-12'),
  ('F26',25,'2026-06-14','2026-06-20','Father''s Day (Jun 21)','Gifts for Every Dad','BBQ; Outdoor Gear, Furniture',NULL,'Lowes (25% Off)',NULL,'2026-06-12'),
  ('F26',26,'2026-06-21','2026-06-27',NULL,'Customer Appreciation Event','15% OFF STORE WIDE',NULL,NULL,'Customer Appreciation Event','2026-06-12'),
  ('F26',27,'2026-06-28','2026-07-04','4th of July Week','Stars, Stripes, & Summer Deals','Summer Toys, Snacks/Drinks, Decor','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',28,'2026-07-05','2026-07-11','BTS Preview','BTS Sneak Peak','Backpacks, Lunch boxes','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',29,'2026-07-12','2026-07-18','Amazon Prime Day','BL Prime Day','Small appliances, electronics, home gadgets',NULL,NULL,NULL,'2026-06-12'),
  ('F26',30,'2026-07-19','2026-07-25','BTS Push','Summer Fun Savings','Outdoor Toys, Games, Seasonal Apparel',NULL,NULL,NULL,'2026-06-12'),
  ('F26',31,'2026-07-26','2026-08-01',NULL,'BTS Essentials Week','School Supplies, Kids Apparel, Lunch bags','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',32,'2026-08-02','2026-08-08',NULL,'School is Back!','Snacks, Drinks, Lunch products','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',33,'2026-08-09','2026-08-15','First week of School','Home Refresh for Fall','Furniture, Rugs, Small Appliances, Decor',NULL,NULL,NULL,'2026-06-12'),
  ('F26',34,'2026-08-16','2026-08-22',NULL,'Customer Appreciation Event','15% OFF STORE WIDE','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',35,'2026-08-23','2026-08-29','Labor Day Prep','Fall Decor / Apparel Kickoff','F/W Apparel, Fall, Pumpkins, Soft Home','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',36,'2026-08-30','2026-09-05','Labor Day Weekend','Labor Day Savings','Furniture, Rugs, Mattresses, Home Goods',NULL,NULL,NULL,'2026-06-12'),
  ('F26',37,'2026-09-06','2026-09-12','Fall Decor','Halloween Early Promo','Costumes, Halloween GM, Candy',NULL,NULL,NULL,'2026-06-12'),
  ('F26',38,'2026-09-13','2026-09-19','Halloween Early Promo','Halloween Build-up','Costumes, Halloween GM, Candy',NULL,NULL,NULL,'2026-06-12'),
  ('F26',39,'2026-09-20','2026-09-26','Halloween Build-up','Halloween Ramp','Costumes, Halloween GM, Candy',NULL,NULL,NULL,'2026-06-12'),
  ('F26',40,'2026-09-27','2026-10-03',NULL,'Major Halloween Push (Full Set)','Costumes, Halloween GM, Candy','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',41,'2026-10-04','2026-10-10','Columbus Day Sales','Columbus Day Sales','Soft Home, Decor, Apparel','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',42,'2026-10-11','2026-10-17','Major Halloween Push','Halloween Final Stretch / Christmas Start Set','Halloween, Christmas hitting shelves',NULL,NULL,NULL,'2026-06-12'),
  ('F26',43,'2026-10-18','2026-10-24','Halloween Final Stretch','Customer Appreciation Event','15% OFF STORE WIDE',NULL,NULL,NULL,'2026-06-12'),
  ('F26',44,'2026-10-25','2026-10-31','Halloween Week','Final Halloween Sales & Holiday Floor Transition','Halloween, Christmas','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',45,'2026-11-01','2026-11-07','Holiday Floor Transition','Veterans Day + Holiday Preview','Christmas, Giftables, Decor, Toys, HBA','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',46,'2026-11-08','2026-11-14','Veterans Day (Nov 11)','Thanksgiving Prep + Early Black Friday','Toys, Baby, Small Appliance, Furniture',NULL,NULL,NULL,'2026-06-12'),
  ('F26',47,'2026-11-15','2026-11-21','Thanksgiving Prep','Customer Appreciation Event','15% OFF STORE WIDE',NULL,NULL,NULL,'2026-06-12'),
  ('F26',48,'2026-11-22','2026-11-28','Thanksgiving / Black Friday','Black Friday Event','Bins, Electronics, Toys','Double Dip',NULL,NULL,'2026-06-12'),
  ('F26',49,'2026-11-29','2026-12-05','Holiday Gifting Peak','Holiday Gifting Peak','Toys, Decor, Soft Home, HBA','X2 Points',NULL,NULL,'2026-06-12'),
  ('F26',50,'2026-12-06','2026-12-12','Stocking Stuffers','Stocking Stuffers','Candy, Toys, HBA',NULL,NULL,NULL,'2026-06-12'),
  ('F26',51,'2026-12-13','2026-12-19','Last Minute Holiday','Customer Appreciation Event','15% OFF STORE WIDE',NULL,NULL,NULL,'2026-06-12'),
  ('F26',52,'2026-12-20','2026-12-26','Christmas + Year-end','Christmas Week + Year-end Clearance','Holiday decor, toys, apparel markdowns','Double Dip',NULL,NULL,'2026-06-12');
