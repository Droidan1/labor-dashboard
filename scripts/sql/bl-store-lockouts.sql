SELECT u.id, u.email, u.role AS user_role, u.status,
       (u.pin_hash IS NOT NULL) AS associate,
       g.role AS bl_role, g.units AS bl_units, u.stores AS legacy_stores, u.last_login
  FROM users u
  JOIN user_grants g ON g.user_id = u.id AND g.business_id = 'bl'
 WHERE u.role NOT IN ('superuser', 'admin')
   AND CASE WHEN g.units IS NULL THEN 1
            WHEN json_valid(g.units) = 0 THEN 1
            WHEN json_type(g.units) <> 'array' THEN 1
            WHEN json_array_length(g.units) = 0 THEN 1
            ELSE 0 END = 1
 ORDER BY u.status, u.email;
