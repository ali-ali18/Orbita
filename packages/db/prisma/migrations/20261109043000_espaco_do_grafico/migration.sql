-- Cada categoria padrão tem a própria cor: o espaço no gráfico vai de 0 a 9.
ALTER TABLE "categories" DROP CONSTRAINT "categories_chart_slot_check";

ALTER TABLE "categories"
    ADD CONSTRAINT "categories_chart_slot_check" CHECK ("chart_slot" IS NULL OR "chart_slot" BETWEEN 0 AND 9);
