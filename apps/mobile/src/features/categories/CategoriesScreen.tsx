import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import {
	ConfirmDialog,
	ErrorState,
	Icon,
	IconButton,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { categoryDot } from "../transactions/new-transaction-model.ts";
import { type CategoryDraft, CategorySheet } from "./CategorySheet.tsx";
import { checkName, nextFreeSlot, ruleRows, uniqueSlug } from "./categories-model.ts";
import {
	useArchiveCategory,
	useCategories,
	useCategoryRules,
	useCreateCategory,
	useDeleteRule,
	useUpdateCategory,
} from "./queries.ts";

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

/**
 * Tela "Categorias e regras" (Figma 43:939): as categorias como chips (tocar edita; "+ Nova" cria) e as
 * regras aprendidas com as correções, cada uma com a lixeira. Excluir categoria a arquiva na API.
 */
export function CategoriesScreen() {
	const router = useRouter();
	const categoriesQ = useCategories();
	const rulesQ = useCategoryRules();
	const create = useCreateCategory();
	const update = useUpdateCategory();
	const archive = useArchiveCategory();
	const removeRule = useDeleteRule();
	const [editing, setEditing] = useState<Editing>(null);
	const [confirmingArchive, setConfirmingArchive] = useState(false);
	const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);
	const [sheetError, setSheetError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const state = combineLoadables(toLoadable(categoriesQ), toLoadable(rulesQ));
	const categories = useMemo(() => categoriesQ.data?.categories ?? [], [categoriesQ.data]);
	const editingCategory = editing?.kind === "edit" ? categories.find((c) => c.id === editing.id) : undefined;
	const rules = useMemo(() => ruleRows(rulesQ.data?.rules ?? [], categories), [rulesQ.data, categories]);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
	const closeSheet = () => {
		setEditing(null);
		setSheetError(null);
		setConfirmingArchive(false);
	};

	const save = (draft: CategoryDraft) => {
		const others = categories.filter((c) => c.id !== editingCategory?.id).map((c) => c.name);
		const checked = checkName(draft.name, others);
		if (!checked.ok) {
			setSheetError(checked.message);
			return;
		}
		setSheetError(null);
		const onError = (e: unknown) => setSheetError(errorMessage(e));
		if (editingCategory) {
			update.mutate(
				{ id: editingCategory.id, body: { name: checked.name, chartSlot: draft.chartSlot } },
				{ onSuccess: closeSheet, onError },
			);
		} else {
			create.mutate(
				{
					slug: uniqueSlug(
						checked.name,
						categories.map((c) => c.slug),
					),
					name: checked.name,
					chartSlot: draft.chartSlot,
				},
				{ onSuccess: closeSheet, onError },
			);
		}
	};

	const confirmArchive = () => {
		if (!editingCategory) return;
		archive.mutate(editingCategory.id, {
			onSuccess: closeSheet,
			onError: (e) => {
				setConfirmingArchive(false);
				setSheetError(errorMessage(e));
			},
		});
	};

	const confirmDeleteRule = () => {
		if (!ruleToDelete) return;
		setMessage(null);
		removeRule.mutate(ruleToDelete, {
			onError: (e) => setMessage(errorMessage(e)),
			onSettled: () => setRuleToDelete(null),
		});
	};

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await Promise.all([categoriesQ.refetch(), rulesQ.refetch()]);
		} finally {
			setRefreshing(false);
		}
	};

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.lg }}>
					<Skeleton height={118} />
					<Skeleton height={65} />
					<Skeleton height={65} />
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		return (
			<>
				<View style={{ gap: spacing.sm }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						Categorias
					</Text>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
						{categories.map((c) => (
							<Pressable
								key={c.id}
								accessibilityRole="button"
								accessibilityLabel={`Editar ${c.name}`}
								onPress={() => setEditing({ kind: "edit", id: c.id })}
								style={({ pressed }) => ({
									flexDirection: "row",
									alignItems: "center",
									gap: spacing.sm,
									minHeight: 44,
									paddingHorizontal: spacing.md,
									borderRadius: radius.pill,
									backgroundColor: colors.surface,
									borderWidth: 1,
									borderColor: colors.border,
									opacity: pressed ? 0.8 : 1,
								})}
							>
								<View
									style={{
										width: 8,
										height: 8,
										borderRadius: radius.pill,
										backgroundColor: categoryDot(c.chartSlot, c.slug),
									}}
								/>
								<Text variant="caption">{c.name}</Text>
							</Pressable>
						))}
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Nova categoria"
							onPress={() => setEditing({ kind: "new" })}
							style={({ pressed }) => ({
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.xs,
								minHeight: 44,
								paddingHorizontal: spacing.md,
								borderRadius: radius.pill,
								borderWidth: 1,
								borderColor: colors.border,
								opacity: pressed ? 0.8 : 1,
							})}
						>
							<Icon name="mais" size={16} />
							<Text variant="caption">Nova</Text>
						</Pressable>
					</View>
				</View>

				<View style={{ gap: spacing.sm, paddingTop: spacing.sm }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						Regras automáticas
					</Text>
					{message ? (
						<View accessibilityRole="alert" accessibilityLiveRegion="polite">
							<Text variant="caption" tone="secondary">
								{message}
							</Text>
						</View>
					) : null}
					{rules.length === 0 ? (
						<Text variant="body" tone="secondary">
							Nenhuma regra ainda. Quando você corrigir a categoria de um lançamento, eu posso lembrar e
							aplicar nos próximos.
						</Text>
					) : (
						<View style={{ backgroundColor: colors.surface, borderRadius: radius.group, overflow: "hidden" }}>
							{rules.map((r, i) => (
								<View
									key={r.id}
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: spacing.md,
										minHeight: 64,
										paddingLeft: spacing.lg,
										paddingRight: spacing.xs,
										borderBottomWidth: i === rules.length - 1 ? 0 : 1,
										borderBottomColor: colors.border,
									}}
								>
									<View style={{ flex: 1, paddingVertical: spacing.md }}>
										<Text variant="body" numberOfLines={1}>
											{r.title}
										</Text>
										<Text variant="caption" tone="secondary" numberOfLines={1}>
											{r.caption}
										</Text>
									</View>
									<IconButton
										icon="lixeira"
										label={`Excluir regra ${r.title}`}
										onPress={() => setRuleToDelete(r.id)}
									/>
								</View>
							))}
						</View>
					)}
				</View>
			</>
		);
	};

	const sheetOpen = editing !== null;
	const initial: CategoryDraft = editingCategory
		? { name: editingCategory.name, chartSlot: editingCategory.chartSlot ?? nextFreeSlot(categories) }
		: { name: "", chartSlot: nextFreeSlot(categories) };

	if (isUnreachableQuery(categoriesQ)) {
		return <ServerDownScreen onRetry={() => categoriesQ.refetch()} />;
	}

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
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
			>
				<View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
				</View>
				<View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
					<Text variant="numberMedium" accessibilityRole="header">
						Categorias e regras
					</Text>
					<Text variant="body" tone="secondary">
						As regras nascem quando você corrige uma categoria. Daí em diante, eu aplico sozinha.
					</Text>
				</View>
				{renderBody()}
			</ScrollView>

			<CategorySheet
				visible={sheetOpen}
				title={editingCategory ? "Editar categoria" : "Nova categoria"}
				initial={initial}
				canDelete={editingCategory !== undefined && !editingCategory.isSystem}
				saving={create.isPending || update.isPending}
				deleting={archive.isPending}
				error={sheetError}
				onSave={save}
				onDelete={() => setConfirmingArchive(true)}
				onClose={closeSheet}
			/>
			<ConfirmDialog
				visible={confirmingArchive}
				title="Excluir categoria?"
				message="Ela some das listas e dos filtros. Os lançamentos antigos continuam como estão."
				confirmLabel="Excluir"
				onConfirm={confirmArchive}
				onCancel={() => setConfirmingArchive(false)}
			/>
			<ConfirmDialog
				visible={ruleToDelete !== null}
				title="Excluir regra?"
				message="Os próximos lançamentos não serão mais categorizados por ela. Os que já foram ficam como estão."
				confirmLabel="Excluir"
				onConfirm={confirmDeleteRule}
				onCancel={() => setRuleToDelete(null)}
			/>
		</Screen>
	);
}
