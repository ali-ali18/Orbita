import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage } from "../../lib/loadable.ts";
import {
	Button,
	ConfirmDialog,
	ErrorState,
	IconButton,
	Screen,
	Sheet,
	SheetGroup,
	SheetRow,
	Skeleton,
	Text,
	TextField,
	TOP_FADE,
} from "../../ui/index.ts";
import { SearchField } from "../activity/SearchField.tsx";
import { AgentAvatar } from "../agents/AgentAvatar.tsx";
import { useAgents } from "../agents/queries.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useConversationsList, useDeleteConversation, useRenameConversation } from "./chat-queries.ts";
import {
	type AgentBadge,
	agentBadgeFor,
	conversationTitle,
	conversationWhen,
	emptyConversations,
	flattenConversationPages,
	RENAME_MAX,
	renameError,
	searchTerm,
} from "./conversations-model.ts";

const SEARCH_DELAY_MS = 300;

type Target = { id: string; title: string };
type Panel = { kind: "menu" | "rename"; target: Target } | null;

/** Valor que só muda depois de `delay` ms parado: a busca vai ao servidor quando a pessoa para de digitar. */
function useDebounced<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

/**
 * Tela "Conversas": todas as conversas, da mais recente para a mais antiga, em páginas (rolagem infinita) e com busca
 * no título feita no servidor. Tocar abre a conversa no chat; o menu "…" (ou segurar a linha) renomeia ou apaga.
 */
export function ConversationsScreen() {
	const router = useRouter();
	const { today } = useClock();
	const [text, setText] = useState("");
	const term = searchTerm(useDebounced(text, SEARCH_DELAY_MS));
	const q = useConversationsList(term);
	const agentsQ = useAgents();
	const remove = useDeleteConversation();
	const rename = useRenameConversation();
	const [panel, setPanel] = useState<Panel>(null);
	const [confirming, setConfirming] = useState<Target | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const conversations = useMemo(() => flattenConversationPages(q.data?.pages ?? []), [q.data]);
	const agents = agentsQ.data?.agents ?? [];

	const close = () => (router.canGoBack() ? router.back() : router.replace("/chat"));
	const open = (id: string) =>
		// Volta ao chat que já está na pilha (ou abre um): `opened` muda a cada toque para valer também a mesma conversa.
		router.navigate({ pathname: "/chat", params: { conversationId: id, opened: String(Date.now()) } });

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await q.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	const confirmDelete = () => {
		const target = confirming;
		if (!target) return;
		setMessage(null);
		remove.mutate(target.id, {
			onError: (e) => setMessage(errorMessage(e)),
			onSettled: () => setConfirming(null),
		});
	};

	const initialLoading = q.isPending && q.fetchStatus !== "paused" && !q.isError;
	const initialError = q.data === undefined && (q.isError || (q.isPending && q.fetchStatus === "paused"));

	const header = (
		<View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
			<View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
				<IconButton icon="voltar" label="Voltar" onPress={close} />
			</View>
			<Text variant="greeting" accessibilityRole="header">
				Conversas
			</Text>
			<SearchField
				value={text}
				onChange={setText}
				placeholder="Buscar pelo título"
				label="Buscar conversas pelo título"
			/>
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
				</View>
			) : null}
		</View>
	);

	const empty = emptyConversations(term);
	const body = initialLoading ? (
		<View accessibilityLabel="Carregando" style={{ gap: spacing.lg, paddingTop: spacing.md }}>
			{Array.from({ length: 6 }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: linhas de esqueleto fixas
				<Skeleton key={i} height={44} />
			))}
		</View>
	) : initialError ? (
		<View style={{ paddingTop: spacing.md }}>
			<ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
		</View>
	) : (
		<View style={{ gap: spacing.sm, paddingTop: spacing.xxl, alignItems: "flex-start" }}>
			<Text variant="numberMedium" accessibilityRole="header">
				{empty.title}
			</Text>
			<Text variant="body" tone="secondary">
				{empty.caption}
			</Text>
			{term ? null : (
				<View style={{ paddingTop: spacing.md }}>
					<Button label="Nova conversa" onPress={() => router.navigate("/chat")} />
				</View>
			)}
		</View>
	);

	const footer =
		initialLoading || initialError ? null : q.isFetchNextPageError ? (
			<View style={{ paddingTop: spacing.lg }}>
				<ErrorState message={errorMessage(q.error)} onRetry={() => void q.fetchNextPage()} />
			</View>
		) : q.isFetchingNextPage ? (
			<View style={{ paddingVertical: spacing.xl }} accessibilityLabel="Carregando mais conversas">
				<ActivityIndicator color={colors.textSecondary} />
			</View>
		) : q.hasNextPage ? (
			// Lista curta demais para disparar a rolagem: o botão garante o caminho.
			<View style={{ paddingTop: spacing.lg, alignItems: "center" }}>
				<Button label="Carregar mais" variant="secondary" compact onPress={() => void q.fetchNextPage()} />
			</View>
		) : conversations.length > 0 ? (
			<Text variant="caption" tone="tertiary" style={{ textAlign: "center", paddingTop: spacing.xl }}>
				Fim da lista
			</Text>
		) : null;

	if (isUnreachableQuery(q)) {
		return <ServerDownScreen onRetry={() => q.refetch()} />;
	}

	return (
		<Screen fadeTop>
			<FlatList
				data={initialLoading || initialError ? [] : conversations}
				keyExtractor={(c) => c.id}
				renderItem={({ item }) => (
					<ConversationRow
						title={conversationTitle(item.title)}
						when={conversationWhen(item.updatedAt, today)}
						badge={agentBadgeFor(item.agentId, agents)}
						onOpen={() => open(item.id)}
						onMenu={() =>
							setPanel({ kind: "menu", target: { id: item.id, title: conversationTitle(item.title) } })
						}
					/>
				)}
				ListHeaderComponent={header}
				ListEmptyComponent={body}
				ListFooterComponent={footer ?? undefined}
				onEndReached={() => {
					if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetchNextPageError) void q.fetchNextPage();
				}}
				onEndReachedThreshold={0.6}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="on-drag"
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
				}}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor={colors.text}
						colors={[colors.text]}
						progressBackgroundColor={colors.surface2}
					/>
				}
			/>

			<Sheet
				visible={panel !== null}
				{...(panel?.kind === "rename" ? { title: "Renomear conversa" } : {})}
				onClose={() => setPanel(null)}
			>
				{panel?.kind === "menu" ? (
					<View style={{ paddingVertical: spacing.md, gap: spacing.md }}>
						<Text variant="caption" tone="secondary" numberOfLines={2}>
							{panel.target.title}
						</Text>
						<SheetGroup gap={false}>
							<SheetRow
								icon="lapis"
								label="Renomear"
								onPress={() => setPanel({ kind: "rename", target: panel.target })}
							/>
							<SheetRow
								icon="lixeira"
								label="Apagar conversa"
								onPress={() => {
									setConfirming(panel.target);
									setPanel(null);
								}}
							/>
						</SheetGroup>
					</View>
				) : panel?.kind === "rename" ? (
					<RenameForm
						initial={panel.target.title}
						saving={rename.isPending}
						onSave={(title, fail) =>
							rename.mutate(
								{ id: panel.target.id, title },
								{ onSuccess: () => setPanel(null), onError: (e) => fail(errorMessage(e)) },
							)
						}
					/>
				) : null}
			</Sheet>
			<ConfirmDialog
				visible={confirming !== null}
				title="Apagar conversa?"
				message="As mensagens somem do histórico e não dá para recuperar. O gasto com a IA já registrado no mês continua."
				confirmLabel="Apagar"
				onConfirm={confirmDelete}
				onCancel={() => setConfirming(null)}
			/>
		</Screen>
	);
}

/** Linha da lista: título, quando foi a última mensagem, selo do agente (se houver) e o menu "…". */
function ConversationRow({
	title,
	when,
	badge,
	onOpen,
	onMenu,
}: {
	title: string;
	when: string;
	badge: AgentBadge | null;
	onOpen: () => void;
	onMenu: () => void;
}) {
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				minHeight: 64,
				borderBottomWidth: 1,
				borderBottomColor: colors.border,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={[title, when, badge?.name].filter(Boolean).join(", ")}
				accessibilityHint="Abre a conversa. Segure para renomear ou apagar."
				onPress={onOpen}
				onLongPress={onMenu}
				style={({ pressed }) => ({
					flex: 1,
					paddingVertical: spacing.md,
					gap: spacing.xs,
					opacity: pressed ? 0.8 : 1,
				})}
			>
				<Text variant="bodyStrong" numberOfLines={1}>
					{title}
				</Text>
				<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
					{when ? (
						<Text variant="caption" tone="secondary">
							{when}
						</Text>
					) : null}
					{badge ? (
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.xs,
								paddingLeft: spacing.xs,
								paddingRight: spacing.sm,
								paddingVertical: 1,
								borderRadius: radius.pill,
								backgroundColor: colors.surface2,
							}}
						>
							<AgentAvatar visual={badge.visual} size={16} name={badge.name} />
							<Text variant="micro" tone="secondary" numberOfLines={1}>
								{badge.name}
							</Text>
						</View>
					) : null}
				</View>
			</Pressable>
			<IconButton
				icon="reticencias"
				label={`Mais opções de ${title}`}
				onPress={onMenu}
				background={colors.background}
			/>
		</View>
	);
}

/** Campo de novo nome. O estado do texto mora aqui: a gaveta só monta isto aberta, então cada abertura começa do nome atual. */
function RenameForm({
	initial,
	saving,
	onSave,
}: {
	initial: string;
	saving: boolean;
	onSave: (title: string, fail: (message: string) => void) => void;
}) {
	const [name, setName] = useState(initial);
	const [error, setError] = useState<string | null>(null);
	const submit = () => {
		const problem = renameError(name);
		if (problem) {
			setError(problem);
			return;
		}
		setError(null);
		onSave(name.replace(/\s+/g, " ").trim(), setError);
	};
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			<TextField
				value={name}
				onChangeText={(next) => {
					setName(next);
					setError(null);
				}}
				maxLength={RENAME_MAX}
				autoFocus
				returnKeyType="done"
				onSubmitEditing={submit}
				accessibilityLabel="Novo nome da conversa"
			/>
			{error ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{error}
					</Text>
				</View>
			) : null}
			<Button label="Salvar" onPress={submit} loading={saving} disabled={name.trim() === ""} />
		</View>
	);
}
