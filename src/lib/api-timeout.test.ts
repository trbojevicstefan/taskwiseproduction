/** @jest-environment node */

import { withTimeout } from "@/lib/api-timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves with the wrapped promise result before the timeout", async () => {
    const promise = withTimeout(Promise.resolve("ok"), 1000, "test-operation");

    await expect(promise).resolves.toBe("ok");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects when the timeout is exceeded", async () => {
    const promise = withTimeout(
      new Promise<string>(() => {}),
      1000,
      "test-operation"
    );
    const handledRejection = promise.catch((error) => error);

    await jest.advanceTimersByTimeAsync(1000);

    await expect(handledRejection).resolves.toMatchObject({
      message: "Timeout: test-operation exceeded 1000ms",
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});
