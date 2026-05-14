# @vantage/explanation

Deterministic plain-English renderer over `Signal` objects. **No LLM in the path.** Pure template substitution.

Every output is reproducible byte-for-byte given identical inputs. This is what makes Vantage's explanations auditable.

## Adding a template

1. Pick the right template file:
   - `templates/private.ts` for private engine signals
   - `templates/public.ts` for public-score signals
   - `templates/platform.ts` for classification / allocation / simulation
2. Add a function keyed on the `signalType` literal:
   ```ts
   'private.dcf': (s) => fill(`{entity} ...`, { entity: s.entity })
   ```
3. Use `{key}` placeholders; missing keys render literally so QA spots them.
