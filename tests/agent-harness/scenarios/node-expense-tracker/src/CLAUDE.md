# Expense Tracker

Monthly expense reporting system with category hierarchies and budget tracking.

## Files

- `models.js` — data structures (Expense, Budget, Category)
- `data.js` — expense records, budgets, and category definitions
- `categories.js` — category hierarchy and lookup
- `expenses.js` — expense filtering and querying
- `reports.js` — `generateMonthlyReport(month, year)` and related report generation
- `budgets.js` — budget tracking and variance calculation
- `test-reports.js` — test suite

## Running

```bash
node --test test-reports.js
```
