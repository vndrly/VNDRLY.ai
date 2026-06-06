import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { type ImageStyle, type StyleProp } from "react-native";

import { getToken } from "@/lib/auth";
import { isVndrlyStoragePhotoUrl, resolveProfilePhotoUrl } from "@/lib/profile-photo";

type Props = {
  profilePhotoPath: string | null | undefined;
  photoUrl?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
};

/**
 * Profile avatar that prefers `profilePhotoPath` and attaches the bearer
 * token for VNDRLY storage URLs (RN Image does not send auth cookies).
 */
export default function ProfilePhotoImage({
  profilePhotoPath,
  photoUrl,
  style,
  accessibilityLabel,
}: Props) {
  const uri = resolveProfilePhotoUrl(profilePhotoPath, photoUrl);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!uri || !isVndrlyStoragePhotoUrl(uri)) {
      setHeaders(undefined);
      return;
    }
    void getToken().then((token) => {
      if (cancelled) return;
      setHeaders(token ? { Authorization: `Bearer ${token}` } : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!uri) return null;

  return (
    <Image
      key={uri}
      source={{ uri, headers }}
      style={style}
      accessibilityLabel={accessibilityLabel}
      cachePolicy="none"
    />
  );
}
