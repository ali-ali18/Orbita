import type { Cents, LocalDate } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { BankLogo, Button, Sheet, SheetGroup, SheetRow, Text, TextField } from "../../ui/index.ts";
import { bankBadge } from "../summary/summary-model.ts";
import {
	formatEntryDate,
	INSTALLMENT_COUNTS,
	installmentLabel,
	maskBrDate,
	parseBrDate,
	quickDates,
	type SourceOption,
} from "./new-transaction-model.ts";

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
			<SheetGroup gap={false}>
				{options.map((o) => (
					<SheetRow
						key={o.key}
						selected={o.key === selectedKey}
						label={o.label}
						caption={o.detail}
						leading={<BankLogo {...bankBadge(o)} size={32} />}
						onPress={() => onSelect(o.key)}
					/>
				))}
			</SheetGroup>
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
			<SheetGroup gap={false}>
				{INSTALLMENT_COUNTS.map((n) => (
					<SheetRow
						key={n}
						selected={n === selected}
						label={installmentLabel(n, totalCents)}
						onPress={() => onSelect(n)}
					/>
				))}
			</SheetGroup>
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
			<SheetGroup>
				{quickDates(today).map((d) => (
					<SheetRow
						key={d}
						selected={d === selected}
						label={formatEntryDate(d, today)}
						onPress={() => onSelect(d)}
					/>
				))}
			</SheetGroup>
			<View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
				<Text variant="caption" tone="secondary">
					Outra data
				</Text>
				<TextField
					value={typed}
					onChangeText={(t) => setTyped(maskBrDate(t))}
					placeholder="DD/MM/AAAA"
					keyboardType="number-pad"
					inputMode="numeric"
					maxLength={10}
					accessibilityLabel="Outra data, dia, mês e ano"
				/>
				{showError ? (
					<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
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
