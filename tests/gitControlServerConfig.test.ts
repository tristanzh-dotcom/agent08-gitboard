import { describe, expect, test } from "vitest";
import { resolveGitControlListenConfig } from "../src/gitboard/gitControlServerMain.js";

describe("git control server config", () => {
  test("uses loopback and a stable Agent08 port by default", () => {
    expect(resolveGitControlListenConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3108,
    });
  });

  test("accepts explicit environment overrides", () => {
    expect(
      resolveGitControlListenConfig({
        AGENT08_GIT_CONTROL_HOST: "localhost",
        AGENT08_GIT_CONTROL_PORT: "4108",
      }),
    ).toEqual({
      host: "localhost",
      port: 4108,
    });
  });
});
