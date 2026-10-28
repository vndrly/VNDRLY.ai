const events = ["notification.created", "notification.state_changed", "notification.hello"] as const;

/** One notification connection per account context across tabs. HTTP/1 previews
 * only have six connection slots, so a permanent stream in every tab can block
 * ordinary page, account and data requests before they reach the server. */
export function subscribeNotificationStream(
  url: string,
  identity: string,
  onEvent: (type: string, event: MessageEvent<string>) => void,
): () => void {
  let source: EventSource | undefined;
  let stopped = false;
  const open = (publish?: (type: string, data: string) => void) => {
    source = new EventSource(url, { withCredentials: true });
    for (const type of events) source.addEventListener(type, event => {
      if (stopped) return;
      const message = event as MessageEvent<string>;
      onEvent(type, message);
      publish?.(type, message.data);
    });
  };
  if (typeof BroadcastChannel === "undefined" || !navigator.locks?.request) {
    open();
    return () => { stopped = true; source?.close(); };
  }
  const key = `vndrly:notifications:${identity}`;
  const channel = new BroadcastChannel(key);
  channel.onmessage = event => {
    const message = event.data;
    if (!stopped && events.includes(message?.type) && typeof message.data === "string")
      onEvent(message.type, new MessageEvent(message.type, { data: message.data }));
  };
  const controller = new AbortController();
  let release: (() => void) | undefined;
  void navigator.locks.request(key, { signal: controller.signal }, async () => {
    if (stopped) return;
    try {
      await new Promise<void>(resolve => {
        release = resolve;
        open((type, data) => channel.postMessage({ type, data }));
      });
    } finally { source?.close(); }
  }).catch(() => { /* Cancelling a waiting tab is normal during navigation. */ });
  return () => {
    stopped = true;
    source?.close();
    release?.();
    controller.abort();
    channel.close();
  };
}
