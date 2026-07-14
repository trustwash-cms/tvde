-- Actualizar links «Contactos» ainda apontando para # → página Fale Connosco
UPDATE "ecommerce_nav_items"
SET
  "link_type" = 'page',
  "link_target" = 'fale-connosco.html',
  "updated_at" = NOW()
WHERE
  "label" = 'Contactos'
  AND ("link_target" IS NULL OR "link_target" = '' OR "link_target" = '#');
