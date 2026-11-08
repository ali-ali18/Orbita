import { formatBRL } from "@orbita/core";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { call } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { monthName } from "../../lib/format.ts";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "../../lib/idempotency.ts";
import { useSession } from "../../lib/session.tsx";
import { useAccounts, useCards, useCategories, useSummary } from "../summary/queries.ts";
import { isAffectedByNewTransaction } from "../transactions/new-transaction-model.ts";
import { type ChatBubble, ChatView } from "./ChatView.tsx";
import { pickLocalFile } from "./pick-file.ts";
import { answerChat, type ChatFacts, type ChatReply, type ChatSource } from "./reply.ts";

let nextId = 0;
function nextMessageId(): string {
	nextId += 1;
	return `m${nextId}`;
}

function textBubble(text: string): ChatBubble {
	return { id: nextMessageId(), kind: "text", text };
}

function fromReply(reply: Exclude<ChatReply, { type: "launch" }>): ChatBubble {
	if (reply.type === "month")
		return { id: nextMessageId(), kind: "month", text: reply.text, rows: reply.rows };
	return textBubble(reply.text);
}

/** Chat da Órbita. As respostas leem o resumo do mês; o lançamento usa a mesma API do "+". */
export function ChatScreen() {
	const router = useRouter();
	const { api, baseUrl } = useSession();
	const queryClient = useQueryClient();
	const { month, today } = useClock();
	const summaryQ = useSummary(month);
	const categoriesQ = useCategories();
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const [messages, setMessages] = useState<ChatBubble[]>([]);

	const facts = (): ChatFacts | null => {
		if (!summaryQ.data || !categoriesQ.data) return null;
		const summary = summaryQ.data;
		const budgets = new Map(summary.budgets.map((budget) => [budget.scope, budget]));
		const sources: ChatSource[] = [
			...(accountsQ.data?.accounts ?? [])
				.filter((account) => account.archivedAt === null)
				.map((account) => ({ id: account.id, name: account.name, type: "account" as const })),
			...(cardsQ.data?.cards ?? [])
				.filter((card) => card.archivedAt === null)
				.map((card) => ({ id: card.id, name: card.name, type: "card" as const })),
		];
		return {
			monthName: monthName(summary.month).toLocaleLowerCase("pt-BR"),
			spentCents: summary.summary.spentCents,
			incomeCents: summary.summary.incomeCents,
			categories: categoriesQ.data.categories
				.filter((category) => category.archivedAt === null)
				.map((category) => {
					const budget = budgets.get(category.id);
					return {
						id: category.id,
						name: category.name,
						slug: category.slug,
						spentCents: summary.summary.byCategory[category.id] ?? budget?.spentCents ?? 0,
						limitCents: budget?.limitCents ?? null,
						remainingCents: budget?.remainingCents ?? null,
					};
				}),
			sources,
			safeToSpend: summary.safeToSpend,
			projectionCents: summary.projection?.projectedCents ?? null,
		};
	};

	const refresh = () => {
		if (!baseUrl) return;
		void queryClient.invalidateQueries({
			predicate: (query) => isAffectedByNewTransaction(query.queryKey, baseUrl),
		});
	};

	const launch = async (reply: Extract<ChatReply, { type: "launch" }>) => {
		if (!api || !reply.source) {
			setMessages((current) => [...current, textBubble("Escolhe a conta ou o cartão para eu lançar.")]);
			return;
		}
		const source = reply.source;
		const idempotencyKey = newIdempotencyKey();
		try {
			const created = await call(() =>
				api.v1.transactions.$post(
					{
						json: {
							kind: "expense",
							amountCents: reply.amountCents,
							date: today,
							description: reply.description,
							...(reply.categoryId ? { categoryId: reply.categoryId } : {}),
							...(source.type === "card" ? { cardId: source.id } : { accountId: source.id }),
						},
					},
					// Uma chave por lançamento pedido no chat: se a resposta se perder, não grava em dobro.
					{ headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } },
				),
			);
			const transactionId = created.transaction.id;
			const launchId = nextMessageId();
			const where = source.type === "card" ? `${source.name} crédito` : source.name;
			const caption = [reply.categoryName, where, "hoje"].filter((part) => part !== null).join(" · ");
			setMessages((current) => [
				...current,
				{
					id: launchId,
					kind: "launch",
					description: reply.description,
					caption,
					amount: formatBRL(-reply.amountCents),
					onUndo: () => {
						void call(() =>
							api.v1.transactions[":id"].$delete({
								param: { id: transactionId },
								query: { scope: "item" },
							}),
						)
							.then(() => {
								setMessages((list) => list.filter((message) => message.id !== launchId));
								refresh();
							})
							.catch((error: unknown) => {
								const message = error instanceof Error ? error.message : "Não consegui desfazer.";
								setMessages((list) => [...list, textBubble(message)]);
							});
					},
					onEdit: () => router.push(`/lancamento/${transactionId}`),
				},
			]);
			refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Não consegui lançar.";
			setMessages((current) => [...current, textBubble(message)]);
		}
	};

	const send = (text: string) => {
		const known = facts();
		setMessages((current) => [...current, { id: nextMessageId(), kind: "user", text }]);
		if (!known) {
			setMessages((current) => [...current, textBubble("Ainda não tenho o resumo deste mês.")]);
			return;
		}
		const reply = answerChat(text, known);
		if (reply.type === "launch") {
			void launch(reply);
			return;
		}
		setMessages((current) => [...current, fromReply(reply)]);
	};

	const attach = async (kind: "receipt" | "photo") => {
		if (typeof document === "undefined") {
			setMessages((current) => [
				...current,
				textBubble("Ainda não dá para escolher o arquivo neste aparelho."),
			]);
			return;
		}
		const picked = await pickLocalFile(kind);
		if (!picked) return;
		const label = kind === "receipt" ? "Comprovante" : "Foto";
		setMessages((current) => [
			...current,
			{ id: nextMessageId(), kind: "user", text: label },
			textBubble("Recebi. Ainda não leio comprovante nem foto: o valor dá para lançar por escrito."),
		]);
	};

	return (
		<ChatView
			messages={messages}
			onClose={() => router.back()}
			onReset={() => setMessages([])}
			onSend={send}
			onAttach={(kind) => void attach(kind)}
		/>
	);
}
