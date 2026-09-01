---
kind: bug-fix
status: implemented
---

# Model selection keeps provider capabilities

English | [中文](2026-09-01-model-selection-capability.zh.md)

The model selector now retains pi-ai reasoning metadata when a configured route is an alias of a known provider by resolving `ownedBy` before applying route overrides. When neither the route nor its upstream owner has an exact catalog entry, `llm-pi-ai` exposes the shared `off`, `low`, `high`, and `max` effort list and installs the selected level into the dispatch model. This keeps model selection usable for private gateways and newly added model ids while preserving exact catalog levels where available.

The selector menu uses a bounded responsive width and hides horizontal overflow inside the model list. Long provider or model ids remain ellipsized instead of creating a second scrollbar.

Coverage includes catalog and adapter resolution for known and unlisted models, UI effort selection, and the existing focused client selector suite. The desktop shell must be rebuilt after these source changes so the installed App uses the updated client bundle.
