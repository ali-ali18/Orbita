import { formatBRL, projectMonth } from "@orbita/core";
import { type ChatBubble, ChatView } from "./ChatView.tsx";
import { answerChat, type ChatFacts } from "./reply.ts";

/**
 * Números do exemplo já usado na prévia do Início (não é o extrato de ninguém).
 * A projeção sai de `projectMonth`, a mesma conta do resumo.
 */
const spentCents = 52067;
const projection = projectMonth({
	spentCents,
	pendingRecurringExpenseCents: 0,
	variableSpentCents: spentCents,
	today: "2026-11-08",
	month: "2026-11",
});

const facts: ChatFacts = {
	monthName: "novembro",
	spentCents,
	incomeCents: 13,
	categories: [
		{
			id: "del",
			name: "Delivery",
			slug: "delivery",
			spentCents: 4890,
			limitCents: 15000,
			remainingCents: 10110,
		},
	],
	sources: [{ id: "nu", name: "Nubank", type: "card" }],
	safeToSpend: { availableCents: 177933 },
	projectionCents: projection.projectedCents,
};

function talk(): ChatBubble[] {
	const delivery = answerChat("Quanto gastei com delivery?", facts);
	const month = answerChat("Como fecha o mês?", facts);
	const launch = answerChat("gastei 46,90 no iFood no Nubank", facts);
	const bubbles: ChatBubble[] = [{ id: "u1", kind: "user", text: "Quanto gastei com delivery?" }];
	if (delivery.type === "text") bubbles.push({ id: "a1", kind: "text", text: delivery.text });
	bubbles.push({ id: "u2", kind: "user", text: "Como fecha o mês?" });
	if (month.type === "month") bubbles.push({ id: "a2", kind: "month", text: month.text, rows: month.rows });
	if (launch.type === "launch") {
		bubbles.push({ id: "u3", kind: "user", text: "gastei 46,90 no iFood no Nubank" });
		bubbles.push({
			id: "a3",
			kind: "launch",
			description: launch.description,
			caption: "Delivery · Nubank crédito · hoje",
			amount: formatBRL(-launch.amountCents),
			onUndo: noop,
			onEdit: noop,
		});
	}
	return bubbles;
}

const noop = () => {};

export function ChatEmptyPreview() {
	return <ChatView messages={[]} onClose={noop} onReset={noop} onNew={noop} onSend={noop} />;
}

export function ChatTalkPreview() {
	return <ChatView messages={talk()} onClose={noop} onReset={noop} onNew={noop} onSend={noop} />;
}
