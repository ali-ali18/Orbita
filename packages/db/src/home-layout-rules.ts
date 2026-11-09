import { type HomeLayout, homeLayoutProblem, reconcileHomeLayout } from "@orbita/shared";
import { invalid } from "./errors.ts";

/** A mesma regra nos stores Prisma e memória: valida o que chegou e devolve o layout em dia com o catálogo. */
export function cleanHomeLayout(items: HomeLayout): HomeLayout {
	const problem = homeLayoutProblem(items);
	if (problem) throw invalid(problem);
	return reconcileHomeLayout(items);
}
