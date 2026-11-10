import { afterAll, afterEach, beforeAll } from "vitest";
import { network } from "../network";

// Installed once for the shared runtime: a request no handler matches errors instead of passing
// through to the real network.
beforeAll(async () => {
  network.configure({ onUnhandledFrame: "error" });
  await network.enable();
});

afterEach(() => {
  network.resetHandlers();
});

afterAll(async () => {
  await network.disable();
});
