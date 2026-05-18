import React, { useEffect, useState, type ReactNode, isValidElement } from "react";
import { Image, Platform, type ImageProps } from "react-native";

import { getToken } from "@/lib/auth";
import { getApiBase } from "@/lib/api";

type Props = Omit<ImageProps, "source"> & {
  uri: string | null | undefined;
  // Either a static <Image source> value (require/uri) OR a React node
  // rendered in place of the Image when no URI resolves OR the load fails.
  fallback?: ImageProps["source"] | ReactNode;
};

/**
 * RN <Image> wrapper that injects the session bearer token when the
 * URI points at our auth-gated `/api/storage/objects/*` endpoint.
 *
 * Background: storage objects with visibility "public" still require
 * an authenticated session to read (see api-server src/routes/storage.ts).
 * Plain `<Image source={{ uri }}>` calls go through the OS image
 * loader, which does NOT carry our auth header — the request 401s and
 * the image renders blank. Symptom: a logged-in field employee at
 * Winchester sees an empty square where the org logo should be.
 *
 * We resolve the token on mount (and whenever the URI changes) and
 * pass it via the `headers` field on the source object — RN's Image
 * loader honors that for native HTTP fetches.
 */
function renderFallback(
  fallback: Props["fallback"],
  rest: Omit<ImageProps, "source">,
): ReactNode {
  if (fallback == null) return null;
  // ReactNode (e.g. <View>...) — render directly.
  if (isValidElement(fallback)) return fallback;
  // Otherwise treat it as an Image source (require(...) / { uri }).
  return <Image {...rest} source={fallback as ImageProps["source"]} />;
}

export default function AuthedImage({ uri, fallback, ...rest }: Props) {
  const [authedUri, setAuthedUri] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(
    undefined,
  );
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revoke: string | null = null;
    setErrored(false);
    void (async () => {
      if (!uri) {
        setAuthedUri(null);
        setHeaders(undefined);
        return;
      }
      const isStorageUrl = uri.includes("/api/storage/objects/");
      if (!isStorageUrl) {
        setAuthedUri(uri);
        setHeaders(undefined);
        return;
      }
      // Normalize to an absolute URL — RN's Image loader treats relative
      // URIs against an undefined base, which silently fails on native.
      const absolute = /^https?:\/\//i.test(uri)
        ? uri
        : `${getApiBase()}${uri.startsWith("/") ? "" : "/"}${uri}`;
      const token = await getToken();
      if (cancelled) return;

      // On web (Expo web in the canvas iframe, react-native-web), RN's
      // <Image> compiles to a plain <img>. <img> does NOT honour the
      // `headers` field on the source object — the auth header is
      // dropped, the request 401s, and the org logo silently falls back
      // to the brand initial. Fetch the asset ourselves with the bearer
      // token, blob it, and hand <img> a same-origin object URL instead.
      if (Platform.OS === "web") {
        try {
          const res = await fetch(absolute, {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          revoke = objectUrl;
          setAuthedUri(objectUrl);
          setHeaders(undefined);
        } catch {
          if (!cancelled) setErrored(true);
        }
        return;
      }

      setAuthedUri(absolute);
      setHeaders(token ? { authorization: `Bearer ${token}` } : undefined);
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [uri]);

  if (!authedUri || errored) {
    return <>{renderFallback(fallback, rest)}</>;
  }

  return (
    <Image
      {...rest}
      source={{ uri: authedUri, headers }}
      onError={() => setErrored(true)}
    />
  );
}
