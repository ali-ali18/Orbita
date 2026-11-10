import type { AgentDto } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Sheet, SheetGroup, SheetRow, Skeleton, Text } from "../../ui/index.ts";
import { AgentAvatar } from "../agents/AgentAvatar.tsx";
import { useRecentConversations } from "./chat-queries.ts";
import { agentBadgeFor, conversationTitle, RECENT_COUNT, showSeeAll } from "./conversations-model.ts";

/**
 * Gaveta do chat: "Nova conversa", as 3 conversas mais recentes e, só quando existem mais, "Ver todas" (a tela
 * "Conversas" tem a lista completa, com busca). O servidor entrega só 3: uma conta com 500 conversas abre igual.
 */
export function ChatHistorySheet({
	visible,
	agents,
	onClose,
	onNew,
	onPick,
	onSeeAll,
}: {
	visible: boolean;
	/** Para mostrar de qual agente é cada conversa (a Órbita não leva selo). */
	agents: readonly Pick<AgentDto, "id" | "name" | "builtinKey">[];
	onClose: () => void;
	onNew: () => void;
	onPick: (id: string) => void;
	onSeeAll: () => void;
}) {
	const q = useRecentConversations(visible);
	const list = (q.data?.conversations ?? []).slice(0, RECENT_COUNT);
	return (
		<Sheet visible={visible} title="Conversas" onClose={onClose}>
			<SheetGroup gap={false}>
				<SheetRow icon="mais" label="Nova conversa" onPress={onNew} />
			</SheetGroup>
			{q.isPending ? (
				<View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
					<Skeleton height={spacing.xl} />
					<Skeleton height={spacing.xl} />
				</View>
			) : q.isError ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{errorMessage(q.error)}
				</Text>
			) : list.length === 0 ? (
				<Text variant="caption" tone="secondary" style={{ paddingVertical: spacing.md }}>
					Nenhuma conversa ainda.
				</Text>
			) : (
				<View style={{ paddingTop: spacing.md }}>
					<SheetGroup gap={false}>
						{[
							...list.map((conversation) => {
								const badge = agentBadgeFor(conversation.agentId, agents);
								return (
									<SheetRow
										key={conversation.id}
										{...(badge
											? {
													leading: <AgentAvatar visual={badge.visual} size={24} name={badge.name} />,
													caption: badge.name,
												}
											: { icon: "relogio" as const })}
										label={conversationTitle(conversation.title)}
										onPress={() => onPick(conversation.id)}
									/>
								);
							}),
							...(showSeeAll(q.data?.nextCursor)
								? [<SheetRow key="see-all" icon="reticencias" label="Ver todas" onPress={onSeeAll} />]
								: []),
						]}
					</SheetGroup>
				</View>
			)}
		</Sheet>
	);
}
