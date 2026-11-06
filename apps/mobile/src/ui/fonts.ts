// Um import por peso: o barril do pacote registraria as 18 variações (Italic, Thin…) no app.
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";

/** O RN escolhe a fonte pelo NOME da família, não pelo peso: um nome por peso do Geist. */
export const geistFonts = {
	Geist_400Regular,
	Geist_500Medium,
	Geist_600SemiBold,
	Geist_700Bold,
};

export const familyByWeight = {
	400: "Geist_400Regular",
	500: "Geist_500Medium",
	600: "Geist_600SemiBold",
	700: "Geist_700Bold",
} as const;
