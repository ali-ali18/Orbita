import type { Cents } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { View } from "react-native";
import { Button, Sheet, Text, TextField } from "../../ui/index.ts";
import { AmountInput } from "../transactions/AmountInput.tsx";
import { parseDay } from "./subscriptions-model.ts";

/**
 * Gaveta do valor: o mesmo teclado de centavos do Novo lançamento. Serve também a outras telas (o valor da meta,
 * o "Guardar"): o título, o rótulo do campo e o botão mudam por prop.
 */
export function ValueSheet({
	visible,
	cents,
	onDone,
	onClose,
	title = "Valor da cobrança",
	doneLabel = "Pronto",
}: {
	visible: boolean;
	cents: Cents;
	onDone: (cents: Cents) => void;
	onClose: () => void;
	title?: string;
	doneLabel?: string;
}) {
	return (
		<Sheet visible={visible} title={title} onClose={onClose}>
			{visible ? <ValueBody initial={cents} label={title} doneLabel={doneLabel} onDone={onDone} /> : null}
		</Sheet>
	);
}

function ValueBody({
	initial,
	label,
	doneLabel,
	onDone,
}: {
	initial: Cents;
	label: string;
	doneLabel: string;
	onDone: (cents: Cents) => void;
}) {
	const [cents, setCents] = useState<Cents>(initial);
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			<AmountInput cents={cents} onChange={setCents} autoFocus label={label} />
			<Button label={doneLabel} disabled={cents <= 0} onPress={() => onDone(cents)} />
		</View>
	);
}

/** Gaveta do dia da cobrança (1 a 31; em mês curto cai no último dia). */
export function DaySheet({
	visible,
	day,
	onDone,
	onClose,
}: {
	visible: boolean;
	day: number;
	onDone: (day: number) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Dia da cobrança" onClose={onClose}>
			{visible ? <DayBody initial={day} onDone={onDone} /> : null}
		</Sheet>
	);
}

function DayBody({ initial, onDone }: { initial: number; onDone: (day: number) => void }) {
	const [text, setText] = useState(String(initial));
	const parsed = parseDay(text);
	return (
		<View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
			<Text variant="caption" tone="secondary">
				De 1 a 31. Em mês mais curto, vale o último dia.
			</Text>
			<TextField
				value={text}
				onChangeText={(t) => setText(t.replace(/\D/g, "").slice(0, 2))}
				keyboardType="number-pad"
				inputMode="numeric"
				maxLength={2}
				autoFocus
				selectTextOnFocus
				accessibilityLabel="Dia do mês da cobrança"
			/>
			{text !== "" && parsed === null ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					O dia vai de 1 a 31.
				</Text>
			) : null}
			<Button label="Pronto" disabled={parsed === null} onPress={() => parsed !== null && onDone(parsed)} />
		</View>
	);
}
