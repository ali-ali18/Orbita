import { ChatView } from "./ChatView.tsx";
import type { ChatBubble } from "./chat-model.ts";

/**
 * Conversa de exemplo para a prévia (sem servidor): os números são os do exemplo já usado na prévia do Início,
 * escritos à mão como o servidor os devolveria (a conta de verdade é sempre do engine, no servidor).
 */
const talk: ChatBubble[] = [
	{ id: "u1", kind: "user", text: "Quanto gastei com delivery?" },
	{
		id: "a1",
		kind: "assistant",
		streaming: false,
		tool: null,
		text: "Delivery está em R$ 48,90 este mês, dentro do limite de R$ 150,00.",
		cards: [
			{
				type: "rows",
				tool: "get_budget_status",
				title: "Orçamento de 2026-11",
				rows: [{ label: "Delivery", caption: "R$ 48,90 de R$ 150,00", value: "33%", cents: 4890 }],
				total: null,
			},
		],
	},
	{ id: "u2", kind: "user", text: "gastei 46,90 no iFood no Nubank" },
	{
		id: "a2",
		kind: "assistant",
		streaming: false,
		tool: null,
		text: "Preparei o lançamento. Confirma no card?",
		cards: [
			{
				type: "proposal",
				proposal: {
					id: "p1",
					kind: "create_transaction",
					status: "pending",
					title: "Lançar gasto",
					transactionId: null,
					lines: [
						{ label: "Valor", value: "−R$ 46,90" },
						{ label: "Descrição", value: "iFood" },
						{ label: "Onde", value: "Nubank (cartão)" },
						{ label: "Categoria", value: "Delivery" },
					],
				},
			},
		],
	},
];

const noop = () => {};

export function ChatEmptyPreview() {
	return <ChatView messages={[]} onClose={noop} onHistory={noop} onSend={noop} onProposal={noop} />;
}

export function ChatTalkPreview() {
	return <ChatView messages={talk} onClose={noop} onHistory={noop} onSend={noop} onProposal={noop} />;
}
