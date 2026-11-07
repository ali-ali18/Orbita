import type { Cents } from "@orbita/core";
import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { Button, familyByWeight, Sheet, Text } from "../../ui/index.ts";
import { AmountInput } from "../transactions/AmountInput.tsx";
import { parseDay } from "./subscriptions-model.ts";

/** Gaveta do valor: o mesmo teclado de centavos do Novo lançamento. */
export function ValueSheet({
	visible,
	cents,
	onDone,
	onClose,
}: {
	visible: boolean;
	cents: Cents;
	onDone: (cents: Cents) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Valor da cobrança" onClose={onClose}>
			{visible ? <ValueBody initial={cents} onDone={onDone} /> : null}
		</Sheet>
	);
}

function ValueBody({ initial, onDone }: { initial: Cents; onDone: (cents: Cents) => void }) {
	const [cents, setCents] = useState<Cents>(initial);
	return (
		<View style={{ gap: spacing.lg, paddingVertical: spacing.md }}>
			<AmountInput cents={cents} onChange={setCents} autoFocus label="Valor da cobrança" />
			<Button label="Pronto" disabled={cents <= 0} onPress={() => onDone(cents)} />
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
			<TextInput
				value={text}
				onChangeText={(t) => setText(t.replace(/\D/g, "").slice(0, 2))}
				keyboardType="number-pad"
				inputMode="numeric"
				maxLength={2}
				autoFocus
				selectTextOnFocus
				accessibilityLabel="Dia do mês da cobrança"
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
			{text !== "" && parsed === null ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
					O dia vai de 1 a 31.
				</Text>
			) : null}
			<Button label="Pronto" disabled={parsed === null} onPress={() => parsed !== null && onDone(parsed)} />
		</View>
	);
}
