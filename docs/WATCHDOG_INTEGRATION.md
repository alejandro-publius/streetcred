# The autonomous agent — the diagram

The full escalation-path diagram behind [`README.md`'s "The autonomous agent, end to end"](../README.md#the-autonomous-agent-end-to-end).

```mermaid
%%{init: {"flowchart": {"curve": "basis", "nodeSpacing": 45, "rankSpacing": 55, "padding": 14, "wrappingWidth": 460}}}%%
flowchart TB

    subgraph OBSERVER["Observer service &nbsp;&middot;&nbsp; Cloud Run, scales to zero"]
        direction LR
        SCHED["<b>Cloud Scheduler</b><br/>watchdog-daily-cycle<br/>07:00 America/Los_Angeles"]
        DATASF["<b>DataSF</b><br/>311 and collisions<br/>keyless, read only"]
        SWEEP["<b>Sweep</b><br/>diff each of 25 corners against<br/>the stored Firestore snapshot"]
        REFLEX["<b>Reflex tier</b><br/>served today by <b>Gemma</b>, google/gemma-4-26b-a4b-it-maas<br/>on Vertex locations/global<br/><i>a call the shared pool refuses falls back to a rule,<br/>and the entry records which one decided it</i>"]
        SCHED --> SWEEP
        DATASF --> SWEEP
        SWEEP --> REFLEX
    end

    subgraph ACTOR["The escalation path: Pub/Sub, then the Actor service on Cloud Run"]
        direction LR
        PS["<b>Pub/Sub</b><br/>topic <b>corner-deltas</b>, push subscription with OIDC<br/><i>the quiet corners stop here, and tier two<br/>is never built, called or billed</i>"]
        JUDGE["<b>Judgment tier</b><br/>served today by an <b>ADK LlmAgent</b> on<br/><b>gemini-3.5-flash</b>, Vertex locations/global"]
        TOOLS["<b>Five tools, exactly one call</b><br/>rescore &middot; regenerate_letter &middot; re_audit &middot; flag<br/><b>decline</b>, which is a signed decision, not a silence"]
        PS --> JUDGE
        JUDGE --> TOOLS
    end

    subgraph PUBLISH["The record, the boundary, and the public page"]
        direction LR
        FS[("<b>Firestore journal</b><br/>watchdog database, append only,<br/>declines and failed publishes included")]
        INGEST{{"<b>Authenticated ingest</b><br/>POST /api/agent/report<br/><b>one bearer token, one direction</b><br/>the cloud writes in and reads nothing back"}}
        GATE["<b>Validation gate</b><br/>six rejection classes, unknown tools refused,<br/>a claim the site cannot verify is turned away"]
        DIARY["<b>Public diary and Activity Inspector</b><br/>/watchdog: every decision, every decline,<br/>every rejected ingest, each with its reason"]
        FS --> INGEST
        INGEST --> GATE
        GATE --> DIARY
    end

    OBSERVER -->|"escalations only"| ACTOR
    ACTOR -->|"decided, then journaled, then published"| PUBLISH

    classDef source fill:#eef2f0,stroke:#5c6a6e,stroke-width:1.5px,color:#161d1f
    classDef gcp fill:#f7ecdf,stroke:#a1571c,stroke-width:1.5px,color:#161d1f
    classDef model fill:#e7efea,stroke:#2f5d50,stroke-width:2.5px,color:#161d1f
    classDef boundary fill:#fbecec,stroke:#8c2f2f,stroke-width:2.5px,color:#161d1f
    classDef edge fill:#eaf0f6,stroke:#2b4d73,stroke-width:1.5px,color:#161d1f

    class DATASF source
    class SCHED,PS,SWEEP,TOOLS,FS gcp
    class REFLEX,JUDGE model
    class INGEST boundary
    class GATE,DIARY edge

    style OBSERVER fill:#fdfaf6,stroke:#a1571c,stroke-width:2px,color:#a1571c
    style ACTOR fill:#fdfaf6,stroke:#a1571c,stroke-width:2px,color:#a1571c
    style PUBLISH fill:#fbfcfb,stroke:#5c6a6e,stroke-width:2px,color:#5c6a6e
```
