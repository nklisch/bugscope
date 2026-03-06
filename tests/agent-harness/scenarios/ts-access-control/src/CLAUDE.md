# Access Control System

Role-based access control with role inheritance chains and permission merging.

## Files

- `types.ts` — `Role`, `Permission`, `AccessRequest`, `AccessResult` type definitions
- `roles.ts` — role definitions, inheritance chain resolution (admin → editor → viewer)
- `permissions.ts` — permission merging across roles
- `evaluator.ts` — `checkAccess(request)` top-level entry point
- `test-access.ts` — test suite

## Running

```bash
npx tsx --test test-access.ts
```
