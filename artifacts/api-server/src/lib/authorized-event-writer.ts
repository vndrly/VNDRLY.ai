/** Serialize live writes so revocation checks cannot reorder or leak queued events. */
export function authorizedEventWriter(
  authorized: () => Promise<boolean>,
  write: (data: string) => unknown,
  close: () => void,
): (data: string) => Promise<void> {
  let ended = false;
  let pending = Promise.resolve();
  return (data) => {
    pending = pending.then(async () => {
      if (ended) return;
      try {
        if (await authorized()) {
          write(data);
          return;
        }
      } catch {
        /* An unavailable authorization check must not release data. */
      }
      ended = true;
      close();
    });
    return pending;
  };
}
