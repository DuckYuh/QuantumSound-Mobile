import { Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { AppProviders } from "@/providers/AppProviders";
import { colors } from "@/theme/colors";
import { navigationTheme } from "@/theme/navigation";
// Validate configuration at startup, before any requests are made.
import "@/config/env";

void SplashScreen.preventAutoHideAsync().catch(() => {
  console.warn("Unable to retain the native splash screen.");
});

export default function RootLayout() {
  useEffect(() => {
    // System fonts are immediately available. Gate here on useFonts when Geist is bundled.
    void SplashScreen.hideAsync().catch(() => {
      console.warn("Unable to dismiss the native splash screen.");
    });
  }, []);

  return (
    <AppProviders>
      <ThemeProvider value={navigationTheme}>
        <View style={styles.root}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.root }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="album/[slug]" />
            <Stack.Screen name="playlist/[id]" />
            <Stack.Screen name="profile/[username]" />
            <Stack.Screen name="track/[id]" />
          </Stack>
        </View>
      </ThemeProvider>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
