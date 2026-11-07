import { type CategoryRuleRecord, DataError, type Stores } from "@orbita/db";
import { type CategoryRuleCreateBody, derivePattern, pickCategoryRule } from "@orbita/shared";
import { orNotFound } from "../../http/errors.ts";

export const NO_MERCHANT_MESSAGE =
	"Não deu para identificar o estabelecimento nesse lançamento. Corrija só a categoria dele.";

/** Só consumo muda de categoria por regra: receita, transferência e pagamento de fatura não têm categoria de gasto. */
const RULE_KINDS = new Set(["expense", "refund"]);

/**
 * Cria (ou atualiza) a regra a partir de um lançamento que o dono corrigiu: o padrão sai do nome do estabelecimento
 * (ou da descrição) dele. O lançamento de origem fica com a categoria da regra e marcado como "editado pelo dono".
 * Com `applyToExisting`, reclassifica os outros lançamentos que casam e que o dono não editou à mão; a regra mais
 * específica (padrão mais longo) continua mandando quando duas casam.
 */
export async function createCategoryRule(
	stores: Stores,
	body: CategoryRuleCreateBody,
): Promise<{ rule: CategoryRuleRecord; updated: number }> {
	const source = orNotFound(await stores.transactions.get(body.transactionId), "Lançamento", "o");
	const pattern = derivePattern(source.merchantName, source.description);
	if (pattern === null) throw new DataError("invalid", NO_MERCHANT_MESSAGE);
	// Falha aqui (categoria inexistente/arquivada) antes de mexer em qualquer lançamento.
	const rule = await stores.categoryRules.upsert(pattern, body.categoryId);
	if (source.categoryId !== body.categoryId || !source.categoryEditedByOwner) {
		await stores.transactions.update(source.id, {
			categoryId: body.categoryId,
			categoryEditedByOwner: true,
		});
	}
	let updated = 0;
	if (body.applyToExisting === true) {
		const rules = await stores.categoryRules.list();
		for (const t of await stores.transactions.listCategoryNotEditedByOwner()) {
			if (t.id === source.id || !RULE_KINDS.has(t.kind) || t.categoryId === rule.categoryId) continue;
			if (pickCategoryRule(rules, t.merchantName, t.description)?.id !== rule.id) continue;
			await stores.transactions.update(t.id, { categoryId: rule.categoryId });
			updated += 1;
		}
	}
	return { rule, updated };
}
