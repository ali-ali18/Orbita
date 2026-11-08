import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { errorMessage } from "../../lib/loadable.ts";
import { Sheet, SheetGroup, SheetRow, Skeleton, Text } from "../../ui/index.ts";
import { conversationLabel } from "./chat-model.ts";
import { useConversations } from "./chat-queries.ts";

/** Gaveta com as conversas guardadas no servidor e "Nova conversa". */
export function ChatHistorySheet({
	visible,
	onClose,
	onNew,
	onPick,
}: {
	visible: boolean;
	onClose: () => void;
	onNew: () => void;
	onPick: (id: string) => void;
}) {
	const q = useConversations(visible);
	const list = q.data?.conversations ?? [];
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
				<SheetGroup gap={false}>
					{list.map((conversation) => (
						<SheetRow
							key={conversation.id}
							icon="relogio"
							label={conversationLabel(conversation.title)}
							onPress={() => onPick(conversation.id)}
						/>
					))}
				</SheetGroup>
			)}
		</Sheet>
	);
}
