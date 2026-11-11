import { createWorker, type LogLevel } from "./worker";

// Workers Logs records the console method that wrote a line as its `$metadata.level`, and indexes
// each field of a JSON line, so a line can be found by `event`, `kind` or `uri`.
const writers: Record<LogLevel, (message: string) => void> = {
  debug: (message) => console.debug(message),
  info: (message) => console.info(message),
};

// The only place that binds the run to the real network and log. The arrow keeps fetch called on
// the global, as workerd rejects a detached fetch with "Illegal invocation".
export default createWorker({
  fetch: (input, init) => fetch(input, init),
  log: ({ level, message, fields }) => writers[level](JSON.stringify({ message, ...fields })),
}) satisfies ExportedHandler<Env>;
