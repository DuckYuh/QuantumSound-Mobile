export const colors = {
  // Brand
  primary: "#7c5cff",
  primaryHover: "#6a4dff",
  primaryActive: "#5a3cff",
  secondary: "#5ed9ff",
  accent: "#ff8a4c",

  // Background
  background: "#0f0f10",
  surface: "#18181b",
  surfaceHover: "#222228",
  surfaceActive: "#2d2d35",

  // Border
  border: "#303038",
  borderHover: "#454550",

  // Text
  foreground: "#fafafa",
  muted: "#b3b3b3",
  disabled: "#737373",

  // Status
  success: "#22c55e",
  warning: "#facc15",
  danger: "#ef4444",
  info: "#38bdf8",

  // Common
  transparent: "transparent",
  white: "#ffffff",
  black: "#000000",
} as const;

export type ColorToken = keyof typeof colors;