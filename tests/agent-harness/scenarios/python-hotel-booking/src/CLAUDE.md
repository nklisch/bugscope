# Hotel Booking System

Calculates reservation totals for hotel stays, applying room rates, seasonal multipliers, loyalty discounts, deposits, and tax.

## Files

- `models.py` — data structures (`Guest`, `Room`, `BookingRequest`, `Reservation`)
- `data.py` — sample guests, booking requests, and hotel configuration
- `rooms.py` — room type definitions and base rates
- `rates.py` — nightly rate calculation with seasonal multipliers
- `guests.py` — guest profile and loyalty tier lookup
- `availability.py` — room availability checking
- `discounts.py` — loyalty and promotional discount application
- `deposits.py` — deposit calculation
- `reservations.py` — `create_reservation(guest, request, config)` orchestration
- `reports.py` — reservation summary formatting
- `test_booking.py` — test suite

## Running

```bash
python3 -m pytest test_booking.py -v
```
