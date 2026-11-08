import { colors, spacing, text as typography } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { createSubmissionKey } from "../../lib/idempotency.ts";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import {
	BankLogo,
	Button,
	ErrorState,
	familyByWeight,
	IconButton,
	Screen,
	Skeleton,
	Text,
} from "../../ui/index.ts";
import { useAccounts, useCards, useCategories } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { AmountInput } from "./AmountInput.tsx";
import { CategoryChips } from "./CategoryChips.tsx";
import { EntryTabs } from "./EntryTabs.tsx";
import { FieldRow } from "./FieldRow.tsx";
import { useCreateTransaction } from "./mutations.ts";
import {
	buildRequest,
	canInstall,
	effectiveSource,
	formatEntryDate,
	initialForm,
	installmentLabel,
	type NewTransactionForm,
	sourceOptions,
	withKind,
	withSource,
} from "./new-transaction-model.ts";
import { DateSheet, InstallmentsSheet, SourceSheet } from "./PickerSheets.tsx";
import { ShortcutButton } from "./ShortcutButton.tsx";

type OpenSheet = "source" | "installments" | "date" | null;

/** Tela "Novo lançamento" (Figma 33:404): despesa ou receita, à vista ou parcelada no cartão. */
export function NewTransactionScreen() {
	const router = useRouter();
	const { today } = useClock();
	const [form, setForm] = useState<NewTransactionForm>(() => initialForm(today));
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [message, setMessage] = useState<string | null>(null);
	const create = useCreateTransaction();
	// Uma chave por "salvar": igual enquanto o pedido é o mesmo (nova tentativa depois de rede caída), nova se o
	// formulário mudar ou o salvamento der certo.
	const [submission] = useState(() => createSubmissionKey());
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const submitting = useRef(false);

	const accountsQ = useAccounts();
	const cardsQ = useCards();
	const categoriesQ = useCategories();
	const sources = combineLoadables(toLoadable(accountsQ), toLoadable(cardsQ));
	const categories = toLoadable(categoriesQ);

	const options =
		sources.phase === "ready"
			? sourceOptions(form.kind, sources.data[0].accounts, sources.data[1].cards)
			: [];
	const source = effectiveSource(form.sourceKey, options);
	const installable = canInstall(form.kind, source);
	// Se a escolha saiu da lista (ex.: mudou para Entrada), as parcelas já foram zeradas em `withKind`.
	const installments = installable ? form.installments : 1;

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

	const update = (next: NewTransactionForm) => {
		setMessage(null);
		submission.renew();
		setForm(next);
	};

	const submit = () => {
		if (submitting.current) return;
		const built = buildRequest({ ...form, installments }, source);
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		setMessage(null);
		submitting.current = true;
		create.mutate(
			{ request: built.request, idempotencyKey: submission.current() },
			{
				onSuccess: () => {
					submission.renew();
					close();
				},
				onError: (error) => setMessage(error instanceof ApiError ? error.message : errorMessage(error)),
				onSettled: () => {
					submitting.current = false;
				},
			},
		);
	};

	// O teclado sobe junto com a tela inteira, inclusive o rodapé com o botão (fora da rolagem).
	return (
		<KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
			<Screen
				footer={
					<View
						style={{
							paddingHorizontal: spacing.lg,
							paddingTop: spacing.sm,
							gap: spacing.md,
							backgroundColor: colors.background,
						}}
					>
						{message ? (
							<View accessibilityRole="alert" accessibilityLiveRegion="polite">
								<Text variant="caption" tone="secondary">
									{message}
								</Text>
							</View>
						) : null}
						<Button
							label="Adicionar lançamento"
							onPress={submit}
							loading={create.isPending}
							disabled={sources.phase !== "ready"}
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
						gap: spacing.lg,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
						<View style={{ width: 44 }} />
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
							Novo lançamento
						</Text>
						<IconButton icon="fechar" label="Fechar" onPress={close} />
					</View>

					<EntryTabs value={form.kind} onChange={(kind) => update(withKind(form, kind))} />

					<View style={{ paddingTop: spacing.md, gap: spacing.sm }}>
						<AmountInput
							cents={form.amountCents}
							onChange={(amountCents) => update({ ...form, amountCents })}
							autoFocus
						/>
						<View style={{ flexDirection: "row", gap: spacing.sm }}>
							<ShortcutButton icon="escanear" label="Ler comprovante" disabled />
							<ShortcutButton icon="microfone" label="Ditar" disabled />
						</View>
					</View>

					<View style={{ paddingTop: spacing.xs }}>
						<FieldRow label="Descrição">
							<TextInput
								value={form.description}
								onChangeText={(description) => update({ ...form, description })}
								placeholder="Ex.: iFood"
								placeholderTextColor={colors.textTertiary}
								maxLength={200}
								accessibilityLabel="Descrição"
								style={{
									width: "60%",
									textAlign: "right",
									color: colors.text,
									fontFamily: familyByWeight[400],
									fontSize: typography.body.fontSize,
									lineHeight: typography.body.lineHeight,
									letterSpacing: typography.body.letterSpacing,
									paddingVertical: 0,
								}}
							/>
						</FieldRow>

						{sources.phase === "ready" ? (
							<FieldRow
								label="Conta"
								onPress={() => setSheet("source")}
								accessibilityValue={source?.label ?? "nenhuma"}
							>
								{source ? (
									<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
										<BankLogo {...bankBadge(source)} size={22} />
										<Text variant="body">{source.label}</Text>
									</View>
								) : (
									<Text variant="body" tone="tertiary">
										Nenhuma conta cadastrada
									</Text>
								)}
							</FieldRow>
						) : (
							<View style={{ paddingVertical: spacing.lg }}>
								{sources.phase === "loading" ? (
									<Skeleton height={20} />
								) : (
									<ErrorState message={sources.message} onRetry={sources.retry} />
								)}
							</View>
						)}

						{installable ? (
							<FieldRow
								label="Parcelas"
								onPress={() => setSheet("installments")}
								accessibilityValue={installmentLabel(installments, form.amountCents)}
							>
								<Text variant="body">{installmentLabel(installments, form.amountCents)}</Text>
							</FieldRow>
						) : null}

						<FieldRow
							label="Data"
							onPress={() => setSheet("date")}
							accessibilityValue={formatEntryDate(form.date, today)}
						>
							<Text variant="body">{formatEntryDate(form.date, today)}</Text>
						</FieldRow>
					</View>

					<View style={{ gap: spacing.sm }}>
						<Text variant="body" tone="secondary">
							Categoria
						</Text>
						{categories.phase === "ready" ? (
							<CategoryChips
								categories={categories.data.categories.filter((c) => c.archivedAt === null)}
								selectedId={form.categoryId}
								onSelect={(categoryId) => update({ ...form, categoryId })}
							/>
						) : categories.phase === "loading" ? (
							<Skeleton height={36} />
						) : (
							<ErrorState message={categories.message} onRetry={categories.retry} />
						)}
					</View>
				</ScrollView>

				<SourceSheet
					visible={sheet === "source"}
					options={options}
					selectedKey={source?.key}
					onClose={() => setSheet(null)}
					onSelect={(key) => {
						update(withSource(form, key));
						setSheet(null);
					}}
				/>
				<InstallmentsSheet
					visible={sheet === "installments"}
					totalCents={form.amountCents}
					selected={installments}
					onClose={() => setSheet(null)}
					onSelect={(count) => {
						update({ ...form, installments: count });
						setSheet(null);
					}}
				/>
				<DateSheet
					visible={sheet === "date"}
					today={today}
					selected={form.date}
					onClose={() => setSheet(null)}
					onSelect={(date) => {
						update({ ...form, date });
						setSheet(null);
					}}
				/>
			</Screen>
		</KeyboardAvoidingView>
	);
}
