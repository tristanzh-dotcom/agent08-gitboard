export function createDefaultManifest(root) {
    const base = root.replace(/\/$/, "");
    return {
        version: 2,
        root: base,
        generatedAt: new Date(0).toISOString(),
        targets: [
            {
                id: "agent-tooling",
                agent: null,
                ownerId: "agent-tooling",
                kind: "governance",
                lifecycle: "active",
                label: "Governance",
                path: `${base}/agent-tooling`,
                remote: "https://github.com/tristanzh-dotcom/agent-tooling.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent02-pvi",
                agent: "Agent02",
                ownerId: "agent02",
                kind: "business",
                lifecycle: "active",
                label: "Vehicle Intelligence",
                path: `${base}/agent02-pvi`,
                remote: "https://github.com/tristanzh-dotcom/agent02-pvi.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent03-prs",
                agent: "Agent03",
                ownerId: "agent03",
                kind: "business",
                lifecycle: "active",
                label: "Pet Services",
                path: `${base}/agent03-prs`,
                remote: "https://github.com/tristanzh-dotcom/agent03-prs.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent04-lpm",
                agent: "Agent04",
                ownerId: "agent04",
                kind: "business",
                lifecycle: "active",
                label: "Local Photo Model",
                path: `${base}/agent04-lpm`,
                remote: "https://github.com/tristanzh-dotcom/agent04-lpm.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent05-pptx",
                agent: "Agent05",
                ownerId: "agent05",
                kind: "business",
                lifecycle: "retired",
                label: "PPT Generation",
                path: `${base}/agent05-pptx`,
                remote: "https://github.com/tristanzh-dotcom/agent05-pptx.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent06-pka",
                agent: "Agent06",
                ownerId: "agent06",
                kind: "business",
                lifecycle: "active",
                label: "Personal Knowledge Assets",
                path: `${base}/agent06-pka`,
                remote: "https://github.com/tristanzh-dotcom/agent06-pka.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent07-sentinel",
                agent: "Agent07",
                ownerId: "agent07",
                kind: "business",
                lifecycle: "retired",
                label: "Sentinel Audit",
                path: `${base}/agent07-sentinel`,
                remote: "https://github.com/tristanzh-dotcom/agent07-sentinel.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent08-gitboard",
                agent: "Agent08",
                ownerId: "agent08",
                kind: "governance",
                lifecycle: "active",
                label: "Git Console",
                path: `${base}/agent08-gitboard`,
                remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent10-asset-library",
                agent: "Agent10",
                ownerId: "agent10",
                kind: "business",
                lifecycle: "active",
                label: "Asset Library",
                path: `${base}/agent10-asset-library`,
                remote: "https://github.com/tristanzh-dotcom/agent10-asset-library.git",
                visibility: "public",
                required: true
            },
            {
                id: "agent11-fishtank-monitor",
                agent: "Agent11",
                ownerId: "agent11",
                kind: "business",
                lifecycle: "unpublished",
                label: "Fishtank Monitor",
                path: `${base}/agent11-fishtank-monitor`,
                remote: "https://github.com/tristanzh-dotcom/agent11-fishtank-monitor.git",
                visibility: "private",
                required: true
            },
            {
                id: "agent11-fishtank-extension",
                agent: "Agent11",
                ownerId: "agent11",
                kind: "business",
                lifecycle: "active",
                label: "Fishtank Extension",
                path: `${base}/agent11-fishtank-extension`,
                remote: "",
                visibility: "local",
                required: true
            },
            {
                id: "agent12-fishtank-3dtwin",
                agent: "Agent12",
                ownerId: "agent12",
                kind: "business",
                lifecycle: "active",
                label: "Fishtank 3D Twin",
                path: `${base}/agent12-fishtank-3Dtwin`,
                remote: "https://github.com/tristanzh-dotcom/agent12-fishtank-3dtwin.git",
                visibility: "private",
                required: true
            },
            {
                id: "agent13-esp-reminder",
                agent: "Agent13",
                ownerId: "agent13",
                kind: "business",
                lifecycle: "active",
                label: "ESP Reminder",
                path: `${base}/agent13-esp-reminder`,
                remote: "https://github.com/tristanzh-dotcom/agent13-esp-reminder.git",
                visibility: "private",
                required: true
            },
            {
                id: "home-platform",
                agent: null,
                ownerId: "home-platform",
                kind: "platform",
                lifecycle: "active",
                label: "Home Platform",
                path: `${base}/home-platform`,
                remote: "https://github.com/tristanzh-dotcom/home-platform.git",
                visibility: "private",
                required: true
            },
            {
                id: "agent14-ppt2html",
                agent: "Agent14",
                ownerId: "agent14",
                kind: "business",
                lifecycle: "active",
                label: "PPT/PDF to Editable HTML",
                path: `${base}/agent14-ppt2html`,
                remote: "https://github.com/tristanzh-dotcom/agent14-ppt2html.git",
                visibility: "private",
                required: true
            },
            {
                id: "homeview-bj",
                agent: "Agent15",
                ownerId: "agent15",
                kind: "business",
                lifecycle: "active",
                label: "数字住宅",
                path: `${base}/HomeViewBJ`,
                remote: "",
                visibility: "local",
                required: true
            },
            {
                id: "web-platform",
                agent: null,
                ownerId: "agent00",
                kind: "platform",
                lifecycle: "active",
                label: "Shared Publishing Surface",
                path: `${base}/web`,
                remote: "https://github.com/tristanzh-dotcom/web-platform.git",
                visibility: "private",
                required: true
            }
        ]
    };
}
//# sourceMappingURL=manifest.js.map