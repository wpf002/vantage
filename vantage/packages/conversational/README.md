# @vantage/conversational

**Phase 7 stub.** Defines the intent / tool-call contract a chat layer will route to.

The LLM in this package only:
1. Maps a user message to an `Intent` from the fixed enum
2. Builds `params` matching the API endpoint schema
3. Renders the JSON response back as prose

Scoring, classification, allocation, and simulation remain pure logic — the LLM never enters the scoring path. This is what keeps Vantage's outputs deterministic and auditable.
