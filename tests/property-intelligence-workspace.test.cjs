const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const featureGateSource = fs.readFileSync(path.join(root, "src", "data", "platformFeatureGates.ts"), "utf8");
const decisionToolSource = fs.readFileSync(path.join(root, "src", "features", "decisionToolRegistry.mjs"), "utf8");

assert(appSource.includes('data-property-intelligence-workspace="active"'), "Focused parcel panel must expose the property intelligence workspace");
assert(appSource.includes("right-4") && appSource.includes("sm:right-20"), "Expanded parcel workspace must remain inside narrow viewports");
assert(appSource.includes('data-parcel-intelligence-size={parcelIntelligenceExpanded ? "expanded" : "compact"}'), "Parcel intelligence workspace must expose compact and expanded modes");
assert(appSource.includes('aria-label={parcelIntelligenceExpanded ? "Collapse parcel intelligence" : "Expand parcel intelligence"}'), "Parcel intelligence expansion control must have an accessible state-aware label");
assert(appSource.includes("<Maximize2") && appSource.includes("<Minimize2"), "Parcel intelligence expansion control must communicate both size states");
assert(appSource.includes('event.key === "Escape"'), "Escape must collapse the expanded parcel intelligence workspace");
assert(appSource.includes("lg:w-[min(900px,calc(100vw-2rem))]"), "Expanded parcel intelligence workspace must provide the approved wider desktop reading area");
assert(appSource.includes('["profile", "Profile"]'), "Unified profile tab must remain available");
assert(appSource.includes('["timeline", "Timeline"]'), "Trusted timeline tab must remain available");
assert(appSource.includes('["decisions", "Decision tools"]'), "Decision tools tab must remain discoverable");
assert(appSource.includes('["agents", "Agents"]'), "Parcel agent workspace must remain discoverable");
assert(appSource.includes('data-parcel-agent-workspace="active"'), "Parcel agents must expose a stable UI hook");
assert(appSource.includes('data-unified-property-profile="active"'), "Unified property evidence summary must be rendered");
assert(appSource.includes('data-parcel-id-disclosure={parcelIdExpanded ? "expanded" : "collapsed"}'), "Focused parcel must expose a click-to-expand Parcel ID disclosure");
assert(appSource.includes("aria-expanded={parcelIdExpanded}"), "Parcel ID disclosure must report its accessible expanded state");
assert(appSource.includes('data-expanded-parcel-identifiers="active"'), "Expanded Parcel ID disclosure must expose its identifier details");
for (const identifierLabel of ["County Parcel ID", "Account", "GIS ID", "Source Parcel ID"]) {
  assert(appSource.includes(`["${identifierLabel}",`), `${identifierLabel} must be available in the expanded identifier details`);
}

assert(appSource.includes('data-property-activity-timeline="active"'), "Parcel timeline must expose a stable UI hook");
assert(appSource.includes("permit.issueDate") && appSource.includes("permit.finalDate") && appSource.includes("permit.applicationDate"), "Timeline must use dated permit evidence");
assert(appSource.includes("parcel.deedTransferDate"), "Timeline must include a loaded deed date when present");
assert(appSource.includes("developmentRecord.latestActivityDate"), "Timeline must include dated parcel development evidence when present");
assert(appSource.includes("Real Estate Savant does not manufacture missing activity"), "Timeline must remain honest when evidence is absent");

assert(appSource.includes("platformFeatureGates.opportunitySignals"), "Opportunity display must obey the production feature gate");
assert(appSource.includes('data-opportunity-score-gate={platformFeatureGates.opportunitySignals ? "active" : "blocked"}'), "Opportunity readiness must be visible without bypassing activation");
assert(appSource.includes("No score is displayed because production historical validation"), "Blocked opportunity scoring must explain the missing release evidence");

for (const capability of [
  "Assemblage discovery",
  "Highest & best use",
  "Scenario underwriting",
  "AI acquisition analyst",
  "Monitoring & alerts",
  "Saved searches & watchlists",
  "Deal rooms & collaboration",
  "Opportunity briefs",
  "Predictive property signals",
  "Crash-resilience intelligence",
  "Unified property timeline",
  "Nationwide parcel intelligence",
  "Ownership & entity graph",
  "Portfolio intelligence",
  "Natural-language map search",
  "Development digital twin",
  "Verified valuation & comparables",
  "Climate, insurance & resilience",
  "Title, debt & transaction history",
]) {
  assert(decisionToolSource.includes(capability), `${capability} must be registered for the decision workspace`);
}

assert(appSource.includes("buildParcelDecisionToolCatalog(platformFeatureGates)"), "The parcel workspace must derive tools from the gated registry");
assert(appSource.includes('white-rabbit:open-decision-tool'), "Authorized tools must expose a stable launch contract");
assert(appSource.includes("disabled={!capability.ready}"), "Unapproved tools must remain unavailable");
assert(appSource.includes('data-decision-tool-catalog="active"'), "The website must expose the full governed tool catalog");
assert(appSource.includes('data-progressive-tool-disclosure={showAdvancedTools ? "expanded" : "simple"}'), "Advanced tools must use progressive disclosure");
assert(appSource.includes('new Set(["feasibility", "underwriting", "opportunity-briefs"])'), "The simple view must focus on three primary parcel actions");
assert(appSource.includes('aria-controls="parcel-decision-tool-catalog"'), "The advanced-tool control must expose its accessible target");
assert(appSource.includes('"Start here"') && appSource.includes('`More tools ('), "The simple workflow must use plain-language discovery labels");
assert(appSource.includes('capability.action === "open-property-timeline"'), "The trusted timeline tool must open its existing working surface");
assert(appSource.includes('data-underwriting-workspace="operating"'), "Scenario underwriting must expose an operating local workspace");
assert(appSource.includes('data-feasibility-workspace="operating"'), "Development feasibility must expose an operating local workspace");
assert(appSource.includes('data-highest-best-use-engine="active"'), "Development feasibility must expose the instant highest-and-best-use engine");
assert(appSource.includes('data-highest-best-use-tests="active"'), "Highest-and-best-use must expose all four governing tests");
assert(appSource.includes('data-highest-best-use-scenario={scenario.id}'), "Highest-and-best-use must expose comparable use scenarios");
for (const label of ["Legally permissible", "Physically possible", "Financially feasible", "Maximum productivity"]) {
  assert(appSource.includes(label), `${label} must be visible in the highest-and-best-use workspace`);
}
assert(appSource.includes('data-opportunity-brief-workspace="operating"'), "Opportunity briefs must expose an operating local workspace");

for (const gate of [
  "opportunitySignals",
  "development3dAnalysis",
  "underwriting",
  "propertyIntelligenceQueryService",
  "changeAlerts",
  "savedSearches",
  "watchlists",
  "dealCollaboration",
  "dealRooms",
]) {
  assert(new RegExp(`${gate}:\\s*false`).test(featureGateSource), `${gate} must remain fail-closed in this release`);
}

assert(appSource.includes("Explore the Market from Above"), "Approved landing page must remain intact");
assert(appSource.includes("LiveMapEngine"), "Approved live map engine must remain intact");

console.log("Property intelligence workspace UI tests passed.");
