export interface CategoryRecord {
	id: string;
	slug: string;
	name: string;
	/** Índice em `chart.series` (0..4); `null` = cinza "outros". */
	chartSlot: number | null;
	isSystem: boolean;
	archivedAt: Date | null;
}

export interface CategoryInput {
	slug: string;
	name: string;
	chartSlot?: number | null;
	isSystem?: boolean;
}

/** O slug não muda depois de criado. */
export type CategoryPatch = Partial<{ name: string; chartSlot: number | null }>;

export const DEFAULT_CATEGORIES: readonly Required<CategoryInput>[] = [
	{ slug: "mercado", name: "Mercado", chartSlot: 0, isSystem: false },
	{ slug: "delivery", name: "Delivery", chartSlot: 1, isSystem: false },
	{ slug: "transporte", name: "Transporte", chartSlot: 2, isSystem: false },
	{ slug: "assinaturas", name: "Assinaturas", chartSlot: 3, isSystem: false },
	{ slug: "lazer", name: "Lazer", chartSlot: 4, isSystem: false },
	{ slug: "moradia", name: "Moradia", chartSlot: null, isSystem: false },
	{ slug: "saude", name: "Saúde", chartSlot: null, isSystem: false },
	{ slug: "transferencias", name: "Transferências", chartSlot: null, isSystem: true },
	{ slug: "investimentos", name: "Investimentos", chartSlot: null, isSystem: true },
	{ slug: "outros", name: "Outros", chartSlot: null, isSystem: true },
];

export interface CategoryStore {
	/** Só as ativas, na ordem de criação. */
	list(): Promise<CategoryRecord[]>;
	get(id: string): Promise<CategoryRecord | null>;
	getBySlug(slug: string): Promise<CategoryRecord | null>;
	/** `duplicate` se o slug já existe. */
	create(input: CategoryInput): Promise<CategoryRecord>;
	update(id: string, patch: CategoryPatch): Promise<CategoryRecord>;
	/** Categoria de sistema não se arquiva (`invalid`). */
	archive(id: string): Promise<CategoryRecord>;
	/**
	 * Cria as categorias padrão que faltam (idempotente). Não mexe nas que já existem: nome,
	 * espaço no gráfico e arquivamento escolhidos pelo usuário ficam como estão.
	 */
	ensureDefaults(): Promise<void>;
}
