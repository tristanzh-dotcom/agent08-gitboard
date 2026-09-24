import { describe, expect, test } from "vitest";
import { createDefaultManifest } from "../src/gitboard/manifest.js";

describe("Agent11 extension Git Control registration", () => {
  test("registers the local extension repository without claiming a remote", () => {
    const manifest = createDefaultManifest("/Users/tristanzh/agent");
    const target = manifest.targets.find((entry) => entry.id === "agent11-fishtank-extension");

    expect(target).toEqual({
      id: "agent11-fishtank-extension",
      agent: "Agent11",
      ownerId: "agent11",
      kind: "business",
      lifecycle: "active",
      label: "Fishtank Extension",
      path: "/Users/tristanzh/agent/agent11-fishtank-extension",
      remote: "",
      visibility: "local",
      required: true,
    });
  });
});
