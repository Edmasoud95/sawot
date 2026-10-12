/** Poll only while the tools dialog is mounted; never overlap requests. */
export function pollToolAvailability({ url, update, error, intervalMs = 3000, fetcher = fetch }: {
  url: string;
  update: (value: { homeAssistant: boolean; python: boolean }) => void;
  error: () => void;
  intervalMs?: number;
  fetcher?: typeof fetch;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Availability check failed');
      const body = await response.json();
      if (typeof body.homeAssistant !== 'boolean') throw new Error('Invalid availability');
      if (!controller.signal.aborted) update({ homeAssistant: body.homeAssistant, python: body.python === true });
    } catch {
      if (!controller.signal.aborted) error();
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(() => void check(), intervalMs);
    }
  };
  void check();
  return () => { controller.abort(); clearTimeout(timer); };
}
