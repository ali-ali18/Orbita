import { useQuery } from "@tanstack/react-query";
import { call } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { useSession } from "../../lib/session.tsx";

/** Todas as consultas da tela Início. A chave inclui o servidor: trocar de servidor não reaproveita dados. */
function useScoped() {
	const { api, baseUrl } = useSession();
	if (!api || !baseUrl) throw new Error("Consulta sem sessão");
	return { api, baseUrl };
}

export function useSummary(month: string) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "summary", month],
		queryFn: () => call(() => api.v1.summary[":month"].$get({ param: { month } })),
	});
}

export function useCategories() {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "categories"],
		queryFn: () => call(() => api.v1.categories.$get()),
	});
}

export function useCards() {
	const { api, baseUrl } = useScoped();
	return useQuery({ queryKey: [baseUrl, "cards"], queryFn: () => call(() => api.v1.cards.$get()) });
}

export function useAccounts() {
	const { api, baseUrl } = useScoped();
	return useQuery({ queryKey: [baseUrl, "accounts"], queryFn: () => call(() => api.v1.accounts.$get()) });
}

export function useInvoice(cardId: string | undefined, month: string | undefined) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "invoice", cardId, month],
		enabled: Boolean(cardId && month),
		queryFn: () =>
			call(() =>
				api.v1.cards[":id"].invoices[":month"].$get({ param: { id: cardId ?? "", month: month ?? "" } }),
			),
	});
}

export function useInstallments() {
	const { api, baseUrl } = useScoped();
	const from = useClock().month;
	return useQuery({
		queryKey: [baseUrl, "installments", from],
		queryFn: () => call(() => api.v1.installments.$get({ query: { from } })),
	});
}

export function useRecentTransactions(limit = 5) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "transactions", "recent", limit],
		queryFn: () => call(() => api.v1.transactions.$get({ query: { limit: String(limit) } })),
	});
}

/** "Como chegamos nesse número": os lançamentos que somaram ao Gasto do mês. */
export function useBreakdown(month: string) {
	const { api, baseUrl } = useScoped();
	return useQuery({
		queryKey: [baseUrl, "summary", month, "breakdown"],
		queryFn: () => call(() => api.v1.summary[":month"].breakdown.$get({ param: { month } })),
	});
}
