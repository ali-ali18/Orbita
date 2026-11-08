import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ElementRef, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import {
	BankLogo,
	Button,
	ConfirmDialog,
	ErrorState,
	familyByWeight,
	IconButton,
	LetterAvatar,
	Screen,
	Skeleton,
	Text,
} from "../../ui/index.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { initialOf } from "../summary/transaction-model.ts";
import { effectiveSource, formatAmount, sourceOptions } from "../transactions/new-transaction-model.ts";
import { SourceSheet } from "../transactions/PickerSheets.tsx";
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
	POPULAR_SERVICES,
	parseSourceKey,
	type SubscriptionForm,
	subscriptionsCategoryId,
} from "./subscriptions-model.ts";

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
			categoryId: subscriptionsCategoryId(categoriesQ.data?.categories ?? []),
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
							<View
								style={{
									height: 48,
									borderRadius: radius.card - 4,
									backgroundColor: colors.surface,
									paddingHorizontal: spacing.lg,
									justifyContent: "center",
								}}
							>
								<TextInput
									ref={nameInput}
									value={current.name}
									onChangeText={(name) => update({ ...current, name })}
									placeholder="Nome do serviço"
									placeholderTextColor={colors.textSecondary}
									maxLength={60}
									accessibilityLabel="Nome da assinatura"
									style={{
										color: colors.text,
										fontFamily: familyByWeight[400],
										fontSize: typography.body.fontSize,
										lineHeight: typography.body.lineHeight,
										letterSpacing: typography.body.letterSpacing,
										paddingVertical: 0,
									}}
								/>
							</View>

							{editingId ? null : (
								<View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 14 }}>
									{POPULAR_SERVICES.map((name) => (
										<ServiceChip
											key={name}
											name={name}
											selected={current.name.trim().toLowerCase() === name.toLowerCase()}
											onPress={() => update({ ...current, name })}
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

							<SettingsSection>
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
										last
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
							</SettingsSection>
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
