import { GOAL_ICONS } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, ErrorState, Icon, IconButton, Screen, Skeleton, Text, TextField } from "../../ui/index.ts";
import { selectableAccounts } from "../settings/preferences-model.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import { ValueSheet } from "../subscriptions/SubscriptionSheets.tsx";
import { useAccounts } from "../summary/queries.ts";
import { formatAmount } from "../transactions/new-transaction-model.ts";
import { AccountSheet, DeadlineSheet } from "./GoalSheets.tsx";
import {
	buildRequest,
	formFromGoal,
	GOAL_SLOTS,
	type GoalForm,
	goalColor,
	goalIcon,
	ICON_LABELS,
	initialForm,
	monthTitle,
	previewMonthly,
	previewText,
} from "./goals-model.ts";
import { useGoal, useGoals, useSaveGoal } from "./queries.ts";

type OpenSheet = "target" | "deadline" | "account" | null;

/** Opção redonda de 44 (ícone ou cor), com a borda branca de `accent` na escolhida. */
function Choice({
	label,
	selected,
	onPress,
	children,
}: {
	label: string;
	selected: boolean;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={label}
			accessibilityState={{ checked: selected }}
			onPress={onPress}
			style={({ pressed }) => ({
				width: layout.touchTarget,
				height: layout.touchTarget,
				borderRadius: radius.pill,
				borderWidth: 2,
				borderColor: selected ? colors.accent : "transparent",
				backgroundColor: colors.surface2,
				alignItems: "center",
				justifyContent: "center",
				opacity: pressed ? 0.8 : 1,
			})}
		>
			{children}
		</Pressable>
	);
}

/** Cartão tocável do Figma ("Quanto", "Até quando"): rótulo pequeno e valor embaixo. */
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

/** "Nova meta" (Figma 54:1188). Com `?id=` vira "Editar meta". */
export function GoalFormScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const editingId = typeof id === "string" && id !== "" ? id : null;
	const { today, month } = useClock();
	const goalsQ = useGoals();
	const goalQ = useGoal(editingId);
	const accountsQ = useAccounts();
	const save = useSaveGoal();
	const insets = useSafeAreaInsets();
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);

	const [form, setForm] = useState<GoalForm | null>(null);
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [message, setMessage] = useState<string | null>(null);
	// Altura do rodapé fixo: o fim da rolagem reserva esse espaço para o último texto não ficar embaixo dele.
	const [footerHeight, setFooterHeight] = useState(0);

	// Criar: o formulário nasce quando a lista chega (a cor inicial evita as que as outras metas usam).
	// Editar: nasce quando a meta chega.
	if (form === null) {
		if (editingId === null && goalsQ.data) {
			setForm(initialForm(goalsQ.data.goals.map((g) => g.chartSlot)));
		} else if (editingId !== null && goalQ.data) {
			setForm(formFromGoal(goalQ.data.goal));
		}
	}

	const existing = goalQ.data?.goal;
	const archived = existing?.archivedAt != null;
	const loadError = editingId === null ? goalsQ : goalQ;
	const close = () => (router.canGoBack() ? router.back() : router.replace("/metas"));
	const accounts = selectableAccounts(accountsQ.data?.accounts ?? []);

	const update = (next: GoalForm) => {
		setMessage(null);
		setForm(next);
	};

	const submit = () => {
		if (busy.current || !form) return;
		const built = buildRequest({ form, editingId });
		if (!built.ok) {
			setMessage(built.message);
			return;
		}
		busy.current = true;
		setMessage(null);
		save.mutate(built.request, {
			onSuccess: (goal) => {
				// Criar leva ao detalhe da meta nova (para já poder guardar); editar volta ao detalhe.
				if (editingId === null) router.replace({ pathname: "/meta", params: { id: goal.id } });
				else close();
			},
			onError: (error) => setMessage(error instanceof ApiError ? error.message : errorMessage(error)),
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const current = form ?? initialForm();
	const preview = previewMonthly({
		form: current,
		savedCents: existing?.savedCents ?? 0,
		today,
	});
	const accountName = accounts.find((a) => a.id === current.accountId)?.name;

	return (
		<KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding">
			<Screen
				footer={
					<View
						onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
						style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md }}
					>
						{message ? (
							<View accessibilityRole="alert" accessibilityLiveRegion="polite">
								<Text variant="caption" tone="secondary">
									{message}
								</Text>
							</View>
						) : null}
						<Button
							label={editingId ? "Salvar" : "Criar meta"}
							onPress={submit}
							loading={save.isPending}
							disabled={form === null || archived}
							style={{ minHeight: 54 }}
						/>
					</View>
				}
			>
				<ScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{
						paddingHorizontal: spacing.lg,
						paddingBottom: footerHeight + Math.max(insets.bottom, layout.homeIndicator),
						gap: spacing.md + 2,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
						<IconButton icon="fechar" label="Fechar" onPress={close} />
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
							{editingId ? "Editar meta" : "Nova meta"}
						</Text>
						<View style={{ width: 44 }} />
					</View>

					{form === null ? (
						loadError.isError ? (
							<ErrorState message={errorMessage(loadError.error)} onRetry={() => void loadError.refetch()} />
						) : (
							<Skeleton height={200} />
						)
					) : archived ? (
						<Text variant="body" tone="secondary">
							Esta meta está arquivada e não pode ser editada.
						</Text>
					) : (
						<>
							<View style={{ gap: spacing.sm }}>
								<Text variant="caption" tone="secondary">
									Para quê?
								</Text>
								<TextField
									value={current.name}
									onChangeText={(name) => update({ ...current, name })}
									placeholder="Viagem, reserva, notebook…"
									maxLength={60}
									autoFocus={editingId === null}
									accessibilityLabel="Nome da meta, para quê você está guardando"
								/>
							</View>

							<View style={{ flexDirection: "row", gap: spacing.md }}>
								<FieldCard
									label="Quanto"
									value={current.targetCents > 0 ? formatAmount(current.targetCents) : "R$ 0,00"}
									onPress={() => setSheet("target")}
								/>
								<FieldCard
									label="Até quando"
									value={current.deadlineMonth ? monthTitle(current.deadlineMonth) : "Sem prazo"}
									onPress={() => setSheet("deadline")}
								/>
							</View>

							<View
								accessibilityLiveRegion="polite"
								style={{
									alignItems: "center",
									gap: spacing.xs,
									padding: spacing.xl,
									borderRadius: radius.block,
									backgroundColor: colors.surface,
								}}
							>
								<Text variant="caption" tone="secondary">
									Você precisa guardar
								</Text>
								<Text variant="numberLarge" style={{ textAlign: "center" }}>
									{previewText(preview, current.targetCents > 0)}
								</Text>
								{preview && existing && existing.savedCents > 0 ? (
									<Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
										Já descontei o que você guardou até agora.
									</Text>
								) : null}
							</View>

							<View style={{ gap: spacing.sm }}>
								<Text variant="caption" tone="secondary">
									Ícone
								</Text>
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
									{GOAL_ICONS.map((icon) => (
										<Choice
											key={icon}
											label={ICON_LABELS[icon]}
											selected={current.icon === icon}
											onPress={() => update({ ...current, icon })}
										>
											<Icon name={goalIcon(icon)} size={20} />
										</Choice>
									))}
								</View>
							</View>

							<View style={{ gap: spacing.sm }}>
								<Text variant="caption" tone="secondary">
									Cor da barra
								</Text>
								<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
									{GOAL_SLOTS.map((slot) => (
										<Choice
											key={slot}
											label={`Cor ${slot + 1}`}
											selected={current.chartSlot === slot}
											onPress={() => update({ ...current, chartSlot: slot })}
										>
											<View
												style={{
													width: spacing.xl,
													height: spacing.xl,
													borderRadius: radius.pill,
													backgroundColor: goalColor(slot),
												}}
											/>
										</Choice>
									))}
								</View>
							</View>

							<SettingsSection>
								<SettingsRow
									last
									title="Onde está guardado"
									value={accountName ?? "Nenhuma"}
									onPress={() => setSheet("account")}
								/>
							</SettingsSection>
							<Text variant="caption" tone="secondary">
								A meta só acompanha o que você guarda. Nenhum dinheiro é movido sozinho.
							</Text>
						</>
					)}
				</ScrollView>

				<ValueSheet
					visible={sheet === "target"}
					cents={current.targetCents}
					title="Quanto você quer guardar"
					onClose={() => setSheet(null)}
					onDone={(targetCents) => {
						update({ ...current, targetCents });
						setSheet(null);
					}}
				/>
				<DeadlineSheet
					visible={sheet === "deadline"}
					currentMonth={month}
					selected={current.deadlineMonth}
					onClose={() => setSheet(null)}
					onSelect={(deadlineMonth) => {
						update({ ...current, deadlineMonth });
						setSheet(null);
					}}
				/>
				<AccountSheet
					visible={sheet === "account"}
					accounts={accounts}
					selectedId={current.accountId}
					onClose={() => setSheet(null)}
					onSelect={(accountId) => {
						update({ ...current, accountId });
						setSheet(null);
					}}
				/>
			</Screen>
		</KeyboardAvoidingView>
	);
}
