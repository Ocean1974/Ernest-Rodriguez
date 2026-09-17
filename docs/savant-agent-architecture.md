# Savant agent architecture

Status: locked baseline  
Contract: `wr-savant-orchestrator-v1`

Creator and founding architect: **Ernest Rodriguez**

The Real Estate Savant agent system uses a manager pattern. The Savant Orchestrator is the only agent-facing coordination layer. It routes platform events, applies dependency ordering, records an audit trail, and enforces approval boundaries.

Initial specialists:

1. Listing Intake validates and enriches uploaded listings.
2. Buyer–Seller Matchmaker compares validated listings with active buyer requirements.
3. CRM Follow-up identifies due buyer and seller follow-ups and drafts recommended actions.

Agents may read, analyze, prioritize, draft, and propose. They may not independently publish listings, send communications, place calls, spend advertising funds, delete records, change deal equations, or modify production code. Those actions require explicit approval by an identified member.

The orchestrator is not authorized to self-modify. Agent instructions, tools, schemas, and evaluation thresholds remain version-controlled and test-gated.
