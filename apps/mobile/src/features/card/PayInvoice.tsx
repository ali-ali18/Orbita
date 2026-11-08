import type { Cents } from "@orbita/core";
import { spacing } from "@orbita/tokens";
import { useRef, useState } from "react";
import { View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { money } from "../../lib/format.ts";
import { createSubmissionKey } from "../../lib/idempotency.ts";
import { errorMessage } from "../../lib/loadable.ts";
import { BankLogo, Button, Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import { useAccounts } from "../summary/queries.ts";
import { bankBadge } from "../summary/summary-model.ts";
import { payerAccounts } from "./card-model.ts";
import { usePayInvoice, useUndoInvoicePayment } from "./queries.ts";

/**
 * "Marcar como paga" (Figma 33:501): escolhe de qual conta sai o dinheiro e o servidor lança o pagamento do que
 * falta da fatura. Depois do pagamento, "Desfazer" apaga esse lançamento.
 */
export function PayInvoice({
	cardId,
	month,
	remainingCents,
	hidden,
}: {
	cardId: string;
	month: string;
	remainingCents: Cents;
	hidden: boolean;
}) {
	const accountsQ = useAccounts();
	const pay = usePayInvoice();
	const undo = useUndoInvoicePayment();
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [paymentId, setPaymentId] = useState<string | null>(null);
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);
	const key = useRef(createSubmissionKey());
	const accounts = payerAccounts(accountsQ.data?.accounts ?? []);

	const fail = (error: unknown) =>
		setMessage(error instanceof ApiError ? error.message : errorMessage(error));

	const choose = (accountId: string) => {
		if (busy.current) return;
		busy.current = true;
		setMessage(null);
		pay.mutate(
			{ cardId, month, accountId, idempotencyKey: key.current.current() },
			{
				onSuccess: (id) => {
					key.current.renew();
					setPaymentId(id);
					setOpen(false);
					setMessage("Fatura marcada como paga.");
				},
				onError: (error) => {
					setOpen(false);
					fail(error);
				},
				onSettled: () => {
					busy.current = false;
				},
			},
		);
	};

	const undoPayment = () => {
		if (busy.current || paymentId === null) return;
		busy.current = true;
		undo.mutate(paymentId, {
			onSuccess: () => {
				setPaymentId(null);
				setMessage("Pagamento desfeito.");
			},
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	return (
		<View style={{ gap: spacing.md }}>
			{message ? (
				<View
					accessibilityRole="alert"
					accessibilityLiveRegion="polite"
					style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
				>
					<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
						{message}
					</Text>
					{paymentId !== null ? (
						<Button
							label="Desfazer"
							variant="secondary"
							compact
							loading={undo.isPending}
							onPress={undoPayment}
						/>
					) : null}
				</View>
			) : null}
			{remainingCents > 0 ? (
				<Button
					label="Marcar como paga"
					variant="secondary"
					loading={pay.isPending}
					onPress={() => setOpen(true)}
				/>
			) : null}
			<Sheet visible={open} title="Pagar com qual conta?" onClose={() => setOpen(false)}>
				<View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
					<Text variant="caption" tone="secondary">
						{`Lanço o pagamento de ${money(remainingCents, hidden)}, o que falta desta fatura. Nada sai da sua conta de verdade: o Órbita só registra.`}
					</Text>
					{accounts.length === 0 ? (
						<Text variant="body" tone="secondary">
							{accountsQ.isError ? "Não consegui carregar suas contas." : "Nenhuma conta cadastrada."}
						</Text>
					) : (
						<SheetGroup gap={false}>
							{accounts.map((a) => (
								<SheetRow
									key={a.id}
									label={a.name}
									leading={<BankLogo {...bankBadge(a)} size={32} />}
									onPress={() => choose(a.id)}
								/>
							))}
						</SheetGroup>
					)}
				</View>
			</Sheet>
		</View>
	);
}
