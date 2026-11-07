import type { Cents, LocalDate } from "@orbita/core";
import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { type ReactNode, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { BankLogo, Button, familyByWeight, Icon, Sheet, Text } from "../../ui/index.ts";
import { bankColor } from "../summary/summary-model.ts";
import { initialOf } from "../summary/transaction-model.ts";
import {
	formatEntryDate,
	INSTALLMENT_COUNTS,
	installmentLabel,
	maskBrDate,
	parseBrDate,
	quickDates,
	type SourceOption,
} from "./new-transaction-model.ts";

/** Linha de escolha de uma gaveta: 56 de altura, marca de "escolhido" à direita. */
function OptionRow({
	selected,
	label,
	caption,
	leading,
	onPress,
}: {
	selected: boolean;
	label: string;
	caption?: string | null | undefined;
	leading?: ReactNode;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={caption ? `${label}, ${caption}` : label}
			accessibilityState={{ selected }}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 56,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			{leading}
			<View style={{ flex: 1 }}>
				<Text variant="body">{label}</Text>
				{caption ? (
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				) : null}
			</View>
			{selected ? <Icon name="check" size={20} /> : null}
		</Pressable>
	);
}

export function SourceSheet({
	visible,
	options,
	selectedKey,
	onSelect,
	onClose,
}: {
	visible: boolean;
	options: readonly SourceOption[];
	selectedKey: string | undefined;
	onSelect: (key: string) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Conta ou cartão" onClose={onClose}>
			{options.map((o) => (
				<OptionRow
					key={o.key}
					selected={o.key === selectedKey}
					label={o.label}
					caption={o.detail}
					leading={<BankLogo initial={initialOf(o.name)} color={bankColor(o.bankCode)} size={32} />}
					onPress={() => onSelect(o.key)}
				/>
			))}
		</Sheet>
	);
}

export function InstallmentsSheet({
	visible,
	totalCents,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	totalCents: Cents;
	selected: number;
	onSelect: (count: number) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Parcelas" onClose={onClose}>
			{INSTALLMENT_COUNTS.map((n) => (
				<OptionRow
					key={n}
					selected={n === selected}
					label={installmentLabel(n, totalCents)}
					onPress={() => onSelect(n)}
				/>
			))}
		</Sheet>
	);
}

export function DateSheet({
	visible,
	today,
	selected,
	onSelect,
	onClose,
}: {
	visible: boolean;
	today: LocalDate;
	selected: LocalDate;
	onSelect: (date: LocalDate) => void;
	onClose: () => void;
}) {
	const [typed, setTyped] = useState("");
	const parsed = parseBrDate(typed);
	const showError = typed.replace(/\D/g, "").length === 8 && parsed === null;
	return (
		<Sheet visible={visible} title="Data" onClose={onClose}>
			{quickDates(today).map((d) => (
				<OptionRow
					key={d}
					selected={d === selected}
					label={formatEntryDate(d, today)}
					onPress={() => onSelect(d)}
				/>
			))}
			<View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
				<Text variant="caption" tone="secondary">
					Outra data
				</Text>
				<TextInput
					value={typed}
					onChangeText={(t) => setTyped(maskBrDate(t))}
					placeholder="DD/MM/AAAA"
					placeholderTextColor={colors.textTertiary}
					keyboardType="number-pad"
					inputMode="numeric"
					maxLength={10}
					accessibilityLabel="Outra data, dia, mês e ano"
					style={{
						height: 52,
						borderRadius: radius.inner,
						backgroundColor: colors.surface2,
						paddingHorizontal: spacing.lg,
						color: colors.text,
						fontFamily: familyByWeight[400],
						fontSize: typography.body.fontSize,
						lineHeight: typography.body.lineHeight,
					}}
				/>
				{showError ? (
					<Text variant="caption" tone="secondary" accessibilityRole="alert">
						Essa data não existe. Use dia/mês/ano, por exemplo 05/11/2026.
					</Text>
				) : null}
				<Button
					label="Usar esta data"
					variant="secondary"
					disabled={parsed === null}
					onPress={() => parsed && onSelect(parsed)}
				/>
			</View>
		</Sheet>
	);
}
