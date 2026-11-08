import { colors } from "@orbita/tokens";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AutoUpdate } from "../lib/auto-update.tsx";
import { ClockProvider } from "../lib/clock.tsx";
import { PrivacyProvider, usePrivacy } from "../lib/privacy.tsx";
import { bindFocusToAppState, createAppQueryClient } from "../lib/query-client.ts";
import { SessionProvider, useSession } from "../lib/session.tsx";
import { geistFonts } from "../ui/index.ts";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Routes() {
	const { state } = useSession();
	return (
		<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
			<Stack.Screen name="previa" />
			<Stack.Protected guard={state.status === "in"}>
				<Stack.Screen name="index" />
				<Stack.Screen
					name="novo"
					dangerouslySingular
					options={{ presentation: "modal", animation: "slide_from_bottom" }}
				/>
				<Stack.Screen name="atividades" />
				<Stack.Screen name="revisao" />
				<Stack.Screen name="chat" options={{ animation: "slide_from_bottom" }} />
				<Stack.Screen name="cartao" />
				<Stack.Screen name="lancamento/[id]" />
				<Stack.Screen name="assinaturas" />
				<Stack.Screen name="assinatura" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
				<Stack.Screen name="configuracoes/index" />
				<Stack.Screen name="configuracoes/servidor" />
				<Stack.Screen name="configuracoes/bancos" />
				<Stack.Screen name="configuracoes/orcamento" />
				<Stack.Screen name="configuracoes/categorias" />
				<Stack.Screen name="configuracoes/primeira-vez" />
			</Stack.Protected>
			<Stack.Protected guard={state.status === "out"}>
				<Stack.Screen name="conectar" />
			</Stack.Protected>
		</Stack>
	);
}

/** Segura a splash até as fontes, a sessão e a preferência de privacidade estarem prontas: sem pisca-pisca. */
function Gate({ children }: { children: ReactElement }) {
	const [fontsLoaded, fontError] = useFonts(geistFonts);
	const { state } = useSession();
	const { loaded: privacyLoaded } = usePrivacy();
	const ready = (fontsLoaded || fontError !== null) && state.status !== "loading" && privacyLoaded;

	useEffect(() => {
		if (ready) SplashScreen.hideAsync().catch(() => {});
	}, [ready]);

	return ready ? children : null;
}

/** Liga o `onError` global das consultas ao tratamento de 401 da sessão. */
function QueryErrorBridge({ target }: { target: React.RefObject<(error: unknown) => void> }) {
	const { handleQueryError } = useSession();
	useEffect(() => {
		target.current = handleQueryError;
	}, [target, handleQueryError]);
	return null;
}

export default function RootLayout() {
	const onError = useRef<(error: unknown) => void>(() => {});
	const [queryClient] = useState(() => createAppQueryClient((e) => onError.current(e)));

	useEffect(() => bindFocusToAppState(), []);

	return (
		<SafeAreaProvider>
			<QueryClientProvider client={queryClient}>
				<ClockProvider>
					<SessionProvider>
						<QueryErrorBridge target={onError} />
						<AutoUpdate />
						<PrivacyProvider>
							<StatusBar style="light" />
							<Gate>
								<Routes />
							</Gate>
						</PrivacyProvider>
					</SessionProvider>
				</ClockProvider>
			</QueryClientProvider>
		</SafeAreaProvider>
	);
}
