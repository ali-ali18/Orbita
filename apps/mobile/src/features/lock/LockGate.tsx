import { colors, spacing } from "@orbita/tokens";
import { type ReactNode, useEffect, useRef } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Button, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";
import { useLock } from "./LockProvider.tsx";

/** Tela de bloqueio. `interactive` só quando travado; coberta por estar em segundo plano, mostra só a marca. */
function LockScreen({ interactive, message, busy, onUnlock }: LockScreenProps) {
	useEffect(() => {
		if (!interactive) return;
		// Travado, o botão voltar não pode navegar pelo app escondido atrás.
		const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
		return () => sub.remove();
	}, [interactive]);

	return (
		<Screen
			footer={
				interactive ? (
					<View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
						<Button label="Desbloquear" onPress={onUnlock} disabled={busy} />
					</View>
				) : undefined
			}
		>
			<View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
				<OrbitaAvatar size={spacing.xxxl * 3} />
				{interactive ? (
					<>
						<Text variant="numberMedium" accessibilityRole="header">
							Órbita bloqueado
						</Text>
						{message ? (
							<Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
								{message}
							</Text>
						) : null}
					</>
				) : null}
			</View>
		</Screen>
	);
}

interface LockScreenProps {
	interactive: boolean;
	message: string | null;
	busy: boolean;
	onUnlock: () => void;
}

/**
 * Esconde o app atrás da tela de bloqueio. Na abertura a frio travada, o app nem é montado (nada de dados nem
 * telas por baixo); depois do primeiro destravamento ele fica montado e a tela de bloqueio o cobre por cima,
 * opaca, sempre que trava ou que o app vai para segundo plano. Ao travar, já abre o aviso do sistema uma vez.
 */
export function LockGate({ children }: { children: ReactNode }) {
	const { state, covered, unlock } = useLock();
	const revealed = useRef(false);
	if (state.status === "unlocked") revealed.current = true;

	const locked = state.status === "locked";
	const autoPrompt = locked && !state.authenticating && state.message === null;
	useEffect(() => {
		if (autoPrompt) void unlock();
	}, [autoPrompt, unlock]);

	return (
		<View style={{ flex: 1, backgroundColor: colors.background }}>
			<View
				style={{ flex: 1 }}
				importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
				accessibilityElementsHidden={covered}
			>
				{revealed.current ? children : null}
			</View>
			{covered ? (
				<View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
					<LockScreen
						interactive={locked}
						message={state.message}
						busy={state.authenticating}
						onUnlock={() => void unlock()}
					/>
				</View>
			) : null}
		</View>
	);
}
