// Global vitest setup for the Expo mobile artifact.
//
// Two recurring jsdom-environment failures were leaking into per-file
// test runs and causing the entire file's `describe` block to never
// execute (vitest marked them as "0 tests / 1 failed file"):
//
//   1. `expo-modules-core` constructs an `EventEmitter` that reads
//      `globalThis.expo.EventEmitter`. In Expo apps that global is
//      injected by the bundler/runtime; in jsdom it is `undefined` and
//      every transitive importer (e.g. `expo-secure-store`, used by
//      `useBrand`) throws `TypeError: Cannot read properties of
//      undefined (reading 'EventEmitter')` at module load time.
//
//   2. The `expo` package's `async-require/setup.ts` runs
//      `require('./setupFastRefresh')` as a top-level side effect when
//      `typeof window !== 'undefined'` (which is true in jsdom).
//      Node's CommonJS resolver can't find that `.ts` file at runtime
//      (vitest's transform pipeline doesn't kick in for raw `require`
//      from the published package), so any test that pulls in the
//      `expo` package indirectly (e.g. through `expo-router`'s
//      transitive deps) crashes before the test body loads.
//
// Fixing either issue inside individual test files is whack-a-mole
// (4 files affected today, more whenever a new screen test imports a
// new Expo module). A single global setup file resolves both for every
// test in the package without the per-file mocks having to duplicate
// the workaround.

import path from "node:path";
import Module from "node:module";
import { vi } from "vitest";

const ASSETS_ROOT = path.resolve(__dirname);
const _Module = Module as unknown as {
  _resolveFilename: (
    request: string,
    parent: NodeModule,
    ...rest: unknown[]
  ) => string;
  _extensions: Record<string, (m: { exports: unknown }, f: string) => void>;
};
const origResolve = _Module._resolveFilename.bind(_Module);
_Module._resolveFilename = (request, parent, ...rest) => {
  if (request.startsWith("@/assets/") && request.endsWith(".png")) {
    return path.join(ASSETS_ROOT, request.slice(2));
  }
  return origResolve(request, parent, ...rest);
};
_Module._extensions[".png"] = (m, filename) => {
  m.exports = filename;
};

// ── Fix #1: stub `globalThis.expo.EventEmitter` ──────────────────────
//
// `expo-modules-core/src/EventEmitter.ts` exports a binding pulled off
// `globalThis.expo`. We provide a tiny in-memory event emitter that
// matches the surface the Expo modules use (`addListener`, `removeAllListeners`,
// `emit`, etc.) so module load doesn't crash and any code that
// subscribes during a test gets predictable no-op handles back.
class StubEventEmitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  addListener(event: string, fn: (...args: unknown[]) => void) {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(fn);
    return {
      remove: () => {
        bucket?.delete(fn);
      },
    };
  }
  removeAllListeners(event?: string) {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
  removeListener(event: string, fn: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }
  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// `globalThis.expo.modules[moduleName]` is the first place
// `requireOptionalNativeModule` looks. With an empty object, every
// lookup returns `undefined` and `requireNativeModule` then throws
// `Cannot find native module 'X'` for every Expo module that isn't
// individually mocked (ExpoAsset, ExpoConstants, etc.).
//
// Wrapping `modules` in a Proxy means *any* native module name
// resolves to a permissive object, so module load succeeds even when
// the test never touches the API in question. The returned object is
// itself a Proxy that returns no-op functions for any property access,
// matching the loose Expo native-module surface.
const noopNativeModule: ProxyHandler<Record<string, unknown>> = {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (prop === "addListener" || prop === "removeAllListeners")
      return () => ({ remove: () => {} });
    return () => undefined;
  },
};
const modulesProxy = new Proxy(
  {} as Record<string, Record<string, unknown>>,
  {
    get(target, name: string) {
      if (!(name in target))
        target[name] = new Proxy({} as Record<string, unknown>, noopNativeModule);
      return target[name];
    },
  },
);

const expoGlobal: {
  EventEmitter: typeof StubEventEmitter;
  modules: Record<string, unknown>;
  NativeModule: typeof StubEventEmitter;
  SharedObject: typeof StubEventEmitter;
  SharedRef: typeof StubEventEmitter;
} = {
  EventEmitter: StubEventEmitter,
  modules: modulesProxy,
  // `expo-modules-core` reads NativeModule/SharedObject/SharedRef off the
  // global at module load. They're used as base classes; reusing the
  // event emitter stub gives them a constructable shape.
  NativeModule: StubEventEmitter,
  SharedObject: StubEventEmitter,
  SharedRef: StubEventEmitter,
};

// `globalThis.expo` typing in `expo-modules-core` is loose; `as never`
// avoids needing to recreate that ambient interface here.
(globalThis as unknown as { expo: typeof expoGlobal }).expo = expoGlobal;

// ── Fix #2: short-circuit `expo`'s async-require side effect ─────────
//
// The publication of `expo@54` ships `async-require/setup.ts` with a
// top-level `require('./setupFastRefresh')` that fails under jsdom.
// We mock the entire `expo` async-require entrypoints so any
// transitive importer (notably `expo-router` → `expo` → `setup.ts`)
// is satisfied with a no-op. Tests that need to assert against any of
// these symbols can override the mock locally.
vi.mock("expo/src/async-require/setup", () => ({}));
vi.mock("expo/src/async-require/setupFastRefresh", () => ({}));
vi.mock("expo/src/async-require/setupHMR", () => ({}));
vi.mock("expo/src/async-require/messageSocket", () => ({}));
vi.mock("expo/build/async-require/setup", () => ({}));
vi.mock("expo/build/async-require/setupFastRefresh", () => ({}));
vi.mock("expo/build/async-require/setupHMR", () => ({}));
vi.mock("expo/build/async-require/messageSocket", () => ({}));

// `expo/src/Expo.fx.tsx` is the package's top-level side-effect file:
// it imports `expo-asset`, runs the `__DEV__`-gated
// `require('./async-require/messageSocket')`, and wires the global
// error handler. Once `globalThis.expo` is defined (which we do above
// for the EventEmitter shim), the `__DEV__` branch fires and the bare
// CJS `require()` of a `.ts` file blows up under Node's resolver.
//
// Stubbing `Expo.fx` plus the bare `expo` package short-circuits all
// of that — every transitive importer of `expo` (e.g.
// `expo-notifications`) sees an inert module and tests can load.
vi.mock("expo/src/Expo.fx", () => ({}));
vi.mock("expo/build/Expo.fx", () => ({}));
vi.mock("expo", () => ({
  registerRootComponent: () => undefined,
  disableErrorHandling: () => undefined,
}));

// `expo/src/winter/runtime.ts` does the same dynamic-`require` dance:
// it eagerly calls `require('./ImportMetaRegistry').ImportMetaRegistry`
// at module load and crashes under the same Node/CJS resolution gap.
// Stubbing the runtime entrypoint (and the ImportMetaRegistry it
// reaches for) keeps any transitive importer of the `expo` package
// happy without polluting individual test files.
vi.mock("expo/src/winter/runtime", () => ({}));
vi.mock("expo/src/winter/ImportMetaRegistry", () => ({
  ImportMetaRegistry: class {
    register() {}
    get() {
      return undefined;
    }
  },
}));
vi.mock("expo/build/winter/runtime", () => ({}));
vi.mock("expo/build/winter/ImportMetaRegistry", () => ({
  ImportMetaRegistry: class {
    register() {}
    get() {
      return undefined;
    }
  },
}));

// `expo/src/Expo.fx.tsx` runs `import 'expo-asset'` as a side effect at
// the top of the `expo` package's main entry. `expo-asset` then calls
// `requireNativeModule('ExpoAsset')` which has no jsdom equivalent, so
// any test that transitively imports the bare `expo` package (e.g.
// through `expo-notifications` → `expo`) crashes at module load. A
// no-op stub keeps the side-effect import satisfied without dragging
// the native bridge in.
vi.mock("expo-asset", () => ({
  Asset: class {
    static fromModule() {
      return { uri: "", localUri: "", downloadAsync: async () => undefined };
    }
    static fromURI() {
      return { uri: "", localUri: "", downloadAsync: async () => undefined };
    }
  },
}));

// ── Fix #3: stub `expo-secure-store` so module load is safe ──────────
//
// Even with the EventEmitter shim in place, `expo-secure-store`'s
// native module bridge tries to attach to a runtime that isn't there
// in jsdom. A tiny in-memory map gives every test a working
// `getItemAsync` / `setItemAsync` / `deleteItemAsync` without needing
// per-file mocks. Tests that want to assert against the store can
// import `vi` and override these methods locally.
vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY",
    ALWAYS: "ALWAYS",
    ALWAYS_THIS_DEVICE_ONLY: "ALWAYS_THIS_DEVICE_ONLY",
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: "WHEN_PASSCODE_SET_THIS_DEVICE_ONLY",
    WHEN_UNLOCKED: "WHEN_UNLOCKED",
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    getItemAsync: vi.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    isAvailableAsync: vi.fn(async () => false),
    canUseBiometricAuthentication: vi.fn(() => false),
  };
});

// ── Fix #4: stub `react-native-safe-area-context` ───────────────────
//
// The published package ships Flow/ESM that Node can't parse at module
// load (`Unexpected token 'typeof'`). Screens using InPageHeader pull
// this in transitively; a global pass-through keeps component tests loadable.
vi.mock("react-native-safe-area-context", async () => {
  const RN = await import("react-native");
  return {
    SafeAreaView: RN.View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ── Fix #5: stub `expo-splash-screen` ─────────────────────────────────
//
// Root `_layout.tsx` calls `SplashScreen.preventAutoHideAsync().catch(...)`.
// A bare `vi.fn()` mock returns `undefined`, so `.catch` throws at import.
vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn(() => Promise.resolve()),
  hideAsync: vi.fn(() => Promise.resolve()),
}));

// ── Fix #6: stub `LayeredPillButton` for jsdom tests ────────────────
//
// Ticket detail and several other screens now use LayeredPillButton instead
// of AmberButton/GreyButton. Per-file Amber/Grey mocks no longer cover
// state-change buttons; this shim preserves testID + disabled semantics and
// exposes `data-variant` (`amber` vs `grey`) for assignment-removed tests.
vi.mock("@/components/LayeredPillButton", async () => {
  const ReactLib = (await import("react")).default;
  const LAYERED_PILL_BUTTON_TEXT = {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#ffffff",
  } as const;
  return {
    LAYERED_PILL_BUTTON_TEXT,
    default: ({
      children,
      onPress,
      disabled,
      loading,
      testID,
      inactive,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
      testID?: string;
      inactive?: boolean;
    }) => {
      const isDisabled = !!(disabled || loading);
      const isGrey = !!(inactive || isDisabled);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": testID,
          "data-variant": isGrey ? "grey" : "amber",
          "aria-disabled": isDisabled || undefined,
          disabled: isDisabled,
          onClick: () => {
            if (!isDisabled && onPress) onPress();
          },
        },
        typeof children === "string" ? children : "btn",
      );
    },
    pickPillForBrand: () => ({ src: "", rgb: [0, 0, 0] as [number, number, number] }),
  };
});

// ── Fix #7: native modules added for schedule / calendar flows ───────
vi.mock("@react-native-community/datetimepicker", () => ({
  default: () => null,
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/tmp/vndrly-cache/",
  EncodingType: { UTF8: "utf8" },
  writeAsStringAsync: vi.fn(async () => undefined),
}));

vi.mock("@/components/ScheduleTicketPanel", () => ({
  default: () => null,
}));

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => undefined),
}));
