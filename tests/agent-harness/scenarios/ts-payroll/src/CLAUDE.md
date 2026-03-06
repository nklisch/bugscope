# Payroll System

Generates employee pay stubs with overtime, progressive tax brackets, and pre/post-tax deductions.

## Files

- `types.ts` — `Employee`, `PayPeriod`, `PayrollConfig`, `PayStub` type definitions
- `data.ts` — employee records (Sarah Parker, Tom Wilson), pay periods, and payroll configuration
- `overtime.ts` — overtime hours and premium calculation
- `tax.ts` — progressive tax bracket computation
- `deductions.ts` — pre-tax and post-tax deduction processing
- `payroll.ts` — `generatePayStub(employee, period, config)` orchestration
- `reports.ts` — payroll summary reporting
- `test-payroll.ts` — test suite

## Running

```bash
npx tsx --test test-payroll.ts
```
