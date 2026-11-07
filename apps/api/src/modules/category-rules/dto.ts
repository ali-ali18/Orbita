import type { CategoryRuleRecord } from "@orbita/db";
import type { CategoryRuleDto } from "@orbita/shared";

export function toCategoryRuleDto(r: CategoryRuleRecord): CategoryRuleDto {
	return { id: r.id, pattern: r.pattern, categoryId: r.categoryId, createdAt: r.createdAt.toISOString() };
}
