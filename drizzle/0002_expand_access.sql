-- El acceso pasa a ser explícito por elemento: se expanden los permisos ya concedidos a todo lo que cuelga de ellos.
INSERT OR IGNORE INTO element_access (user_id, element_id, granted_at)
WITH RECURSIVE d(uid, eid) AS (
  SELECT user_id, element_id FROM element_access
  UNION
  SELECT d.uid, e.id FROM d JOIN elements e ON e.parent_id = d.eid
)
SELECT uid, eid, unixepoch() FROM d;
