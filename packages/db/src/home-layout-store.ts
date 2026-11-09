import type { HomeLayout } from "@orbita/shared";

/** Layout dos widgets do Início: um único registro (app de um usuário só). */
export interface HomeLayoutStore {
	/** Sempre devolve algo, em dia com o catálogo: sem registro, o padrão; widget novo entra oculto no fim. */
	get(): Promise<HomeLayout>;
	/** Grava a lista inteira e devolve o resultado já em dia. `invalid` para id repetido ou tamanho que o widget não tem. */
	set(items: HomeLayout): Promise<HomeLayout>;
}
