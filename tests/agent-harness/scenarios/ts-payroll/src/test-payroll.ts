import assert from "node:assert/strict";
import { test } from "node:test";
import { payrollConfig, tom, tomPeriod } from "./data.ts";
import { generatePayStub } from "./payroll.ts";

test("Tom Wilson gross pay should be $800 (salaried flat rate)", () => {
	const stub = generatePayStub(tom, tomPeriod, payrollConfig);
	assert.equal(stub.grossPay, 800, `Expected $800 gross (salaried), got $${stub.grossPay}`);
});

test("Tom Wilson net pay should be $700", () => {
	// Gross $800, tax: $800 in 0-$1000 bracket at 10% = $80, post-tax transit $20
	// Net = $800 - $80 - $20 = $700
	const stub = generatePayStub(tom, tomPeriod, payrollConfig);
	assert.equal(stub.netPay, 700, `Expected $700 net, got $${stub.netPay}`);
});
