import { Platform, type TextStyle } from "react-native";

// Geist is not bundled yet; every text role inherits this platform fallback.
export const fontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "system-ui",
});

export const typography = {
  display: {
    fontFamily,
    fontSize: 48,
    lineHeight: 56,
    fontWeight: "700",
  },

  h1: {
    fontFamily,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: "700",
  },

  h2: {
    fontFamily,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
  },

  h3: {
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
  },

  body: {
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },

  bodyMedium: {
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },

  small: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  },

  smallMedium: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },

  caption: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
  },

  captionMedium: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
} as const satisfies Record<string, TextStyle>;