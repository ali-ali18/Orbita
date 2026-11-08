import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { modelLabel } from "../settings/ai-model.ts";
import { useAiSettings } from "../settings/ai-queries.ts";
import { useProfile } from "../settings/preferences-queries.ts";
import { isAffectedByNewTransaction } from "../transactions/new-transaction-model.ts";
import { ChatHistorySheet } from "./ChatHistorySheet.tsx";
import { ChatView, type ProposalAction } from "./ChatView.tsx";
import { streamChat } from "./chat-client.ts";
import { chatFetch } from "./chat-fetch.ts";
import { chatReducer, initialChatState } from "./chat-model.ts";
import { pickLocalFile } from "./pick-file.ts";

/**
 * Chat da Órbita. O servidor responde (a IA consulta o engine por ferramentas) e guarda o histórico; aqui só se
 * envia a mensagem, desenha o fluxo e leva os toques de Confirmar, Cancelar e Desfazer das propostas.
 */
export function ChatScreen() {
	const profileQ = useProfile();
	const router = useRouter();
	// "Conversar com o agente": a tela do agente abre o chat com o id dele; sem id, é a Órbita.
	const { agentId } = useLocalSearchParams<{ agentId?: string }>();
	const { api, baseUrl, state: session, handleQueryError } = useSession();
	const queryClient = useQueryClient();
	const aiQ = useAiSettings();
	const [state, dispatch] = useReducer(chatReducer, initialChatState);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
	const counter = useRef(0);
	const nextId = () => {
		counter.current += 1;
		return `m${counter.current}`;
	};
	const stateRef = useRef(state);
	stateRef.current = state;
	const controller = useRef<AbortController | null>(null);

	// Sair da tela interrompe a resposta em andamento (o servidor para de gastar com ela).
	useEffect(() => () => controller.current?.abort(), []);

	const refreshMoney = useCallback(() => {
		if (!baseUrl) return;
		void queryClient.invalidateQueries({
			predicate: (query) => isAffectedByNewTransaction(query.queryKey, baseUrl),
		});
	}, [baseUrl, queryClient]);

	const send = async (text: string) => {
		if (session.status !== "in" || stateRef.current.busy) return;
		const abort = new AbortController();
		controller.current = abort;
		dispatch({ type: "sent", text, userId: nextId(), assistantId: nextId() });
		try {
			await streamChat({
				baseUrl: session.baseUrl,
				token: session.token,
				body: {
					message: text,
					...(typeof agentId === "string" && agentId ? { agentId } : {}),
					...(stateRef.current.conversationId ? { conversationId: stateRef.current.conversationId } : {}),
				},
				fetchImpl: chatFetch,
				signal: abort.signal,
				onEvent: (event) => dispatch({ type: "event", event }),
			});
		} catch (error) {
			handleQueryError(error);
			const code =
				error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "erro";
			const message = error instanceof Error ? error.message : "Não consegui responder agora.";
			dispatch({ type: "failed", id: nextId(), code, message });
		} finally {
			// O custo do mês mudou, e a lista de conversas também.
			void queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] === baseUrl && (query.queryKey[1] === "chat" || query.queryKey[2] === "ai"),
			});
		}
	};

	const answerProposal = async (action: ProposalAction, proposal: { id: string }) => {
		if (!api || busyProposalId) return;
		setBusyProposalId(proposal.id);
		try {
			const param = { id: proposal.id };
			const result = await call(() =>
				action === "confirm"
					? api.v1.chat.proposals[":id"].confirm.$post({ param })
					: action === "cancel"
						? api.v1.chat.proposals[":id"].cancel.$post({ param })
						: api.v1.chat.proposals[":id"].undo.$post({ param }),
			);
			dispatch({ type: "proposal", proposal: result.proposal });
			// Confirmar e desfazer mexem no dinheiro; cancelar não.
			if (action !== "cancel") refreshMoney();
		} catch (error) {
			handleQueryError(error);
			dispatch({
				type: "notice",
				id: nextId(),
				text: error instanceof Error ? error.message : "Não consegui concluir. Tente de novo.",
			});
		} finally {
			setBusyProposalId(null);
		}
	};

	const openConversation = async (id: string) => {
		if (!api) return;
		setHistoryOpen(false);
		try {
			const loaded = await call(() => api.v1.chat.conversations[":id"].$get({ param: { id } }));
			controller.current?.abort();
			dispatch({ type: "loaded", conversationId: loaded.conversation.id, messages: loaded.messages });
		} catch (error) {
			handleQueryError(error);
			dispatch({
				type: "notice",
				id: nextId(),
				text: error instanceof Error ? error.message : "Não consegui abrir a conversa.",
			});
		}
	};

	const attach = async (kind: "receipt" | "photo") => {
		if (typeof document === "undefined") {
			dispatch({
				type: "local",
				id: nextId(),
				userText: kind === "receipt" ? "Comprovante" : "Foto",
				replyText: "Ainda não dá para escolher o arquivo neste aparelho.",
			});
			return;
		}
		const picked = await pickLocalFile(kind);
		if (!picked) return;
		dispatch({
			type: "local",
			id: nextId(),
			userText: kind === "receipt" ? "Comprovante" : "Foto",
			replyText: "Recebi. Ainda não leio comprovante nem foto: o valor dá para lançar por escrito.",
		});
	};

	return (
		<>
			<ChatView
				messages={state.bubbles}
				busy={state.busy}
				busyProposalId={busyProposalId}
				onClose={() => router.back()}
				onHistory={() => setHistoryOpen(true)}
				onSend={(text) => void send(text)}
				onAttach={(kind) => void attach(kind)}
				onProposal={(action, proposal) => void answerProposal(action, proposal)}
				onOpenTransaction={(id) => router.push(`/lancamento/${id}`)}
				onOpenServer={() => router.push("/configuracoes/servidor")}
				displayName={profileQ.data?.displayName ?? null}
				modelName={state.model ? modelLabel(aiQ.data?.modelOptions ?? [], state.model) : null}
			/>
			<ChatHistorySheet
				visible={historyOpen}
				onClose={() => setHistoryOpen(false)}
				onNew={() => {
					controller.current?.abort();
					dispatch({ type: "reset" });
					setHistoryOpen(false);
				}}
				onPick={(id) => void openConversation(id)}
			/>
		</>
	);
}
