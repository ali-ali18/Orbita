import { colors, radius, spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage } from "../../lib/loadable.ts";
import {
	Button,
	ConfirmDialog,
	ErrorState,
	IconButton,
	Screen,
	Segmented,
	Skeleton,
	Text,
	TextField,
} from "../../ui/index.ts";
import { monthTitle } from "../goals/goals-model.ts";
import { selectableAccounts } from "../settings/preferences-model.ts";
import { ValueSheet } from "../subscriptions/SubscriptionSheets.tsx";
import { useAccounts } from "../summary/queries.ts";
import { formatAmount } from "../transactions/new-transaction-model.ts";
import { IncomeAccountSheet, IncomeMonthSheet, PaydaySheet } from "./IncomeSheets.tsx";
import { buildIncomeRequest, formFromSource, type IncomeForm, initialIncomeForm } from "./income-model.ts";
import { useArchiveIncome, useIncome, useSaveIncome } from "./queries.ts";

type OpenSheet = "amount" | "payday" | "month" | "account" | null;
type Kind = "monthly" | "once";

const KIND_OPTIONS = [
	{ id: "monthly", label: "Todo mês" },
	{ id: "once", label: "Só um mês" },
] as const;

/** Cartão tocável: rótulo pequeno e valor embaixo (o mesmo desenho dos campos da meta). */
function FieldCard({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${label}, ${value}. Alterar`}
			onPress={onPress}
			style={({ pressed }) => ({
				flex: 1,
				gap: spacing.xs,
				minHeight: 72,
				justifyContent: "center",
				paddingHorizontal: spacing.lg,
				paddingVertical: spacing.md,
				borderRadius: radius.block,
				backgroundColor: colors.surface,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Text variant="caption" tone="secondary">
				{label}
			</Text>
			<Text variant="bodyStrong" numberOfLines={1}>
				{value}
			</Text>
		</Pressable>
	);
}

/** "Nova renda" / "Editar renda" (com `?id=`): nome, quanto, dia do pagamento, conta e se é todo mês ou avulsa. */
export function IncomeFormScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const editingId = typeof id === "string" && id !== "" ? id : null;
	const { month } = useClock();
	const incomeQ = useIncome();
	const accountsQ = useAccounts();
	const save = useSaveIncome();
	const archive = useArchiveIncome();
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);

	const [form, setForm] = useState<IncomeForm | null>(null);
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [confirmArchive, setConfirmArchive] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const sources = incomeQ.data?.sources;
	const existing = editingId === null ? undefined : sources?.find((s) => s.id === editingId);
	if (form === null && sources) {
		if (editingId === null) setForm(initialIncomeForm(month, sources.length === 0));
		else if (existing) setForm(formFromSource(existing, month));
	}

	const close = () => (router.canGoBack() ? router.back() : router.replace("/configuracoes/renda"));
	const accounts = selectableAccounts(accountsQ.data?.accounts ?? []);
	const current = form ?? initialIncomeForm(month, true);
	const fail = (error: unknown) =>
		setMessage(error instanceof ApiError ? error.message : errorMessage(error));
	const update = (next: IncomeForm) => {
		setMessage(null);
		setForm(next);
	};

	const submit = () => {
		if (busy.current || !form) return;
		const built = buildIncomeRequest({ form, editingId });
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		busy.current = true;
		setMessage(null);
		save.mutate(built.request, {
			onSuccess: close,
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const doArchive = () => {
		setConfirmArchive(false);
		if (busy.current || editingId === null) return;
		busy.current = true;
		archive.mutate(editingId, {
			onSuccess: close,
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const accountName = accounts.find((a) => a.id === current.accountId)?.name;
	const kind: Kind = current.recurring ? "monthly" : "once";
	const missing = editingId !== null && sources !== undefined && existing === undefined;

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
						<Button
							label={editingId ? "Salvar" : "Cadastrar renda"}
							onPress={submit}
							loading={save.isPending}
							disabled={form === null || archive.isPending}
							style={{ minHeight: 54 }}
						/>
						{editingId ? (
							<Button
								label="Arquivar renda"
								variant="secondary"
								onPress={() => setConfirmArchive(true)}
								loading={archive.isPending}
								disabled={form === null || save.isPending}
							/>
						) : null}
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
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
						<IconButton icon="fechar" label="Fechar" onPress={close} />
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
							{editingId ? "Editar renda" : "Nova renda"}
						</Text>
						<View style={{ width: 44 }} />
					</View>

					{form === null ? (
						incomeQ.isError ? (
							<ErrorState message={errorMessage(incomeQ.error)} onRetry={() => void incomeQ.refetch()} />
						) : missing ? (
							<Text variant="body" tone="secondary">
								Esta renda não existe mais.
							</Text>
						) : (
							<Skeleton height={200} />
						)
					) : (
						<>
							<View style={{ gap: spacing.sm }}>
								<Text variant="caption" tone="secondary">
									De onde vem?
								</Text>
								<TextField
									value={current.name}
									onChangeText={(name) => update({ ...current, name })}
									placeholder="Salário, freela…"
									maxLength={60}
									autoFocus={editingId === null && current.name === ""}
									accessibilityLabel="Nome da renda, de onde vem o dinheiro"
								/>
							</View>

							<Segmented
								options={KIND_OPTIONS}
								value={kind}
								onChange={(next) => update({ ...current, recurring: next === "monthly" })}
							/>

							<View style={{ flexDirection: "row", gap: spacing.md }}>
								<FieldCard
									label="Quanto recebe (líquido)"
									value={current.amountCents > 0 ? formatAmount(current.amountCents) : "R$ 0,00"}
									onPress={() => setSheet("amount")}
								/>
								<FieldCard
									label="Dia do pagamento"
									value={`Dia ${current.payday}`}
									onPress={() => setSheet("payday")}
								/>
							</View>
							{kind === "once" ? (
								<View style={{ flexDirection: "row", gap: spacing.md }}>
									<FieldCard
										label="Em que mês"
										value={monthTitle(current.month)}
										onPress={() => setSheet("month")}
									/>
								</View>
							) : null}
							<View style={{ flexDirection: "row", gap: spacing.md }}>
								<FieldCard
									label="Cai em qual conta"
									value={accountName ?? "Nenhuma"}
									onPress={() => setSheet("account")}
								/>
							</View>
							<Text variant="caption" tone="secondary">
								Com a renda cadastrada, a Órbita monta o plano do mês e nunca sugere gastar mais do que entra.
								Nenhum dinheiro é movido sozinho.
							</Text>
						</>
					)}
				</ScrollView>

				<ValueSheet
					visible={sheet === "amount"}
					cents={current.amountCents}
					title="Quanto você recebe"
					onClose={() => setSheet(null)}
					onDone={(amountCents) => {
						update({ ...current, amountCents });
						setSheet(null);
					}}
				/>
				<PaydaySheet
					visible={sheet === "payday"}
					selected={current.payday}
					onClose={() => setSheet(null)}
					onSelect={(payday) => {
						update({ ...current, payday });
						setSheet(null);
					}}
				/>
				<IncomeMonthSheet
					visible={sheet === "month"}
					currentMonth={month}
					selected={current.month}
					onClose={() => setSheet(null)}
					onSelect={(m) => {
						update({ ...current, month: m });
						setSheet(null);
					}}
				/>
				<IncomeAccountSheet
					visible={sheet === "account"}
					accounts={accounts}
					selectedId={current.accountId}
					onClose={() => setSheet(null)}
					onSelect={(accountId) => {
						update({ ...current, accountId });
						setSheet(null);
					}}
				/>
				<ConfirmDialog
					visible={confirmArchive}
					title="Arquivar esta renda?"
					message="Ela deixa de contar no plano do mês. Os lançamentos que você já fez continuam."
					confirmLabel="Arquivar"
					onConfirm={doArchive}
					onCancel={() => setConfirmArchive(false)}
				/>
			</Screen>
		</KeyboardAvoidingView>
	);
}
