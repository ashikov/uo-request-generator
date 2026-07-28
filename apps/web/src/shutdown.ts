export const SHUTDOWN_TIMEOUT_MS = 10_000;

type ShutdownDependencies = {
  close: () => Promise<void>;
  setExitCode: (code: number) => void;
  forceExit: (code: number) => void;
};

export function createShutdown({
  close,
  setExitCode,
  forceExit,
}: ShutdownDependencies): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }

    shutdownPromise = new Promise<void>((resolve) => {
      let isFinished = false;
      const timeout = setTimeout(() => {
        if (isFinished) {
          return;
        }

        isFinished = true;
        setExitCode(1);
        forceExit(1);
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      void Promise.resolve()
        .then(close)
        .then(
          () => {
            if (isFinished) {
              return;
            }

            isFinished = true;
            clearTimeout(timeout);
            resolve();
          },
          () => {
            if (isFinished) {
              return;
            }

            isFinished = true;
            clearTimeout(timeout);
            setExitCode(1);
            forceExit(1);
            resolve();
          },
        );
    });

    return shutdownPromise;
  };
}
