import { createWorker, type Env } from "./worker";

export type { Env } from "./worker";

// The only place that binds the run to the real network and log. The arrow keeps fetch called on
// the global, as workerd rejects a detached fetch with "Illegal invocation".
export default createWorker({
  fetch: (input, init) => fetch(input, init),
  log: (line) => console.log(line),
}) satisfies ExportedHandler<Env>;
