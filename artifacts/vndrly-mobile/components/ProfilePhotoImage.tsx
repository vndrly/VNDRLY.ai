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
  testID?: string;
  onError?: () => void;
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
  testID,
  onError,
}: Props) {
  const uri = resolveProfilePhotoUrl(profilePhotoPath, photoUrl);
  const protectedPhoto = Boolean(uri && isVndrlyStoragePhotoUrl(uri));
  const [authorization, setAuthorization] = useState<{
    uri: string;
    headers: Record<string, string> | undefined;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uri || !protectedPhoto) return;
    void getToken().then((token) => {
      const bearer = token?.trim();
      if (cancelled || !bearer) return;
      setAuthorization({
        uri,
        headers: { Authorization: `Bearer ${bearer}` },
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [protectedPhoto, uri]);

  if (!uri) return null;
  if (protectedPhoto && (authorization?.uri !== uri || !authorization.headers?.Authorization)) return null;
  const headers = protectedPhoto ? authorization?.headers : undefined;

  return (
    <Image
      key={uri}
      source={{ uri, ...(headers ? { headers } : {}) }}
      style={style}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onError={onError}
      cachePolicy="none"
    />
  );
}
