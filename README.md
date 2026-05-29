# The Gate of Sogents

The Gate of Sogents is an on-chain RPG prototype built for Somnia.

Players recruit heroes who are generated from live market data fetched through Somnia Agents. Each hero gets a unique seed, class, rarity, and traits such as bravery, greed, and wisdom.

The game idea is simple:

```text
Recruit hero
-> Somnia Agent fetches live market data
-> Contract generates unique hero traits
-> Send heroes into a simple on-chain gate run
-> Resolve floors for HP, loot, retreat, or defeat
```

Current prototype uses Somnia's JSON API Agent to fetch:

```text
BTC/USD
ETH/USD
SOMI/USD
```

Those values are combined on-chain to create a unique hero.

## Current Scope

The current version focuses on hero generation, a simple gate-run loop, and a minimal forge loop.

Contract version:

```text
0.3.0-market-gate-forge
```

Included:

- Somnia Agents integration
- Market-data-based hero generation
- Hero seed
- Class
- Rarity
- Bravery
- Greed
- Wisdom
- Pixel-art frontend simulation
- Generated class portraits
- Walkable/clickable RPG camp
- NPC dialogue and interaction actions
- Mobile movement controls
- In-world labels and action feedback
- On-chain gate run start/resolve
- Banked shard tracking
- Basic weapon crafting hook
- Live event log

## Frontend

Run a local static server:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/index.html
```

The frontend starts in simulation mode. It has a PixiJS camp where the player can move around, click locations, interact with NPC agents, recruit heroes, fetch simulated market data, and run simple gate encounters. It mirrors the contract idea by using BTC, ETH, and SOMI market values to generate a hero seed, class, rarity, and traits.

You can also paste a deployed `GatesOfSogentMarketGame` contract address and connect a wallet. In Somnia mode, hero recruitment calls `requestHero(name)`, shows the pending Somnia Agent request, and waits for the contract `HeroGenerated` event.

The frontend checks `contractVersion()`, `supportsGateRuns()`, and `supportsForge()` when connecting, so deploy the latest contract in this repo before using the Gate Warden or Blacksmith on-chain.

You can prefill the contract field with:

```text
http://127.0.0.1:4173/index.html?contract=YOUR_CONTRACT_ADDRESS
```

The current contract covers hero generation, simple gate runs, banked shards, and a basic weapon crafting hook. Deeper combat, full loot inventories, and NFT equipment are still planned.

PixiJS is loaded from CDN and pinned to `8.18.1`. ethers is loaded from CDN and pinned to `6.16.0`. No npm install is required.

Planned later:

- Deeper combat
- Full loot inventory contracts
- NFT crafting contracts
- NFT heroes and equipment
