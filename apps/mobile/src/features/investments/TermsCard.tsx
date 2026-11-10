import type { InvestmentPositionDto, InvestmentRateKind } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { usePrivacy } from "../../lib/privacy.tsx";
import { useAccent } from "../../lib/theme.tsx";
import { Button, Card, Icon, Segmented, Sheet, Text, TextField } from "../../ui/index.ts";
import { maskBrDate, parseBrDate, toBrDate } from "../activity/filters-model.ts";
import { AmountInput } from "../transactions/AmountInput.tsx";
import { useSaveTerms } from "./queries.ts";
import {
	bankLine,
	buildTermsBody,
	expectedView,
	isInformed,
	parseRateText,
	RATE_KIND_OPTIONS,
	rateDraft,
	startDateProblem,
	type TermsChange,
	type TermsField,
	type TermsRow,
	termsRows,
} from "./terms-model.ts";

const FIELD_TITLES: Record<TermsField, string> = { rate: "Taxa", invested: "Aplicado", startDate: "Desde" };

function TermsLine({ row, last, onPress }: { row: TermsRow; last: boolean; onPress: () => void }) {
	const { accent, onAccent } = useAccent();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={row.a11y}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				minHeight: layout.touchTarget,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Text variant="body" tone="secondary" style={{ flex: 1 }}>
				{row.label}
			</Text>
			{row.value === null ? (
				<View
					style={{
						paddingHorizontal: spacing.md,
						paddingVertical: spacing.xs,
						borderRadius: radius.pill,
						backgroundColor: accent,
					}}
				>
					<Text variant="micro" style={{ color: onAccent }}>
						Informar
					</Text>
				</View>
			) : (
				<>
					{row.user ? (
						<Text variant="micro" tone="secondary">
							você
						</Text>
					) : null}
					<Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
						{row.value}
					</Text>
				</>
			)}
			<Icon name="seta-direita" size={16} color={colors.textTertiary} />
		</Pressable>
	);
}

function ExpectedBlock({ p }: { p: InvestmentPositionDto }) {
	const { hidden } = usePrivacy();
	const view = expectedView(p, hidden);
	if (view.kind === "none") return null;
	if (view.kind === "unavailable") {
		return (
			<View style={{ minHeight: layout.touchTarget, justifyContent: "center" }}>
				<Text variant="caption" tone="secondary">
					{view.text}
				</Text>
			</View>
		);
	}
	return (
		<View accessible accessibilityLabel={view.a11y} style={{ gap: spacing.xs, paddingTop: spacing.sm }}>
			{view.lines.map((l) => (
				<View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
					<Text variant={l.tone === "secondary" ? "caption" : "body"} tone="secondary" style={{ flex: 1 }}>
						{l.label}
					</Text>
					<Text
						variant={l.tone === "secondary" ? "caption" : "bodyStrong"}
						tone={l.tone === "secondary" ? "secondary" : l.tone}
					>
						{l.value}
					</Text>
				</View>
			))}
			<View style={{ flexDirection: "row", gap: spacing.sm }}>
				<Text variant="micro" tone="secondary">
					{view.until}
				</Text>
				{view.approx ? (
					<Text variant="micro" tone="warning">
						aprox.
					</Text>
				) : null}
			</View>
		</View>
	);
}

/** Cartão "Condições" do detalhe (taxa, aplicado, desde) e, quando há, o rendimento esperado. Sem nada num servidor antigo. */
export function TermsCard({ position: p }: { position: InvestmentPositionDto }) {
	const { hidden } = usePrivacy();
	const { today } = useClock();
	const rows = termsRows(p, hidden, today);
	const [open, setOpen] = useState(false);
	const [field, setField] = useState<TermsField>("rate");
	const [session, setSession] = useState(0);
	if (!rows) return null;
	return (
		<>
			<Card style={{ gap: spacing.xs }}>
				<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
					Condições
				</Text>
				<View>
					{rows.map((row, i) => (
						<TermsLine
							key={row.field}
							row={row}
							last={i === rows.length - 1}
							onPress={() => {
								setField(row.field);
								setSession((n) => n + 1);
								setOpen(true);
							}}
						/>
					))}
				</View>
				<ExpectedBlock p={p} />
			</Card>
			<Sheet visible={open} title={FIELD_TITLES[field]} onClose={() => setOpen(false)}>
				<TermsForm key={session} position={p} field={field} today={today} onDone={() => setOpen(false)} />
			</Sheet>
		</>
	);
}

function TermsForm({
	position: p,
	field,
	today,
	onDone,
}: {
	position: InvestmentPositionDto;
	field: TermsField;
	today: string;
	onDone: () => void;
}) {
	const { hidden } = usePrivacy();
	const save = useSaveTerms(p.id);
	const draft = rateDraft(p);
	const [kind, setKind] = useState<InvestmentRateKind>(draft.kind);
	const [rateText, setRateText] = useState(draft.text);
	const [hintShown, setHintShown] = useState(draft.hint !== null);
	const [cents, setCents] = useState(p.terms?.invested?.cents ?? 0);
	const [dateText, setDateText] = useState(p.terms?.startDate ? toBrDate(p.terms.startDate.date) : "");
	const [problem, setProblem] = useState<string | null>(null);

	const submit = (change: TermsChange) => {
		setProblem(null);
		save.mutate(buildTermsBody(p, change), { onSuccess: onDone });
	};

	const onSave = () => {
		if (field === "rate") {
			const parsed = parseRateText(rateText, kind);
			if ("error" in parsed) return setProblem(parsed.error);
			return submit({ field, value: { kind, bps: parsed.bps } });
		}
		if (field === "invested") {
			if (cents <= 0) return setProblem("Informe o valor");
			return submit({ field, value: cents });
		}
		const date = parseBrDate(dateText);
		const err = startDateProblem(date, today);
		if (err !== null || date === null) return setProblem(err ?? "Data inválida");
		return submit({ field, value: date });
	};

	const bank = bankLine(p, field, hidden);
	const error =
		problem ??
		(save.error ? (save.error instanceof ApiError ? save.error.message : "Não deu para salvar") : null);

	return (
		<View style={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
			{field === "rate" ? (
				<View style={{ gap: spacing.md }}>
					<Segmented options={RATE_KIND_OPTIONS} value={kind} onChange={setKind} />
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
						<TextField
							value={rateText}
							onChangeText={(t) => {
								setRateText(t);
								setHintShown(false);
							}}
							placeholder="0,00"
							keyboardType="decimal-pad"
							maxLength={7}
							autoFocus
							accessibilityLabel="Taxa em porcentagem"
							style={{ flex: 1 }}
						/>
						<Text variant="bodyStrong" tone="secondary">
							%
						</Text>
					</View>
					{hintShown ? (
						<Text variant="caption" tone="secondary">
							Sugestão do nome
						</Text>
					) : null}
				</View>
			) : field === "invested" ? (
				<AmountInput cents={cents} onChange={setCents} autoFocus label="Valor aplicado em reais" />
			) : (
				<TextField
					value={dateText}
					onChangeText={(t) => setDateText(maskBrDate(t))}
					placeholder="dd/mm/aaaa"
					keyboardType="number-pad"
					maxLength={10}
					autoFocus
					accessibilityLabel="Data da aplicação"
				/>
			)}
			{bank ? (
				<Text variant="caption" tone="secondary">
					{bank}
				</Text>
			) : null}
			{error ? (
				<Text variant="caption" tone="warning" accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : null}
			<View style={{ flexDirection: "row", gap: spacing.md }}>
				{isInformed(p, field) ? (
					<Button
						label="Limpar"
						variant="secondary"
						disabled={save.isPending}
						onPress={() => submit({ field, value: null } as TermsChange)}
						style={{ flex: 1 }}
					/>
				) : null}
				<Button label="Salvar" loading={save.isPending} onPress={onSave} style={{ flex: 1 }} />
			</View>
		</View>
	);
}
