import { NOTE_MAX } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	BankLogo,
	ConfirmDialog,
	ErrorState,
	Icon,
	IconButton,
	Screen,
	Skeleton,
	Text,
} from "../../ui/index.ts";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { amountSignMode, amountTone, signedAmount, transactionIcon } from "../summary/transaction-model.ts";
import { DetailActions } from "./DetailActions.tsx";
import { CategoryPill, DetailGroup, DetailRow, OriginLine, RowValue } from "./DetailRows.tsx";
import { CategorySheet, DeleteSheet, MoreSheet, TextEditSheet } from "./DetailSheets.tsx";
import { DetailSummary } from "./DetailSummary.tsx";
import {
	appliedMessage,
	applyAllLabel,
	bankCategoryLabel,
	buildPatch,
	canApplyToAll,
	type DeleteScope,
	type DetailDraft,
	type DetailSource,
	type DetailTransaction,
	deleteChoices,
	editableFields,
	installmentText,
	invoiceText,
	isInstallment,
	sourceCaption,
	sourceTitle,
	statusText,
} from "./detail-model.ts";
import {
	useApplyCategoryRule,
	useConfirmTransaction,
	useDeleteTransaction,
	useUpdateTransaction,
} from "./detail-mutations.ts";
import { useTransactionDetail } from "./detail-queries.ts";
import { formatEntryDate } from "./new-transaction-model.ts";

type OpenSheet = "category" | "description" | "note" | "more" | "delete" | null;

const SOURCE_ICON = {
	manual: "usuario",
	notification: "notificacao",
	pluggy: "banco",
	receipt: "escanear",
	import: "baixar",
} as const satisfies Record<DetailSource, string>;

/**
 * Tela "Detalhe do lançamento" (Figma 50:785). Principal: trocar a categoria (o dono corrige as que
 * vieram do Pluggy). Também edita descrição e nota, confirma pendentes e apaga (parcela: só esta ou o
 * parcelamento todo). O que vem do banco (valor e data) só é mostrado, com aviso.
 */
export function TransactionDetailScreen({ id }: { id: string }) {
	const router = useRouter();
	const { today } = useClock();
	const { hidden } = usePrivacy();
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	// Depois de trocar a categoria, a gaveta fica aberta oferecendo "Aplicar a todos de <loja>".
	const [offerApply, setOfferApply] = useState(false);
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busyRef = useRef(false);

	const q = useTransactionDetail(id);
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const categoriesQ = useCategories();
	const update = useUpdateTransaction(id);
	const confirm = useConfirmTransaction(id);
	const remove = useDeleteTransaction(id);
	const applyRule = useApplyCategoryRule(id);
	const busy = update.isPending || confirm.isPending || remove.isPending || applyRule.isPending;

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

	/** Roda uma ação uma vez por vez; o erro vira mensagem em pt-BR. */
	const run = async (action: () => Promise<unknown>, after?: () => void) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setMessage(null);
		try {
			await action();
			after?.();
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			busyRef.current = false;
		}
	};

	const t: DetailTransaction | undefined = q.data?.transaction;

	const save = (draft: DetailDraft) => {
		if (!t) return;
		const built = buildPatch(t, draft);
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		if (built.body === null) {
			setSheet(null);
			return;
		}
		const body = built.body;
		void run(
			() => update.mutateAsync(body),
			() => setSheet(null),
		);
	};

	const header = (
		<View
			style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}
		>
			<IconButton icon="voltar" label="Voltar" onPress={close} />
			{t ? (
				<IconButton
					icon="reticencias"
					label="Mais opções"
					onPress={() => {
						setMessage(null);
						setSheet("more");
					}}
				/>
			) : null}
		</View>
	);

	if (!t) {
		const state = toLoadable(q);
		return (
			<Screen>
				<View style={{ paddingHorizontal: spacing.lg, gap: spacing.xxl }}>
					{header}
					{state.phase === "error" ? (
						<ErrorState message={state.message} onRetry={state.retry} />
					) : (
						<View accessibilityLabel="Carregando" style={{ gap: spacing.lg, alignItems: "center" }}>
							<Skeleton height={64} />
							<Skeleton height={46} />
							<Skeleton height={180} />
						</View>
					)}
				</View>
			</Screen>
		);
	}

	const editable = editableFields(t);
	const category = t.categoryId ? categoriesQ.data?.categories.find((c) => c.id === t.categoryId) : undefined;
	const card = t.cardId ? cardsQ.data?.cards.find((c) => c.id === t.cardId) : undefined;
	const account = t.accountId ? accountsQ.data?.accounts.find((a) => a.id === t.accountId) : undefined;
	const origin = card ?? account;
	const invoice = invoiceText(t.invoiceMonth, today);
	const status = statusText(t.status);
	const categories = (categoriesQ.data?.categories ?? []).filter((c) => c.archivedAt === null);
	const categoryReady = categoriesQ.data !== undefined;
	const installment = isInstallment(t);

	const openSheet = (next: OpenSheet) => {
		setMessage(null);
		setOfferApply(false);
		setSheet(next);
	};
	const askDelete = () => {
		setSheet(null);
		setMessage(null);
		if (installment) setSheet("delete");
		else setConfirmDelete(true);
	};
	const selectCategory = (categoryId: string | null) => {
		if (!t) return;
		const built = buildPatch(t, { categoryId });
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		if (built.body === null) {
			setSheet(null);
			return;
		}
		const body = built.body;
		const offer = categoryId !== null && (t.kind === "expense" || t.kind === "refund");
		void run(
			() => update.mutateAsync(body),
			() => (offer ? setOfferApply(true) : setSheet(null)),
		);
	};
	const applyToAll = () => {
		if (!t || t.categoryId === null) return;
		const categoryId = t.categoryId;
		void run(async () => {
			const { updated } = await applyRule.mutateAsync(categoryId);
			setOfferApply(false);
			setMessage(appliedMessage(updated));
		});
	};
	const doDelete = (scope: DeleteScope) => void run(() => remove.mutateAsync(scope), close);

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await Promise.all([q.refetch(), categoriesQ.refetch()]);
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<Screen>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{
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
				{header}
				<DetailSummary
					icon={transactionIcon(t.kind, category?.slug)}
					bank={origin ? bankBadge(origin) : undefined}
					title={t.description}
					amount={money(signedAmount(t), hidden, { sign: amountSignMode(t.kind) })}
					amountTone={amountTone(t.kind)}
					caption={formatEntryDate(t.date, today)}
				/>

				<DetailGroup>
					{editable.category ? (
						<DetailRow
							label="Categoria"
							last={false}
							accessibilityValue={category?.name ?? "sem categoria"}
							{...(categoryReady ? { onPress: () => openSheet("category") } : {})}
						>
							{category ? (
								<CategoryPill name={category.name} chartSlot={category.chartSlot} />
							) : (
								<RowValue>
									{categoryReady ? "Sem categoria" : categoriesQ.isError ? "Indisponível" : "Carregando"}
								</RowValue>
							)}
						</DetailRow>
					) : null}
					{origin ? (
						<DetailRow
							label="Conta"
							last={!t.cardId}
							accessibilityValue={card ? `${card.name} crédito` : (account?.name ?? "")}
						>
							<View
								style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm - 2, flexShrink: 1 }}
							>
								<BankLogo {...bankBadge(origin)} size={20} />
								<RowValue>{card ? `${card.name} · crédito` : origin.name}</RowValue>
							</View>
						</DetailRow>
					) : null}
					{t.cardId ? (
						<DetailRow label="Parcelas" last={invoice === null} accessibilityValue={installmentText(t)}>
							<RowValue>{installmentText(t)}</RowValue>
						</DetailRow>
					) : null}
					{invoice ? (
						<DetailRow label="Entra na fatura de" last accessibilityValue={invoice}>
							<RowValue>{invoice}</RowValue>
						</DetailRow>
					) : null}
				</DetailGroup>
				{bankCategoryLabel(t) ? (
					<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
						{bankCategoryLabel(t)}
					</Text>
				) : null}

				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.group,
						padding: spacing.lg,
						gap: spacing.md - 2,
					}}
				>
					<Text variant="caption" tone="secondary">
						De onde veio
					</Text>
					<OriginLine
						icon={SOURCE_ICON[t.source]}
						title={sourceTitle(t.source)}
						caption={sourceCaption(t.source)}
						done
					/>
					<OriginLine
						icon="revisar"
						title={status.title}
						caption={status.caption}
						done={t.status === "confirmed"}
					/>
					{editable.lockNote ? (
						<Text variant="caption" tone="secondary">
							{editable.lockNote}
						</Text>
					) : null}
				</View>

				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t.note ? `Nota: ${t.note}. Toque para editar` : "Adicionar uma nota"}
					onPress={() => openSheet("note")}
					style={({ pressed }) => ({
						flexDirection: "row",
						alignItems: "center",
						gap: spacing.md - 2,
						minHeight: 50,
						paddingHorizontal: spacing.lg,
						paddingVertical: spacing.md,
						borderRadius: radius.group,
						backgroundColor: colors.surface,
						opacity: pressed ? 0.8 : 1,
					})}
				>
					<Icon name="lapis" size={18} color={colors.textSecondary} />
					<Text variant="body" tone={t.note ? "primary" : "tertiary"} numberOfLines={4} style={{ flex: 1 }}>
						{t.note ?? "Adicionar uma nota"}
					</Text>
				</Pressable>

				<DetailActions
					pending={t.status === "pending"}
					busy={busy}
					onConfirm={() => void run(() => confirm.mutateAsync())}
					onEditDescription={() => openSheet("description")}
					onDelete={askDelete}
				/>

				{message && sheet === null ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{message}
						</Text>
					</View>
				) : null}
			</ScrollView>

			<CategorySheet
				visible={sheet === "category"}
				categories={categories}
				selectedId={t.categoryId}
				busy={busy}
				message={message}
				applyAll={
					offerApply && canApplyToAll(t) ? { label: applyAllLabel(t), onPress: applyToAll } : undefined
				}
				onSelect={selectCategory}
				onClose={() => setSheet(null)}
			/>
			<TextEditSheet
				visible={sheet === "description"}
				title="Descrição"
				label="Descrição"
				initial={t.description}
				maxLength={200}
				busy={busy}
				message={message}
				onSave={(description) => save({ description })}
				onClose={() => setSheet(null)}
			/>
			<TextEditSheet
				visible={sheet === "note"}
				title="Nota"
				label="Nota"
				initial={t.note ?? ""}
				multiline
				maxLength={NOTE_MAX}
				busy={busy}
				message={message}
				onSave={(note) => save({ note })}
				onClose={() => setSheet(null)}
			/>
			<MoreSheet
				visible={sheet === "more"}
				onEditDescription={() => openSheet("description")}
				onEditNote={() => openSheet("note")}
				onDelete={askDelete}
				onClose={() => setSheet(null)}
			/>
			<DeleteSheet
				visible={sheet === "delete"}
				choices={deleteChoices(t)}
				installment
				busy={busy}
				message={message}
				onChoose={doDelete}
				onClose={() => setSheet(null)}
			/>
			<ConfirmDialog
				visible={confirmDelete}
				title="Apagar lançamento?"
				message="O lançamento some do histórico e dos totais. Não dá para desfazer."
				confirmLabel="Apagar"
				onConfirm={() => {
					setConfirmDelete(false);
					doDelete("item");
				}}
				onCancel={() => setConfirmDelete(false)}
			/>
		</Screen>
	);
}
