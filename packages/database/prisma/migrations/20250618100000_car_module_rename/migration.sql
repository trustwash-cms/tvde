-- Renomear módulo CarWash → CarModule (nome público)
UPDATE module_registry
SET
  name = 'CarModule',
  description = 'Gestão automóvel — clientes, catálogo, veículos e folhas de obra'
WHERE key = 'carwash';
