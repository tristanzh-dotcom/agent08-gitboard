import type { RepoManifest } from "./types.js";

export function createDefaultManifest(root: string): RepoManifest {
  const base = root.replace(/\/$/, "");

  return {
    version: 1,
    root: base,
    generatedAt: new Date(0).toISOString(),
    targets: [
      {
        id: "agent-tooling",
        agent: null,
        label: "Governance",
        path: `${base}/agent-tooling`,
        remote: "https://github.com/tristanzh-dotcom/agent-tooling.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent02-pvi",
        agent: "Agent02",
        label: "Vehicle Intelligence",
        path: `${base}/agent02-pvi`,
        remote: "https://github.com/tristanzh-dotcom/agent02-pvi.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent03-prs",
        agent: "Agent03",
        label: "Pet Services",
        path: `${base}/agent03-prs`,
        remote: "https://github.com/tristanzh-dotcom/agent03-prs.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent04-lpm",
        agent: "Agent04",
        label: "Local Photo Model",
        path: `${base}/agent04-lpm`,
        remote: "https://github.com/tristanzh-dotcom/agent04-lpm.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent05-pptx",
        agent: "Agent05",
        label: "PPT Generation",
        path: `${base}/agent05-pptx`,
        remote: "https://github.com/tristanzh-dotcom/agent05-pptx.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent06-pka",
        agent: "Agent06",
        label: "Personal Knowledge Assets",
        path: `${base}/agent06-pka`,
        remote: "https://github.com/tristanzh-dotcom/agent06-pka.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent07-sentinel",
        agent: "Agent07",
        label: "Sentinel Audit",
        path: `${base}/agent07-sentinel`,
        remote: "https://github.com/tristanzh-dotcom/agent07-sentinel.git",
        visibility: "public",
        required: true
      },
      {
        id: "agent08-gitboard",
        agent: "Agent08",
        label: "Git Console",
        path: `${base}/agent08-gitboard`,
        remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
        visibility: "public",
        required: true
      },
      {
        id: "web-platform",
        agent: null,
        label: "Shared Publishing Surface",
        path: `${base}/web`,
        remote: "https://github.com/tristanzh-dotcom/web-platform.git",
        visibility: "private",
        required: true
      }
    ]
  };
}
