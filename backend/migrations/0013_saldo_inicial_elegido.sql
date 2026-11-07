-- 0013: saldo inicial elegido al crear la cuenta de práctica.
-- initial_cents sigue siendo el saldo en céntimos de USD (base de la rentabilidad); estas dos columnas guardan lo que
-- la persona eligió (importe en céntimos de la divisa y la divisa), solo para mostrar «Empezaste con 1.000 €» sin que
-- cambie con el tipo de cambio. NULL en las cuentas anteriores (se crearon con el saldo del panel) y en las de los retos.
ALTER TABLE accounts ADD COLUMN initial_input_cents INTEGER CHECK (initial_input_cents IS NULL OR initial_input_cents > 0);
ALTER TABLE accounts ADD COLUMN initial_currency TEXT CHECK (initial_currency IS NULL OR initial_currency IN ('EUR'));
