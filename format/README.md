# Record format (version 1)

One JSON object per cook, **exactly** these fields (any other field, or a value off its range or step, is refused):

| Field | Type | Allowed |
|---|---|---|
| `v` | int | `1` |
| `id` | string | 32 lowercase hex digits, random per cook |
| `grill` | string | `gravity980` |
| `release` | string | `MAJOR.MINOR.PATCH` of the sending software |
| `season` | string | `winter`, `spring`, `summer`, `autumn` |
| `cut` | string | `Pork shoulder`, `Brisket`, `Ribs`, `Beef roast`, `Poultry`, `Sausage`, `Fish`, `Auto` |
| `weight_lb` | number or null | 0.5-25, step 0.5 |
| `wrapped` | bool or null | |
| `pit_f` | number or null | 200-700, step 5 |
| `target_f` | number or null | 100-250, whole degrees |
| `stall_h` | number or null | 0-24, step 0.1, not more than `total_h` |
| `total_h` | number | 0.5-36, step 0.1 |
| `outside_f` | number or null | -10-110, step 5 (the band's lower edge) |
| `rating` | int or null | 1-5 |
| `tags` | list of strings | Each at most once, from: `juicy`, `tender`, `dry`, `tough`, `undercooked`, `just right`, `overcooked`, `great bark`, `soft bark`, `good smoke`, `too smoky`, `too little smoke`, `fat rendered`, `fat not rendered` |

[`examples.json`](examples.json) has valid and invalid examples. The Worker's tests, the nightly build's tests and
the Smoker integration's tests all check against it.
