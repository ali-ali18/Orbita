import { colors, radius, spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ElementRef, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, type TextInput, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import {
	BankLogo,
	Button,
	ConfirmDialog,
	ErrorState,
	Icon,
	IconButton,
	LetterAvatar,
	Screen,
	Skeleton,
	Text,
	TextField,
} from "../../ui/index.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "../settings/SettingsRows.tsx";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { initialOf } from "../summary/transaction-model.ts";
import { effectiveSource, formatAmount, sourceOptions } from "../transactions/new-transaction-model.ts";
import { SourceSheet } from "../transactions/PickerSheets.tsx";
import { categoryIdByName, featuredServices, searchServices, serviceByName } from "./catalog.ts";
import {
	useArchiveSubscription,
	useMonthTransactions,
	usePostSubscription,
	useRecurrences,
	useSaveSubscription,
} from "./queries.ts";
import { DaySheet, ValueSheet } from "./SubscriptionSheets.tsx";
import {
	buildRequest,
	formFromRecurrence,
	initialForm,
	monthStatus,
	parseSourceKey,
	REMINDER_CAPTION,
	type SubscriptionForm,
	subscriptionsCategoryId,
} from "./subscriptions-model.ts";

/** Categoria do serviço escolhido no catálogo; sem ela (ou sem a categoria do dono), vale "Assinaturas". */
function formCategoryId(
	form: SubscriptionForm,
	categories: readonly { id: string; name: string; archivedAt: string | null }[],
): string | null {
	const own = form.categoryName ? categoryIdByName(categories, form.categoryName) : null;
	return own ?? subscriptionsCategoryId(categories);
}

type OpenSheet = "value" | "day" | "source" | null;

/** Serviço escolhido: a borda branca de 3 do Figma; o resto fica só com o nome em cinza. */
function ServiceChip({
	name,
	letter,
	selected,
	onPress,
}: {
	name: string;
	letter?: string;
	selected: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={name}
			accessibilityState={{ selected }}
			onPress={onPress}
			style={({ pressed }) => ({ width: 80, alignItems: "center", gap: 6, opacity: pressed ? 0.8 : 1 })}
		>
			<View
				style={{
					borderRadius: radius.pill,
					borderWidth: 3,
					borderColor: selected ? colors.accent : colors.background,
				}}
			>
				<LetterAvatar letter={letter ?? initialOf(name)} size={56 - 6} color={colors.surface3} />
			</View>
			<Text variant="caption" tone={selected ? "primary" : "secondary"} numberOfLines={1}>
				{name}
			</Text>
		</Pressable>
	);
}

/** "Nova assinatura" (Figma 51:830). Com `?id=` vira a edição, com a opção de arquivar. */
export function NewSubscriptionScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const editingId = typeof id === "string" && id !== "" ? id : null;
	const { today, month } = useClock();
	const recurrencesQ = useRecurrences();
	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const categoriesQ = useCategories();
	const save = useSaveSubscription();
	const archive = useArchiveSubscription();
	const postNow = usePostSubscription();
	const monthTxQ = useMonthTransactions(month);
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);

	const [form, setForm] = useState<SubscriptionForm | null>(() => (editingId ? null : initialForm(today)));
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [confirmingArchive, setConfirmingArchive] = useState(false);
	const nameInput = useRef<ElementRef<typeof TextInput>>(null);

	const sources = combineLoadables(toLoadable(accountsQ), toLoadable(cardsQ));
	const existing = editingId ? recurrencesQ.data?.recurrences.find((r) => r.id === editingId) : undefined;
	// Na edição o formulário nasce quando a assinatura chega.
	if (editingId && form === null && existing) setForm(formFromRecurrence(existing));

	const close = () => (router.canGoBack() ? router.back() : router.replace("/assinaturas"));
	const options =
		sources.phase === "ready"
			? sourceOptions("expense", sources.data[0].accounts, sources.data[1].cards)
			: [];
	const current = form ?? initialForm(today);
	const source = effectiveSource(current.sourceKey, options);

	const setName = (name: string) =>
		update({ ...current, name, categoryName: serviceByName(name)?.category ?? null });
	const suggestions = editingId
		? []
		: searchServices(current.name).filter((s) => s.name !== current.name.trim());

	const update = (next: SubscriptionForm) => {
		setMessage(null);
		setForm(next);
	};

	const finish = (error: unknown) =>
		setMessage(error instanceof ApiError ? error.message : errorMessage(error));

	const submit = () => {
		if (busy.current || !form) return;
		const built = buildRequest({
			form,
			source: parseSourceKey(source?.key),
			today,
			categoryId: formCategoryId(form, categoriesQ.data?.categories ?? []),
			editingId,
		});
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		busy.current = true;
		setMessage(null);
		save.mutate(built.request, {
			onSuccess: close,
			onError: finish,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const confirmArchive = () => {
		if (busy.current || !editingId) return;
		busy.current = true;
		setConfirmingArchive(false);
		archive.mutate(editingId, {
			onSuccess: close,
			onError: finish,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	// 409 = já estava lançada (por fora do app): vale como feito, a lista recarrega e a linha passa a "lançada".
	const post = () => {
		if (busy.current || !editingId) return;
		busy.current = true;
		setMessage(null);
		postNow.mutate(
			{ id: editingId, month },
			{
				onSuccess: close,
				onError: (error) => (error instanceof ApiError && error.status === 409 ? close() : finish(error)),
				onSettled: () => {
					busy.current = false;
				},
			},
		);
	};
	const canPost =
		existing !== undefined &&
		monthTxQ.data !== undefined &&
		monthStatus(existing, month, monthTxQ.data.transactions) === "pending";

	const loadingExisting = editingId !== null && form === null;
	const missing = editingId !== null && form === null && recurrencesQ.isSuccess && !existing;

	return (
		<KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
			<Screen
				footer={
					<View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md }}>
						{message ? (
							<View accessibilityRole="alert" accessibilityLiveRegion="polite">
								<Text variant="caption" tone="secondary">
									{message}
								</Text>
							</View>
						) : null}
						{canPost ? (
							<Button label="Lançar agora" variant="secondary" loading={postNow.isPending} onPress={post} />
						) : null}
						{editingId ? (
							<Button
								label="Arquivar assinatura"
								variant="secondary"
								disabled={form === null}
								loading={archive.isPending}
								onPress={() => setConfirmingArchive(true)}
							/>
						) : null}
						<Button
							label={editingId ? "Salvar" : "Adicionar assinatura"}
							onPress={submit}
							loading={save.isPending}
							disabled={form === null || sources.phase !== "ready"}
							style={{ minHeight: 54 }}
						/>
					</View>
				}
			>
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{
						paddingHorizontal: spacing.lg,
						paddingBottom: spacing.lg,
						gap: spacing.md + 2,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
						<View style={{ width: 44 }} />
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
							{editingId ? "Editar assinatura" : "Nova assinatura"}
						</Text>
						<IconButton icon="fechar" label="Fechar" onPress={close} />
					</View>

					{missing ? (
						<Text variant="body" tone="secondary">
							Não encontrei essa assinatura. Ela pode ter sido arquivada.
						</Text>
					) : loadingExisting ? (
						recurrencesQ.isError ? (
							<ErrorState
								message={errorMessage(recurrencesQ.error)}
								onRetry={() => void recurrencesQ.refetch()}
							/>
						) : (
							<Skeleton height={200} />
						)
					) : (
						<>
							<View>
								{editingId ? null : (
									<View
										pointerEvents="none"
										style={{
											position: "absolute",
											left: spacing.lg,
											top: 0,
											bottom: 0,
											justifyContent: "center",
											zIndex: 1,
										}}
									>
										<Icon name="buscar" size={20} color={colors.textSecondary} />
									</View>
								)}
								<TextField
									inputRef={nameInput}
									value={current.name}
									onChangeText={setName}
									placeholder={editingId ? "Nome do serviço" : "Buscar serviço"}
									maxLength={60}
									accessibilityLabel={editingId ? "Nome da assinatura" : "Buscar serviço ou digitar o nome"}
									style={editingId ? null : { paddingLeft: spacing.lg + 20 + spacing.sm }}
								/>
							</View>

							{suggestions.length > 0 ? (
								<SettingsSection>
									{suggestions.map((service, i) => (
										<SettingsRow
											key={service.id}
											leading={
												<LetterAvatar letter={initialOf(service.name)} size={32} color={colors.surface3} />
											}
											title={service.name}
											chevron={false}
											last={i === suggestions.length - 1}
											onPress={() => setName(service.name)}
										/>
									))}
								</SettingsSection>
							) : null}

							{editingId ? null : (
								<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 14 }}>
									{featuredServices().map((service) => (
										<ServiceChip
											key={service.id}
											name={service.shortName ?? service.name}
											selected={serviceByName(current.name)?.id === service.id}
											onPress={() => setName(service.name)}
										/>
									))}
									<ServiceChip
										name="Outro"
										letter="+"
										selected={false}
										onPress={() => nameInput.current?.focus()}
									/>
								</View>
							)}

							<SettingsSection {...(current.name.trim() ? { title: current.name.trim() } : {})}>
								<SettingsRow
									title="Valor"
									value={formatAmount(current.amountCents)}
									onPress={() => setSheet("value")}
								/>
								<SettingsRow
									title="Cobrança"
									value={`Todo dia ${current.dayOfMonth}`}
									onPress={() => setSheet("day")}
								/>
								{sources.phase === "ready" ? (
									<SettingsRow
										title={source?.type === "card" ? "Cartão" : "Conta"}
										chevron
										trailing={
											source ? (
												<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
													<BankLogo {...bankBadge(source)} size={20} />
													<Text variant="caption" tone="secondary" numberOfLines={1}>
														{source.label}
													</Text>
												</View>
											) : (
												<Text variant="caption" tone="tertiary">
													Nenhuma conta cadastrada
												</Text>
											)
										}
										onPress={() => setSheet("source")}
									/>
								) : (
									<View style={{ padding: spacing.lg }}>
										{sources.phase === "loading" ? (
											<Skeleton height={20} />
										) : (
											<ErrorState message={sources.message} onRetry={sources.retry} />
										)}
									</View>
								)}
								<SettingsRow
									last
									title="Lembrar 1 dia antes"
									chevron={false}
									toggled={current.remindDayBefore}
									onPress={() => update({ ...current, remindDayBefore: !current.remindDayBefore })}
									trailing={<StaticSwitch on={current.remindDayBefore} />}
								/>
							</SettingsSection>
							<Text variant="caption" tone="secondary">
								{REMINDER_CAPTION}
							</Text>
						</>
					)}
				</ScrollView>

				<ValueSheet
					visible={sheet === "value"}
					cents={current.amountCents}
					onClose={() => setSheet(null)}
					onDone={(amountCents) => {
						update({ ...current, amountCents });
						setSheet(null);
					}}
				/>
				<DaySheet
					visible={sheet === "day"}
					day={current.dayOfMonth}
					onClose={() => setSheet(null)}
					onDone={(dayOfMonth) => {
						update({ ...current, dayOfMonth });
						setSheet(null);
					}}
				/>
				<SourceSheet
					visible={sheet === "source"}
					options={options}
					selectedKey={source?.key}
					onClose={() => setSheet(null)}
					onSelect={(key) => {
						update({ ...current, sourceKey: key });
						setSheet(null);
					}}
				/>
				<ConfirmDialog
					visible={confirmingArchive}
					title="Arquivar esta assinatura?"
					message="Ela some da lista e deixa de ser esperada nos próximos meses. Os lançamentos que já existem ficam."
					confirmLabel="Arquivar"
					onConfirm={confirmArchive}
					onCancel={() => setConfirmingArchive(false)}
				/>
			</Screen>
		</KeyboardAvoidingView>
	);
}
