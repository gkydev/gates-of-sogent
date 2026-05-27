# The Gate of Sogents

The Gate of Sogents is an on-chain RPG prototype built for Somnia.

Players recruit heroes who are generated from live market data fetched through Somnia Agents. Each hero gets a unique seed, class, rarity, and traits such as bravery, greed, and wisdom.

The game idea is simple:

```text
Recruit hero
-> Somnia Agent fetches live market data
-> Contract generates unique hero traits
-> Use heroes later for gate runs, loot, and crafting
```

Current prototype uses Somnia's JSON API Agent to fetch:

```text
BTC/USD
ETH/USD
SOMI/USD
```

Those values are combined on-chain to create a unique hero.

## Current Scope

The current version focuses only on hero generation.

Included:

- Somnia Agents integration
- Market-data-based hero generation
- Hero seed
- Class
- Rarity
- Bravery
- Greed
- Wisdom

Planned later:

- Gate adventures
- Combat
- Loot
- Crafting
- NFT heroes and equipment
