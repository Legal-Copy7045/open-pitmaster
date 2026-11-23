# Privacy

Open Pitmaster collects **anonymous summaries of finished cooks** from people who **chose** to share them. This page
is the full list of what is and isn't collected; the receiving service ([`worker/`](worker/src/index.js)) refuses
anything that doesn't match it exactly.

## What a shared cook contains

| Field | Example | How it's kept non-identifying |
|---|---|---|
| `cut` | Pork shoulder | One of: Pork shoulder, Brisket, Ribs, Beef roast, Poultry, Sausage, Fish, Auto |
| `weight_lb` | 8.5 | Rounded to ½ lb; 25 lb and over shown as 25 |
| `pit_f`, `target_f` | 250, 203 | Pit to 5 °F, the probe target to 1 °F |
| `stall_h`, `total_h` | 3.1, 11.6 | Hours, to 0.1 h: durations, never clock times |
| `wrapped` | true | Yes / no / unknown |
| `outside_f` | 35 | A 5 °F band (35 means 35-40 °F); below -10 °F shown as -10 |
| `season` | autumn | Instead of a date (southern hemisphere handled) |
| `rating` | 4 | 1-5 stars, if given |
| `tags` | juicy, great bark | "How was it?": only from a fixed list of cooking outcomes (format/README.md) |
| `grill`, `release`, `v` | gravity980, 0.2.26, 1 | Grill model, software release, format version |
| `id` | 32 random hex digits | New for every cook: it links to nothing, not even the same person's other cooks |

**Never collected:**
- dates or times;
- location (address, weather station, IP address);
- notes, photos or scanned labels;
- names (people, probes or devices);
- device, Bluetooth or Wi-Fi identifiers;
- anything that links two cooks together.

## How a cook travels

1. The owner shares a cook. The Smoker integration shows the exact record first, and asks for each cook unless
   automatic sharing is on.
2. The service checks it against the format, then stores the record. Nothing about the sender is
   stored or logged. Cloudflare's network necessarily sees the connection, as any host would.
3. A nightly job adds the day's cooks to [`data/`](data/) in one shuffled batch and rebuilds the averages. A record
   carries no time, and the batch only shows that a cook was shared sometime that day. Averages are only published
   for groups of at least 5 cooks (with 10 or more, the fastest and slowest 10% are left out, so a few odd cooks can't move the average).

## Removing shared cooks

Each cook is sent with the hash of a random deletion key that stays on the owner's Home Assistant. *Remove my shared
cooks* sends the keys. The cooks are deleted from the service immediately and from `data/` within two nightly builds (the list the build reads is a daily snapshot).
Only the holder of the key can delete a cook, and the key isn't linked to a person.

## Licence

The data is dedicated to the public domain (CC0 1.0): anyone may use it for anything.
