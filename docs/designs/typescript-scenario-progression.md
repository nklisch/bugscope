# TypeScript Scenario Progression Design

Escalating debugging scenarios for the TypeScript runtime. Follows the cross-language strategy from [scenario-guidelines.md](scenario-guidelines.md): 5 shared-concept scenarios (one per level, parallel to Python and Node) + 7 language-specific scenarios exploiting TypeScript footguns.

TypeScript is a **separate language suite** from Node (plain JS). The type system changes the debugging experience fundamentally — type annotations give agents extra signals, but type assertions (`as`), `any` escape hatches, unsound generics, and custom type guards introduce an entirely new class of bugs where **the types lie about runtime reality**.

All scenarios use `.ts` files run via `tsx` (zero-config TS execution for Node). Tests use Node's built-in test runner with tsx: `node --import tsx --test <file>.ts`. No build step needed.

---

## Shared-Concept Scenarios

Same bug pattern as Python and Node counterparts, written idiomatically in TypeScript with proper type annotations.

### 1. `ts-wrong-constant` (Level 1) — Shared

**Python parallel:** `python-discount-bug` | **Node parallel:** `node-wrong-constant`

**Bug:** A `Record<string, number>` maps tier names to discount rates. The `"gold"` tier has `1.0` instead of `0.1`. The type system is correct (it's a valid number), so types don't help.

```typescript
// pricing.ts
const TIER_DISCOUNTS: Record<string, number> = {
  bronze: 0.05,
  silver: 0.07,
  gold: 1.0,      // BUG: should be 0.1
  platinum: 0.15,
};

interface InvoiceLine {
  name: string;
  basePrice: number;
  finalPrice: number;
  qty: number;
}

export function calculatePrice(basePrice: number, tier: string): number {
  const discount = TIER_DISCOUNTS[tier] ?? 0;
  return basePrice * (1 - discount);
}

export function generateInvoice(
  items: Array<{ name: string; price: number; qty: number }>,
  customerTier: string,
): { lines: InvoiceLine[]; subtotal: number; tier: string } {
  const lines: InvoiceLine[] = items.map(item => ({
    name: item.name,
    basePrice: item.price,
    finalPrice: calculatePrice(item.price, customerTier),
    qty: item.qty,
  }));
  const subtotal = lines.reduce((sum, l) => sum + l.finalPrice * l.qty, 0);
  return { lines, subtotal, tier: customerTier };
}
```

**What it tests:** Baseline — can the agent find a wrong value constant when types offer no help. Identical difficulty to the JS version.

---

### 2. `ts-shadow-variable` (Level 2) — Shared

**Python parallel:** `python-shadow-variable` | **Node parallel:** `node-shadow-variable`

**Bug:** A `let` variable is reused across two loops. The second loop accumulates onto the stale value instead of starting from zero. TypeScript's type system sees `total` as `number` throughout — nothing flags the logic bug.

```typescript
// orders.ts
interface Order {
  id: string;
  quantity: number;
  price: number;
}

interface OrderSummary {
  grandTotal: number;
  orderCount: number;
}

export function processOrders(orders: Order[]): OrderSummary {
  // First pass: validate all orders
  let total = 0;
  for (const order of orders) {
    total = order.quantity * order.price;
    if (total < 0) {
      throw new Error(`Negative total for order ${order.id}`);
    }
  }

  // Second pass: accumulate grand total
  // BUG: total still holds last order's individual value, not 0
  for (const order of orders) {
    total += order.quantity * order.price;
  }

  return { grandTotal: total, orderCount: orders.length };
}
```

**What it tests:** Types don't prevent logic bugs. Agent must trace variable state across loop boundaries. Same as JS/Python but with full type annotations that provide no diagnostic help.

---

### 3. `ts-stale-accumulator` (Level 3) — Shared

**Python parallel:** `python-default-mutable` | **Node parallel:** `node-stale-accumulator`

**Bug:** A module-level typed array accumulates state across calls. The types are perfectly correct — `SaleEntry[]` is the right type — but the state leaks between logical units of work.

```typescript
// ledger.ts
interface SaleEntry {
  item: string;
  price: number;
}

interface DailyReport {
  count: number;
  total: number;
}

// Module-level state — persists across calls
const _ledger: SaleEntry[] = [];

export function registerSale(item: string, price: number): SaleEntry[] {
  _ledger.push({ item, price });
  return _ledger;
}

export function dailyReport(salesByDay: Array<[string, number][]>): DailyReport[] {
  const reports: DailyReport[] = [];
  for (const daySales of salesByDay) {
    // BUG: _ledger is never cleared between days
    for (const [item, price] of daySales) {
      registerSale(item, price);
    }
    reports.push({
      count: _ledger.length,
      total: _ledger.reduce((sum, s) => sum + s.price, 0),
    });
  }
  return reports;
}

export function clearLedger(): void {
  _ledger.length = 0;
}
```

**What it tests:** Module-scoped mutable state is perfectly well-typed but logically wrong. Type annotations give a false sense of safety. Agent must inspect the runtime length of `_ledger` across calls to see the leak.

---

### 4. `ts-mutation-before-read` (Level 4) — Shared

**Python parallel:** `python-dict-iteration-mutation` | **Node parallel:** `node-mutation-before-read`

**Bug:** A catalog `Record` is mutated (prices overwritten with promotional prices) before a summary computation reads from it. Types don't prevent reading mutated values — the shape is still `CatalogItem`.

```typescript
// promotions.ts
interface CatalogItem {
  name: string;
  price: number;
  category: string;
  savings?: number;
}

interface PromotionResult {
  updated: number;
  avgOriginalPrice: number;
  totalSavings: number;
}

export function applyPromotions(
  catalog: Record<string, CatalogItem>,
  promotions: Record<string, number>,
): PromotionResult {
  let updated = 0;
  let totalSavings = 0;

  for (const [sku, promoPrice] of Object.entries(promotions)) {
    if (catalog[sku]) {
      const oldPrice = catalog[sku].price;
      catalog[sku].price = promoPrice;
      catalog[sku].savings = oldPrice - promoPrice;
      totalSavings += oldPrice - promoPrice;
      updated++;
    }
  }

  // BUG: catalog prices already overwritten above — reads mutated values
  const prices = Object.values(catalog).map(item => item.price);
  const avgOriginal = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    updated,
    avgOriginalPrice: Math.round(avgOriginal * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
  };
}
```

**What it tests:** Mutation before read — same conceptual bug as JS/Python. The `CatalogItem` interface doesn't distinguish "original price" from "discounted price" since both are just `number`. Agent must trace the data flow to see that `prices` reads already-mutated values.

---

### 5. `ts-float-accumulation` (Level 5) — Shared

**Python parallel:** `python-float-accumulation` | **Node parallel:** `node-float-accumulation`

**Bug:** Float precision causes `!==` to trigger a "correction" that makes the result wrong after rounding. Same as JS since TypeScript `number` is IEEE 754 double. The types add no safety — `number !== number` is perfectly valid TypeScript.

```typescript
// bill.ts
interface BillSplit {
  perPerson: number;
  shares: number[];
  totalWithTip: number;
  totalShares: number;
}

export function splitBill(
  total: number,
  numPeople: number,
  tipPct = 0.18,
): BillSplit {
  const tip = total * tipPct;
  const billWithTip = total + tip;
  const perPerson = billWithTip / numPeople;

  const shares = Array(numPeople).fill(perPerson);
  const totalShares = shares.reduce((a: number, b: number) => a + b, 0);

  if (totalShares !== billWithTip) {  // BUG: exact float comparison
    shares[numPeople - 1] += billWithTip - totalShares;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const roundedShares = shares.map(round2);

  return {
    perPerson: round2(perPerson),
    shares: roundedShares,
    totalWithTip: round2(billWithTip),
    totalShares: round2(roundedShares.reduce((a: number, b: number) => a + b, 0)),
  };
}
```

**What it tests:** Same float footgun as JS/Python. TypeScript's type system has no concept of float precision — it's all just `number`. Agent must inspect the actual runtime values to see the epsilon.

---

## Language-Specific Scenarios

Bugs that exploit TypeScript-specific footguns. These cannot exist in plain JavaScript (they rely on type assertions, type guards, generics, or other TS features that are erased at runtime).

### 6. `ts-as-cast` (Level 1) — TS-Specific

**Bug:** A type assertion (`as`) lies about the shape of incoming data. The runtime value is missing a field that the type claims exists. The assertion silences the compiler, so the bug only shows at runtime.

```typescript
// user-loader.ts
interface UserProfile {
  id: number;
  name: string;
  email: string;
  preferences: {
    theme: string;
    notifications: boolean;
  };
}

interface ApiResponse {
  data: unknown;
  status: number;
}

function parseResponse(response: ApiResponse): UserProfile {
  // BUG: response.data is missing `preferences` — it only has id, name, email
  // The `as` assertion silences the compiler but the data is incomplete
  return response.data as UserProfile;
}

export function getUserTheme(response: ApiResponse): string {
  const user = parseResponse(response);
  // user.preferences is undefined at runtime — throws "Cannot read property 'theme' of undefined"
  return user.preferences.theme;
}

export function formatUserSummary(response: ApiResponse): string {
  const user = parseResponse(response);
  const theme = user.preferences?.theme ?? "default";
  const notifs = user.preferences?.notifications ?? false;
  return `${user.name} (${user.email}) — theme: ${theme}, notifications: ${notifs ? "on" : "off"}`;
}
```

**What it tests:** The most common TS footgun — `as` assertions bypass the type checker. The code compiles cleanly, the types look correct, but `preferences` is `undefined` at runtime because the API response doesn't include it. Agent sees a "Cannot read property 'theme' of undefined" error and must trace back to the `as` cast. Fix: validate the response shape or use optional chaining in `getUserTheme`.

---

### 7. `ts-non-null-assertion` (Level 2) — TS-Specific

**Bug:** The non-null assertion operator (`!`) is used on a `Map.get()` call that returns `undefined` for certain keys. The type system trusts the `!` and doesn't warn, but the value is null at runtime.

```typescript
// inventory.ts
interface Product {
  sku: string;
  name: string;
  stock: number;
  reorderThreshold: number;
}

interface WarehouseReport {
  lowStock: string[];
  totalStock: number;
  averageStock: number;
}

export function buildInventoryMap(products: Product[]): Map<string, Product> {
  const inventory = new Map<string, Product>();
  for (const product of products) {
    inventory.set(product.sku, product);
  }
  return inventory;
}

export function checkReorderNeeds(
  inventory: Map<string, Product>,
  skusToCheck: string[],
): WarehouseReport {
  const lowStock: string[] = [];
  let totalStock = 0;

  for (const sku of skusToCheck) {
    // BUG: non-null assertion — some skus in skusToCheck aren't in the inventory map
    // Map.get() returns undefined for missing keys, but `!` tells TS to trust it
    const product = inventory.get(sku)!;
    totalStock += product.stock;

    if (product.stock <= product.reorderThreshold) {
      lowStock.push(`${product.name} (${sku}): ${product.stock} remaining`);
    }
  }

  return {
    lowStock,
    totalStock,
    averageStock: Math.round(totalStock / skusToCheck.length),
  };
}
```

**What it tests:** The `!` operator is TS-specific — it tells the compiler "trust me, this isn't null." When `skusToCheck` contains a SKU not in the inventory map, `inventory.get(sku)` returns `undefined`, but `!` suppresses the type error. The runtime throws "Cannot read properties of undefined (reading 'stock')." Agent must trace from the error to the `!` operator and understand that the assertion is lying. Fix: handle the `undefined` case (skip or filter missing SKUs).

---

### 8. `ts-any-escape` (Level 3) — TS-Specific

**Bug:** A function accepts `any` to handle "flexible" input. The `any` type silences all type checking, allowing a subtle shape mismatch to pass through uncaught. The bug is that one input source provides amounts as strings (`"150.00"`) while the function expects numbers — `any` hides the mismatch.

```typescript
// transaction-processor.ts
interface Transaction {
  id: string;
  amount: number;
  currency: string;
  timestamp: Date;
}

interface ProcessedBatch {
  transactions: Transaction[];
  totalAmount: number;
  avgAmount: number;
  currencies: string[];
}

// BUG: `any` hides that some records have amount as string, not number
function normalizeRecord(record: any): Transaction {
  return {
    id: record.id,
    amount: record.amount,  // might be string "150.00" — not coerced to number
    currency: record.currency?.toUpperCase() ?? "USD",
    timestamp: new Date(record.timestamp ?? record.date ?? Date.now()),
  };
}

export function processBatch(records: any[]): ProcessedBatch {
  const transactions = records.map(normalizeRecord);

  // String + number concatenation: "150.00" + 200 = "150.00200" — not 350
  const totalAmount = transactions.reduce(
    (sum, t) => sum + t.amount,
    0,
  );

  return {
    transactions,
    totalAmount,
    avgAmount: Math.round((totalAmount / transactions.length) * 100) / 100,
    currencies: [...new Set(transactions.map(t => t.currency))],
  };
}

export function generateReport(records: any[]): {
  batch: ProcessedBatch;
  summary: string;
} {
  const batch = processBatch(records);
  return {
    batch,
    summary: `Processed ${batch.transactions.length} transactions. Total: $${batch.totalAmount.toFixed(2)}`,
  };
}
```

**What it tests:** `any` is the primary TS-specific escape hatch. The type signature says `amount: number` in the `Transaction` interface, but `normalizeRecord` copies the raw value through without coercion. When some records have `amount: "150.00"` (string), the `reduce` produces string concatenation instead of addition. The result is `"0150.00200"` instead of `350`. Agent must inspect the runtime value of `t.amount` and see that it's a string, then trace back to the `any` input and missing `Number()` coercion. The `Transaction` interface creates a false sense of type safety.

---

### 9. `ts-type-guard-lie` (Level 4) — TS-Specific

**Bug:** A custom type guard function (`is`) incorrectly narrows the type in one code path, causing downstream code to access a property that doesn't exist on the actual runtime type.

```typescript
// notification-router.ts
interface EmailNotification {
  kind: "email";
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

interface SmsNotification {
  kind: "sms";
  phone: string;
  message: string;
}

interface PushNotification {
  kind: "push";
  deviceToken: string;
  title: string;
  payload: Record<string, unknown>;
}

type Notification = EmailNotification | SmsNotification | PushNotification;

interface DeliveryResult {
  channel: string;
  recipient: string;
  status: "sent" | "failed";
  detail?: string;
}

// BUG: This type guard checks for "message" property, but EmailNotification
// also has string properties — it should check `kind` field instead.
// When an email notification is passed, this returns true because
// "body" check isn't actually here — it only checks for string props
// that exist on email objects too.
function isSmsNotification(n: Notification): n is SmsNotification {
  // Incorrect check: looks for "phone" key but doesn't verify `kind`
  // A malformed notification with an extra `phone` field would match
  return typeof (n as any).phone === "string" && typeof (n as any).message === "string";
}

function isEmailNotification(n: Notification): n is EmailNotification {
  return typeof (n as any).subject === "string";
}

function formatRecipient(notification: Notification): string {
  if (isSmsNotification(notification)) {
    return notification.phone;
  }
  if (isEmailNotification(notification)) {
    return notification.to;
  }
  return (notification as PushNotification).deviceToken;
}

export function routeNotification(notification: Notification): DeliveryResult {
  const recipient = formatRecipient(notification);
  // Simulate delivery logic per channel
  const channel = notification.kind;

  // BUG MANIFESTS HERE: for push notifications that happen to have extra
  // fields (from API normalization), the wrong type guard matches first,
  // and `notification.phone` returns the wrong value
  return {
    channel,
    recipient,
    status: "sent",
    detail: `Delivered via ${channel} to ${recipient}`,
  };
}

export function routeBatch(notifications: Notification[]): DeliveryResult[] {
  return notifications.map(routeNotification);
}
```

The test constructs push notifications that were "enriched" by a middleware layer adding `phone` and `message` fields from a contact lookup:

```typescript
const enrichedPush: PushNotification & { phone: string; message: string } = {
  kind: "push",
  deviceToken: "abc123token",
  title: "Alert",
  payload: { alert: true },
  phone: "+15551234567",  // added by contact enrichment
  message: "Alert triggered",  // added by message formatter
};
```

The `isSmsNotification` guard matches this enriched push notification because it has `phone` (string) and `message` (string). TypeScript narrows it to `SmsNotification`, so `formatRecipient` returns `notification.phone` instead of `notification.deviceToken`. The notification gets routed as SMS instead of push.

**What it tests:** Custom type guards are TS-specific and uniquely dangerous — they tell the compiler to trust arbitrary runtime checks. When the guard is wrong, the type system actively misleads the developer (and the agent). The agent must:
1. See that the push notification is being routed to the wrong channel
2. Trace through `formatRecipient` to discover the wrong type guard matched
3. Inspect the runtime value to see the extra fields causing the mismatch
4. Fix the type guards to check `kind` (the discriminant) instead of duck-typing

---

### 10. `ts-generic-constraint` (Level 5) — TS-Specific

**Bug:** A generic function has a constraint that *looks* correct but doesn't prevent a specific edge case. The generic allows a subtype that satisfies the constraint structurally but violates an implicit assumption.

```typescript
// merge-configs.ts
interface BaseConfig {
  version: number;
  enabled: boolean;
}

interface CacheConfig extends BaseConfig {
  ttlSeconds: number;
  maxEntries: number;
  strategy: "lru" | "fifo" | "lfu";
}

interface RetryConfig extends BaseConfig {
  maxRetries: number;
  backoffMs: number;
  exponential: boolean;
}

// Deeply merges two configs. The constraint says T extends BaseConfig,
// so we know version and enabled exist.
export function mergeConfigs<T extends BaseConfig>(
  base: T,
  override: Partial<T>,
): T {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const value = override[key];
    if (value !== undefined) {
      // BUG: For nested objects (like if someone passes a config with
      // an object-valued field), this does a shallow copy — it replaces
      // the entire nested object instead of merging it.
      // But the real bug is subtler: Partial<T> allows setting
      // `enabled: undefined` (which is filtered), but also allows
      // setting `version: 0` — and when version is 0 (falsy), the
      // downstream version check `if (config.version)` fails.
      result[key] = value as T[typeof key];
    }
  }

  return result;
}

interface ServiceInit {
  config: BaseConfig;
  configVersion: string;
  features: string[];
}

export function initService<T extends BaseConfig>(
  base: T,
  overrides: Partial<T>[],
): ServiceInit {
  let config = base;
  for (const override of overrides) {
    config = mergeConfigs(config, override);
  }

  // BUG: version 0 is falsy — this check was meant to detect "no version set"
  // but version 0 is a valid override that means "use legacy mode"
  const configVersion = config.version
    ? `v${config.version}`
    : "unknown";

  const features: string[] = [];
  if (config.enabled) features.push("core");
  // version-gated features
  if (config.version >= 2) features.push("advanced");
  if (config.version >= 3) features.push("experimental");

  return { config, configVersion, features };
}
```

**What it tests:** The generic constraint `T extends BaseConfig` is structurally sound, and the merge function is type-safe. But `Partial<T>` allows `version: 0`, which is a valid number that satisfies the type but is falsy. The downstream `if (config.version)` check (meant to detect "not set") treats `0` as "not set" and produces `configVersion: "unknown"`. The agent must:
1. See that `configVersion` is `"unknown"` when it should be `"v0"`
2. Trace through `mergeConfigs` to see that `version: 0` was correctly merged
3. Realize the bug is in the falsy check `config.version` (should be `config.version !== undefined` or `config.version != null`)
4. Understand this is a TS-specific issue: the generic system makes the code *look* safe, and the types never flag `0` as problematic

---

### 11. `ts-mapped-type-pipeline` (Level 5 — Showcase) — TS-Specific

**Purpose:** Exercise `debug_evaluate` and `debug_variables` on a realistic TypeScript codebase with rich type definitions, mapped types, and a multi-stage data transformation pipeline. The types give the agent extra information but also create false confidence — the bug is where runtime values diverge from what the types claim.

**Setup:** An analytics event processing pipeline that ingests raw events, validates them against a schema registry, transforms them through enrichment stages, and produces aggregated metrics.

```typescript
// schema-registry.ts — type-driven schema validation
interface EventSchema<T extends string = string> {
  eventType: T;
  version: number;
  fields: Record<string, FieldDef>;
}

interface FieldDef {
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  transform?: (value: unknown) => unknown;
}

// registry.ts — runtime schema registry
const schemas = new Map<string, EventSchema>();

export function registerSchema<T extends string>(schema: EventSchema<T>) {
  schemas.set(`${schema.eventType}:${schema.version}`, schema);
}

// pipeline.ts — multi-stage processing
interface RawEvent {
  type: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: { source: string; timestamp: number; sessionId: string };
}

interface EnrichedEvent extends RawEvent {
  enriched: {
    userSegment: string;
    geoRegion: string;
    deviceCategory: string;
  };
  validated: boolean;
}

interface AggregateMetric {
  eventType: string;
  count: number;
  uniqueSessions: number;
  bySegment: Record<string, number>;
  byRegion: Record<string, number>;
}

// Stage 1: Validate against schema — transforms field values per schema definition
// Stage 2: Enrich with user/geo/device data from lookup tables
// Stage 3: Aggregate into metrics by event type
// Stage 4: Apply filters and produce final report

// BUG: In Stage 1, schema transforms run on payload fields. One transform
// normalizes a "revenue" field from cents (integer) to dollars (float) by
// dividing by 100. But in Stage 3, the aggregation sums `payload.revenue`
// — which is now in dollars for validated events but still in cents for
// events that had no matching schema (they skip validation).
//
// The type system says `payload: Record<string, unknown>` throughout,
// so there's no type error — but the values are in different units.
```

The pipeline processes 50+ events across 5 event types. The revenue totals are wrong because some events had their revenue normalized (cents → dollars) by the schema transform while others passed through raw. The aggregation sums mixed units.

**What it tests:**
- Rich TypeScript types (generics, mapped types, discriminated unions) create a false sense of safety
- `debug_evaluate` on expressions like `events.filter(e => e.type === "purchase").map(e => e.payload.revenue)` reveals mixed values
- `debug_variables` shows the full pipeline state with deeply nested typed objects
- The bug is a realistic data pipeline issue: unit mismatch after conditional transformation
- An agent without debugging tools would need to mentally trace which events hit the schema transform and which didn't

**Files:**
- `schema-registry.ts` — ~60 lines: type-driven schema definitions, field transforms
- `pipeline.ts` — ~180 lines: 4-stage processing pipeline with rich interfaces
- `lookup-tables.ts` — ~40 lines: user segments, geo regions, device categories
- `test-pipeline.ts` — visible test: "purchase revenue total should match expected sum"
- `hidden/test_validation.ts` — validates correct revenue aggregation across all event types

---

### 12. `ts-runtime-registry` (Level 5 — Contrived) — TS-Specific

**Purpose:** A scenario that is nearly impossible without runtime inspection. TypeScript's type erasure means generic type parameters don't exist at runtime — but the code builds a runtime registry keyed by type-derived strings. The agent *must* evaluate expressions at runtime to see what the registry actually contains.

**Setup:** A dependency injection container that uses decorator-like registration patterns. Services register themselves with string keys derived from their class names and configuration. The container resolves dependencies at runtime using these keys.

```typescript
// container.ts
type ServiceFactory<T> = () => T;

interface ServiceDescriptor {
  key: string;
  factory: ServiceFactory<unknown>;
  singleton: boolean;
  instance?: unknown;
  dependencies: string[];
}

const _registry = new Map<string, ServiceDescriptor>();

function computeKey(name: string, variant: string): string {
  // Keys are computed from name + variant hash — not guessable from source
  const hash = Array.from(name + variant)
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  return `${name}:${Math.abs(hash).toString(36)}`;
}

export function register<T>(
  name: string,
  variant: string,
  factory: ServiceFactory<T>,
  options: { singleton?: boolean; dependencies?: string[] } = {},
): string {
  const key = computeKey(name, variant);
  _registry.set(key, {
    key,
    factory,
    singleton: options.singleton ?? true,
    dependencies: options.dependencies ?? [],
  });
  return key;
}

export function resolve<T>(key: string): T {
  const descriptor = _registry.get(key);
  if (!descriptor) {
    throw new Error(`Service not found: ${key}`);
  }
  // Resolve dependencies first
  for (const dep of descriptor.dependencies) {
    resolve(dep); // ensure dependency is instantiated
  }
  if (descriptor.singleton && descriptor.instance) {
    return descriptor.instance as T;
  }
  const instance = descriptor.factory();
  if (descriptor.singleton) {
    descriptor.instance = instance;
  }
  return instance as T;
}
```

A service initialization module registers 10+ services with computed keys. One service (`RateLimiter`) declares a dependency on `CacheService`, but the dependency key is computed with the wrong variant string — it uses `"primary"` instead of `"shared"`, producing a different hash. At resolution time, the dependency lookup fails with "Service not found" for a key that looks like gibberish (`CacheService:a3f7k`).

The source code alone doesn't reveal the actual key values — `computeKey` produces hash-derived strings. The agent *must* set a breakpoint and evaluate `computeKey("CacheService", "shared")` vs `computeKey("CacheService", "primary")` to see the key mismatch.

**What it tests:**
- Agent *must* use `debug_evaluate` to inspect computed registry keys — they're not in the source
- Type erasure means the generic `<T>` gives no runtime information about what's registered
- The `Map<string, ServiceDescriptor>` contains 10+ entries with hash-derived keys
- The error message shows a key like `CacheService:a3f7k` that doesn't appear anywhere in source code
- Without breakpoints and eval, the agent would need to mentally compute hash functions

**Files:**
- `container.ts` — ~80 lines: DI container with hash-computed keys
- `services.ts` — ~120 lines: 10+ service registrations with dependencies
- `test-services.ts` — visible test: "RateLimiter should resolve with its dependencies"
- `hidden/test_validation.ts` — validates full dependency graph resolves correctly

---

## Summary Matrix

| # | Name | Level | Category | Bug Pattern |
|---|------|-------|----------|-------------|
| 1 | `ts-wrong-constant` | 1 | Shared | Wrong value in typed config |
| 2 | `ts-as-cast` | 1 | TS-specific | `as` assertion hides missing field |
| 3 | `ts-shadow-variable` | 2 | Shared | Variable not reset between loops |
| 4 | `ts-non-null-assertion` | 2 | TS-specific | `!` on `Map.get()` that returns undefined |
| 5 | `ts-stale-accumulator` | 3 | Shared | Module-level typed array leaks state |
| 6 | `ts-any-escape` | 3 | TS-specific | `any` masks string-vs-number mismatch |
| 7 | `ts-mutation-before-read` | 4 | Shared | Typed object mutated before summary read |
| 8 | `ts-type-guard-lie` | 4 | TS-specific | Custom `is` guard matches wrong subtype |
| 9 | `ts-float-accumulation` | 5 | Shared | Float precision triggers bad correction |
| 10 | `ts-generic-constraint` | 5 | TS-specific | Falsy `0` passes generic constraint, breaks downstream check |
| 11 | `ts-mapped-type-pipeline` | 5 showcase | TS-specific | Unit mismatch in typed pipeline after conditional transform |
| 12 | `ts-runtime-registry` | 5 contrived | TS-specific | Hash-computed DI keys invisible without runtime eval |

---

## Implementation Plan

For each scenario, create:
```
scenarios/<name>/
  scenario.json       # name, language: "typescript", timeout, budget, test commands
  prompt.md           # natural language bug report (no tool hints)
  src/                # buggy source + visible test
  hidden/             # oracle validation test
```

### Test runner

All tests use Node's built-in test runner with tsx: `node --import tsx --test <file>.ts`. This requires `tsx` as a dev dependency in the scenario or installed globally. No `tsconfig.json` build step needed — tsx handles it transparently.

### Setup commands

Each scenario's `setup.commands` should include installing tsx if not already available:
```json
"setup": {
  "commands": ["npm install --save-dev tsx"]
}
```

### Timeout / Budget scaling

Per [scenario-guidelines.md](scenario-guidelines.md):

| Level | Timeout | Budget |
|-------|---------|--------|
| 1-2 | 120s | $0.50 |
| 3 | 180s | $0.75 |
| 4 | 240s | $1.00 |
| 5 | 300s | $1.50 |
| 5 showcase/contrived | 360s | $2.00 |

### Priority order (implement first to last):

1. `ts-wrong-constant` (Level 1 shared) — simplest, establishes the TS pattern
2. `ts-as-cast` (Level 1 TS-specific) — fundamental TS footgun
3. `ts-shadow-variable` (Level 2 shared)
4. `ts-non-null-assertion` (Level 2 TS-specific)
5. `ts-stale-accumulator` (Level 3 shared)
6. `ts-any-escape` (Level 3 TS-specific)
7. `ts-mutation-before-read` (Level 4 shared)
8. `ts-type-guard-lie` (Level 4 TS-specific)
9. `ts-float-accumulation` (Level 5 shared)
10. `ts-generic-constraint` (Level 5 TS-specific)
11. `ts-mapped-type-pipeline` (Level 5 showcase)
12. `ts-runtime-registry` (Level 5 contrived)

---

## Design Philosophy: Why TypeScript Is Its Own Suite

The shared-concept scenarios are intentionally similar to their JS counterparts in bug *pattern*, but the TypeScript versions include full type annotations, interfaces, and generics. This tests whether agents are *misled* by types that look correct — a typed codebase can create false confidence that the code is correct because "the types check out."

The TS-specific scenarios exploit the fundamental tension in TypeScript: **the type system is unsound by design**. `as` assertions, `any`, non-null assertions (`!`), and custom type guards all allow the programmer to override the compiler's judgment. When these overrides are wrong, the types actively mislead anyone reading the code — including AI agents. Runtime debugging becomes essential to see past the type-level lies to the actual runtime values.

See [scenario-guidelines.md](scenario-guidelines.md) for cross-language design principles, level definitions, and the scenario anatomy checklist.
