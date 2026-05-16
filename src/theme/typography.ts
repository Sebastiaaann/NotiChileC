import type { TextStyle } from "react-native";

export const fonts = {
  sans: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semiBold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  display: {
    medium: "PlusJakartaSans_500Medium",
    semiBold: "PlusJakartaSans_600SemiBold",
    bold: "PlusJakartaSans_700Bold",
  },
  mono: {
    regular: "JetBrainsMono_400Regular",
    bold: "JetBrainsMono_700Bold",
  },
  serifItalic: "LibreBaskerville_400Regular_Italic",
} as const;

type TypographyToken =
  | "tabLabel"
  | "navTitle"
  | "sectionLabel"
  | "cardMeta"
  | "cardCode"
  | "cardTitle"
  | "cardSubtitle"
  | "screenTitle"
  | "detailTitle"
  | "detailMetric"
  | "buttonLabel"
  | "emptyStateAccent"
  | "settingsValueMono"
  | "body"
  | "bodyStrong"
  | "meta"
  | "monoMeta";

export const typography: Record<TypographyToken, TextStyle> = {
  tabLabel: {
    fontFamily: fonts.sans.medium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.2,
  },
  navTitle: {
    fontFamily: fonts.display.semiBold,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  sectionLabel: {
    fontFamily: fonts.display.semiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
  },
  cardMeta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  cardCode: {
    fontFamily: fonts.mono.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  cardTitle: {
    fontFamily: fonts.display.semiBold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  screenTitle: {
    fontFamily: fonts.display.bold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  detailTitle: {
    fontFamily: fonts.display.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  detailMetric: {
    fontFamily: fonts.display.semiBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  buttonLabel: {
    fontFamily: fonts.sans.semiBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  emptyStateAccent: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    lineHeight: 20,
  },
  settingsValueMono: {
    fontFamily: fonts.mono.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  body: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily: fonts.sans.semiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  monoMeta: {
    fontFamily: fonts.mono.regular,
    fontSize: 12,
    lineHeight: 16,
  },
};
