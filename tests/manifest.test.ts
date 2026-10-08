import { describe, expect, test } from "vitest";
import { createDefaultManifest } from "../src/gitboard/manifest.js";

test("registers exactly three separate local Digital Home roots under Agent15", () => {
  const targets = createDefaultManifest("/Users/tristanzh/agent").targets.filter((target) => target.ownerId === "agent15");
  expect(targets.map(({ id, label, path, remote, visibility }) => ({ id, label, path, remote, visibility }))).toEqual([
    { id: "homeview-bj", label: "共用代码 · HomeView", path: "/Users/tristanzh/agent/HomeView", remote: "", visibility: "local" },
    { id: "homeview-bj-data", label: "北京资料 · HomeViewBJ", path: "/Users/tristanzh/agent/AgentAssetVault/00_Inbox/HomeViewBJ", remote: "", visibility: "local" },
    { id: "homeview-sh-data", label: "上海资料 · HomeViewSH", path: "/Users/tristanzh/agent/AgentAssetVault/00_Inbox/HomeViewSH", remote: "", visibility: "local" },
  ]);
});

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
