import type { CategoryRecord } from "@orbita/db";
import type { CategoryDto } from "@orbita/shared";

export function toCategoryDto(c: CategoryRecord): CategoryDto {
	return {
		id: c.id,
		slug: c.slug,
		name: c.name,
		chartSlot: c.chartSlot,
		isSystem: c.isSystem,
		archivedAt: c.archivedAt?.toISOString() ?? null,
	};
}
