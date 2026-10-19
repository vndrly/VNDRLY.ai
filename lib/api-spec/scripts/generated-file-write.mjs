// On Windows freshly generated files can briefly reject writes. Retry only
// sharing/access errors; permanent failures must still fail code generation.
export function retryGeneratedWrite(write) {
  for (let attempt = 0; ; attempt++) {
    try {
      return write();
    } catch (error) {
      if (attempt >= 9 || !["UNKNOWN", "EBUSY", "EPERM"].includes(error?.code))
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
