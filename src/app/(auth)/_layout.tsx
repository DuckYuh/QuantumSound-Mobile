import { Stack } from "expo-router";
import { colors } from "@/theme/colors";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, presentation: "card", contentStyle: { backgroundColor: colors.background } }} />;
}
