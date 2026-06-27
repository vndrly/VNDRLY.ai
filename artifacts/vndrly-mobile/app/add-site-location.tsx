import * as Location from "expo-location";
import { router, Stack } from "expo-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import InPageHeader from "@/components/InPageHeader";
import LayeredPillButton from "@/components/LayeredPillButton";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";

export default function AddSiteLocationScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);

  const onUseLocation = async () => {
    setLocBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert(t("common.error"), t("siteLocations.locationDenied"));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
    } catch (e) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("siteLocations.locationFailed"),
      );
    } finally {
      setLocBusy(false);
    }
  };

  const onCreate = async () => {
    const partnerId = user?.partnerId;
    if (partnerId == null) {
      Alert.alert(t("common.error"), t("siteLocations.partnerRequired"));
      return;
    }
    if (!name.trim() || !address.trim() || latitude == null || longitude == null) {
      Alert.alert(t("common.error"), t("siteLocations.missingFields"));
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/site-locations", {
        method: "POST",
        body: JSON.stringify({
          partnerId,
          name: name.trim(),
          address: address.trim(),
          latitude,
          longitude,
          autoAssignAllVendors: true,
        }),
      });
      Alert.alert(t("siteLocations.createdTitle"), t("siteLocations.createdBody"), [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert(
        t("common.error"),
        e instanceof Error ? e.message : t("siteLocations.createFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("siteLocations.addSite")} />
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={[styles.label, { color: colors.foreground }]}>
          {t("siteLocations.nameLabel")}
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("siteLocations.namePlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        />
        <Text style={[styles.label, { color: colors.foreground }]}>
          {t("siteLocations.addressLabel")}
        </Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder={t("siteLocations.addressPlaceholder")}
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        />
        <LayeredPillButton onPress={onUseLocation} disabled={locBusy} height={44}>
          {locBusy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.btnText}>{t("siteLocations.useMyLocation")}</Text>
          )}
        </LayeredPillButton>
        {latitude != null && longitude != null ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
            {t("siteLocations.coordsHint", {
              lat: latitude.toFixed(5),
              lng: longitude.toFixed(5),
            })}
          </Text>
        ) : null}
        <LayeredPillButton onPress={onCreate} disabled={busy} loading={busy} height={48}>
          <Text style={styles.btnText}>{t("siteLocations.createSite")}</Text>
        </LayeredPillButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  btnText: { color: "#ffffff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
