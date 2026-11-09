import { type ChatRequestBody, SETUP_USER_MESSAGE, type SetupSelection } from "@orbita/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { modelLabel } from "../settings/ai-model.ts";
import { useAiSettings } from "../settings/ai-queries.ts";
import { useProfile } from "../settings/preferences-queries.ts";
import { isAffectedByNewTransaction } from "../transactions/new-transaction-model.ts";
import { pickAttachment } from "./attach-native.ts";
import { type AttachKind, type PendingAttachment, userBubbleText } from "./attachment-model.ts";
import { ChatHistorySheet } from "./ChatHistorySheet.tsx";
import { ChatView, type ProposalAction } from "./ChatView.tsx";
import { streamChat } from "./chat-client.ts";
import { chatFetch } from "./chat-fetch.ts";
import { chatReducer, initialChatState } from "./chat-model.ts";
import { isAffectedBySetup } from "./setup-card-model.ts";

/**
 * Chat da Órbita. O servidor responde (a IA consulta o engine por ferramentas) e guarda o histórico; aqui só se
 * envia a mensagem, desenha o fluxo e leva os toques de Confirmar, Cancelar e Desfazer das propostas.
 */
export function ChatScreen() {
	const profileQ = useProfile();
	const router = useRouter();
	// "Conversar com o agente": a tela do agente abre o chat com o id dele; sem id, é a Órbita.
	// A tela "Conversas" volta para cá com `conversationId` (e `opened`, que muda a cada toque: abrir de novo a mesma conversa conta).
	const {
		agentId,
		conversationId: openId,
		opened,
		intent,
	} = useLocalSearchParams<{
		agentId?: string;
		conversationId?: string;
		opened?: string;
		/** `setup`: abre já rodando "Configurar com a Órbita" (a tarefa é fixa do servidor, não digitada). */
		intent?: string;
	}>();
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

	/** Manda um pedido ao chat e desenha o fluxo. `label` é o que aparece como fala do dono. */
	const stream = async (label: string, body: ChatRequestBody) => {
		if (session.status !== "in" || stateRef.current.busy) return;
		const abort = new AbortController();
		controller.current = abort;
		dispatch({ type: "sent", text: label, userId: nextId(), assistantId: nextId() });
		try {
			await streamChat({
				baseUrl: session.baseUrl,
				token: session.token,
				body,
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

	const [attachment, setAttachment] = useState<PendingAttachment | null>(null);

	const send = async (text: string) => {
		// O arquivo segue na mensagem e sai do campo; se o envio nem começar (resposta em andamento), fica onde estava.
		const files = attachment ? [{ mediaType: attachment.mediaType, data: attachment.data }] : [];
		if (stateRef.current.busy) return;
		setAttachment(null);
		await stream(userBubbleText(text, files.length), {
			...(text ? { message: text } : {}),
			...(files.length > 0 ? { attachments: files } : {}),
			...(typeof agentId === "string" && agentId ? { agentId } : {}),
			...(stateRef.current.conversationId ? { conversationId: stateRef.current.conversationId } : {}),
		});
	};

	// "Configurar com a Órbita": abre a tela já rodando a tarefa, uma vez só (voltar ao chat não reinicia).
	const startedSetup = useRef(false);
	const setupRef = useRef(stream);
	setupRef.current = stream;
	useEffect(() => {
		if (intent !== "setup" || startedSetup.current || session.status !== "in") return;
		startedSetup.current = true;
		void setupRef.current(SETUP_USER_MESSAGE, { intent: "setup" });
	}, [intent, session.status]);

	const answerProposal = async (
		action: ProposalAction,
		proposal: { id: string; kind: string },
		selection?: SetupSelection,
	) => {
		if (!api || busyProposalId) return;
		setBusyProposalId(proposal.id);
		try {
			const param = { id: proposal.id };
			const result = await call(() =>
				action === "confirm"
					? api.v1.chat.proposals[":id"].confirm.$post({
							param,
							json: selection ? { setup: selection } : {},
						})
					: action === "cancel"
						? api.v1.chat.proposals[":id"].cancel.$post({ param })
						: api.v1.chat.proposals[":id"].undo.$post({ param }),
			);
			dispatch({ type: "proposal", proposal: result.proposal });
			// Confirmar e desfazer mexem no dinheiro; cancelar não. A configuração mexe em quase tudo (assinaturas, renda, regras, orçamento).
			if (action !== "cancel") {
				if (proposal.kind === "setup" && baseUrl) {
					void queryClient.invalidateQueries({
						predicate: (query) => isAffectedBySetup(query.queryKey, baseUrl),
					});
				} else {
					refreshMoney();
				}
			}
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

	// Chegou pedido para abrir uma conversa (vindo da lista completa): carrega o histórico dela.
	const openRef = useRef(openConversation);
	openRef.current = openConversation;
	const requested = typeof openId === "string" && openId ? `${openId}:${opened ?? ""}` : null;
	const handledRequest = useRef<string | null>(null);
	useEffect(() => {
		if (requested === null || !api || typeof openId !== "string" || handledRequest.current === requested)
			return;
		handledRequest.current = requested;
		void openRef.current(openId);
	}, [requested, openId, api]);

	const attach = async (kind: AttachKind) => {
		const picked = await pickAttachment(kind);
		if (picked.status === "ok") setAttachment(picked.attachment);
		else if (picked.status === "error") dispatch({ type: "notice", id: nextId(), text: picked.message });
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
				attachment={attachment}
				onRemoveAttachment={() => setAttachment(null)}
				onProposal={(action, proposal, selection) => void answerProposal(action, proposal, selection)}
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
				onSeeAll={() => {
					setHistoryOpen(false);
					router.push("/conversas");
				}}
			/>
		</>
	);
}
