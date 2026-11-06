import { colors } from "@orbita/tokens";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "../lib/api.ts";
import { PrivacyProvider } from "../lib/privacy.tsx";
import { SessionProvider, useSession } from "../lib/session.tsx";
import { geistFonts } from "../ui/index.ts";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Routes() {
	const { state } = useSession();
	const signedIn = state.status === "in";
	return (
		<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
			<Stack.Protected guard={signedIn}>
				<Stack.Screen name="index" />
			</Stack.Protected>
			<Stack.Protected guard={state.status === "out"}>
				<Stack.Screen name="conectar" />
			</Stack.Protected>
		</Stack>
	);
}

export default function RootLayout() {
	const [fontsLoaded, fontError] = useFonts(geistFonts);
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 30_000,
						// Erro da API (4xx) não melhora tentando de novo; só rede fora do ar.
						retry: (count, error) => !(error instanceof ApiError && error.status !== null) && count < 2,
					},
				},
			}),
	);

	useEffect(() => {
		if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
	}, [fontsLoaded, fontError]);

	if (!fontsLoaded && !fontError) return null;

	return (
		<SafeAreaProvider>
			<QueryClientProvider client={queryClient}>
				<SessionProvider>
					<PrivacyProvider>
						<StatusBar style="light" />
						<Routes />
					</PrivacyProvider>
				</SessionProvider>
			</QueryClientProvider>
		</SafeAreaProvider>
	);
}
