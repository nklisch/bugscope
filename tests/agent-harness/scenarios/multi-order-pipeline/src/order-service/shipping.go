package main

import "math"

// Shipping rates in $/kg by zone.
var shippingRates = map[string]float64{
	"standard": 8.0,
	"express":  18.0,
	"economy":  4.0,
}

// baseFee is charged per line item when weight > 0.
const baseFee = 3.0

// calculateShipping computes the shipping cost for one line item.
// Returns 0 if weightKg is 0 (product has no recorded weight).
func calculateShipping(weightKg float64, zone string) float64 {
	if weightKg == 0 {
		return 0
	}
	rate, ok := shippingRates[zone]
	if !ok {
		rate = shippingRates["standard"]
	}
	cost := baseFee + weightKg*rate
	return math.Round(cost*100) / 100
}

// shippingZoneForRegion maps a region code to a shipping zone.
// Only used for display / audit; zone selection happens at checkout.
func shippingZoneForRegion(region string) string {
	switch region {
	case "US", "CA":
		return "standard"
	case "GB", "DE", "FR":
		return "express"
	default:
		return "economy"
	}
}
