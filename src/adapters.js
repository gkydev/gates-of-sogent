import {
  GAME_CONTRACT_ABI,
  RARITIES,
  SOMNIA_CHAIN_ID_DECIMAL,
  SOMNIA_CHAIN_ID_HEX,
  SOMNIA_RPC_URL,
  WEAPON_SHARD_COST,
} from "./config.js";
import {
  formatUsd,
  fromContractPrice,
  getClass,
  hash64,
  portraitIdFromSeed,
  randomWalk,
  rarityFromSeed,
  shortAddress,
  toContractInt,
  traitFromSeed,
} from "./utils.js";

export function SimulationGameAdapter() {
    this.nextHeroId = 1;
    this.runs = new Map();
    this.shards = 0;
    this.weapons = 0;
    this.forgeCost = WEAPON_SHARD_COST;
    this.market = {
      bitcoinUsd: 68420.13,
      ethereumUsd: 3740.62,
      somniaUsd: 0.1842,
      timestamp: new Date(),
    };
  }

  SimulationGameAdapter.prototype.peekMarket = function peekMarket() {
    return this.market;
  };

  SimulationGameAdapter.prototype.getInventory = function getInventory() {
    return {
      shards: this.shards,
      weapons: this.weapons,
      weaponName: this.weapons > 0 ? `Shard Blade ${this.weapons}` : "None",
      forgeCost: this.forgeCost,
    };
  };

  SimulationGameAdapter.prototype.updateMarket = function updateMarket() {
    this.market = {
      bitcoinUsd: randomWalk(this.market.bitcoinUsd, 0.006),
      ethereumUsd: randomWalk(this.market.ethereumUsd, 0.009),
      somniaUsd: randomWalk(this.market.somniaUsd, 0.018),
      timestamp: new Date(),
    };
    return this.market;
  };

  SimulationGameAdapter.prototype.recruitHero = function recruitHero(name) {
    const market = this.updateMarket();
    const heroId = this.nextHeroId;
    this.nextHeroId += 1;

    const bitcoinPrice = toContractInt(market.bitcoinUsd);
    const ethereumPrice = toContractInt(market.ethereumUsd);
    const somniaPrice = toContractInt(market.somniaUsd);
    const seed = hash64(
      [
        bitcoinPrice.toString(),
        ethereumPrice.toString(),
        somniaPrice.toString(),
        String(heroId),
        name,
        String(Date.now()),
      ].join("|"),
    );

    const hero = {
      id: heroId,
      name,
      seed,
      bitcoinPrice,
      ethereumPrice,
      somniaPrice,
      classId: Number(seed % 4n) + 1,
      portraitId: portraitIdFromSeed(seed),
      rarity: rarityFromSeed(seed),
      bravery: traitFromSeed(seed, 16),
      greed: traitFromSeed(seed, 32),
      wisdom: traitFromSeed(seed, 48),
    };

    const heroClass = getClass(hero.classId);
    const rarity = RARITIES[hero.rarity];

    return {
      hero,
      events: [
        {
          type: "system",
          message: `Market Agent returned BTC ${formatUsd(market.bitcoinUsd)}, ETH ${formatUsd(
            market.ethereumUsd,
          )}, SOMI ${formatUsd(market.somniaUsd)}.`,
        },
        {
          type: "reward",
          message: `${name} generated as ${rarity.name} ${heroClass.name}.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.enterGate = function enterGate(heroId, heroName) {
    this.runs.set(heroId, {
      active: true,
      floor: 1,
      hp: 100,
      loot: 0,
    });

    return {
      events: [
        {
          type: "system",
          message: `${heroName} entered Floor 1 beneath the Sogent Gate.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.resolveGateStep = function resolveGateStep(hero) {
    const run = this.runs.get(hero.id);
    if (!run || !run.active) return { events: [] };

    const floor = run.floor;
    const roll = Number(hash64(`${hero.seed.toString(16)}:${floor}:${run.hp}:${run.loot}`) % 100n) + 1;
    const pressure = 16 + floor * 9 + (roll % 16);
    const defense = Math.floor((hero.bravery + hero.wisdom) / 8) + hero.rarity * 4;
    const damage = Math.max(3, pressure - defense);
    const lootGain = floor * 5 + hero.rarity * 3 + Math.floor(hero.greed / 16);
    const events = [];

    run.hp = Math.max(0, run.hp - damage);

    if (run.hp <= 0) {
      run.active = false;
      run.loot = 0;
      events.push({
        type: "danger",
        message: `Floor ${floor} broke ${hero.name}. Temporary loot was lost.`,
      });
      return { events };
    }

    run.loot += lootGain;
    events.push({
      type: "reward",
      message: `Floor ${floor} cleared. HP ${run.hp}. Loot +${lootGain} shards.`,
    });

    if (run.hp < 30 && hero.wisdom + hero.bravery > 110) {
      const heal = 14 + Math.floor(hero.wisdom / 8);
      run.hp = Math.min(100, run.hp + heal);
      events.push({
        type: "system",
        message: `${hero.name} used a field charm and recovered to ${run.hp} HP.`,
      });
    }

    if (run.hp < 34 && hero.bravery < 70) {
      run.active = false;
      this.shards += run.loot;
      events.push({
        type: "system",
        message: `${hero.name} retreated with ${run.loot} shards.`,
      });
      events.push({
        type: "reward",
        message: `${run.loot} shards banked. Stash ${this.shards}.`,
      });
      return { events };
    }

    const greedPush = hero.greed > 68 && roll > 32;
    const bravePush = hero.bravery > 58 && run.hp > 24;
    const tacticalPush = hero.wisdom > 72 && run.hp > 40;

    if (greedPush || bravePush || tacticalPush) {
      run.floor += 1;
      const reason = greedPush ? "greed" : tacticalPush ? "wisdom" : "bravery";
      events.push({
        type: "system",
        message: `${hero.name} continues to Floor ${run.floor}. Decision driver: ${reason}.`,
      });
      return { events };
    }

    run.active = false;
    this.shards += run.loot;
    events.push({
      type: "system",
      message: `${hero.name} returned safely with ${run.loot} shards.`,
    });
    events.push({
      type: "reward",
      message: `${run.loot} shards banked. Stash ${this.shards}.`,
    });
    return { events };
  };

  SimulationGameAdapter.prototype.getRun = function getRun(heroId) {
    return this.runs.get(heroId) || null;
  };

  SimulationGameAdapter.prototype.craftWeapon = function craftWeapon() {
    if (this.shards < this.forgeCost) {
      return {
        events: [
          {
            type: "danger",
            message: `Forge needs ${this.forgeCost} shards. Current stash ${this.shards}.`,
          },
        ],
      };
    }

    this.shards -= this.forgeCost;
    this.weapons += 1;
    return {
      events: [
        {
          type: "reward",
          message: `Blacksmith crafted Shard Blade ${this.weapons} for ${this.forgeCost} shards.`,
        },
      ],
    };
  };

export function SomniaContractAdapter({ contractAddress, onHeroRequested, onHeroGenerated, onAgentFailed, onEvent }) {
    this.contractAddress = contractAddress;
    this.onHeroRequested = onHeroRequested;
    this.onHeroGenerated = onHeroGenerated;
    this.onAgentFailed = onAgentFailed;
    this.onEvent = onEvent;
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.account = "";
    this.contractVersion = "Unknown";
    this.gateSupport = false;
    this.forgeSupport = false;
    this.runs = new Map();
    this.shards = 0;
    this.weapons = 0;
    this.forgeCost = WEAPON_SHARD_COST;
    this.market = {
      bitcoinUsd: 0,
      ethereumUsd: 0,
      somniaUsd: 0,
      timestamp: new Date(),
    };
  }

  SomniaContractAdapter.prototype.connect = async function connect() {
    if (!window.ethereum) {
      throw new Error("No injected wallet found. Install or enable MetaMask/Rabby first.");
    }
    if (!window.ethers) {
      throw new Error("ethers.js failed to load.");
    }
    if (!window.ethers.isAddress(this.contractAddress)) {
      throw new Error("Paste a valid deployed GatesOfSogentMarketGame contract address.");
    }

    await ensureSomniaNetwork();
    this.provider = new window.ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.account = await this.signer.getAddress();
    this.contract = new window.ethers.Contract(this.contractAddress, GAME_CONTRACT_ABI, this.signer);

    await this.assertContract();
    this.watchContractEvents();
    await this.updateMarket();
    await this.refreshInventory();
  };

  SomniaContractAdapter.prototype.assertContract = async function assertContract() {
    const code = await this.provider.getCode(this.contractAddress);
    if (!code || code === "0x") {
      throw new Error("No contract code exists at that address on Somnia Testnet.");
    }

    await this.contract.requiredTotalFee();
    this.contractVersion = await this.contract.contractVersion();
    this.gateSupport = await this.contract.supportsGateRuns();
    this.forgeSupport = await this.contract.supportsForge();
    if (!this.gateSupport) {
      throw new Error("Connected contract does not support gate runs. Deploy the latest contract.");
    }
    if (!this.forgeSupport) {
      throw new Error("Connected contract does not support the forge loop. Deploy the latest contract.");
    }
    await this.contract.gateRuns(0);
    await this.contract.shards(this.account);
    await this.contract.craftedWeapons(this.account);
    this.forgeCost = Number(await this.contract.WEAPON_SHARD_COST());
  };

  SomniaContractAdapter.prototype.watchContractEvents = function watchContractEvents() {
    this.contract.removeAllListeners("HeroRequested");
    this.contract.removeAllListeners("HeroGenerated");
    this.contract.removeAllListeners("AgentRequestFailed");
    this.contract.removeAllListeners("GateRunStarted");
    this.contract.removeAllListeners("GateFloorResolved");
    this.contract.removeAllListeners("ShardsBanked");
    this.contract.removeAllListeners("WeaponCrafted");

    this.contract.on("HeroRequested", (groupId, owner, name, event) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.onHeroRequested({
        groupId,
        owner,
        name,
        txHash: event?.log?.transactionHash || "",
      });
    });

    this.contract.on(
      "HeroGenerated",
      (
        heroId,
        owner,
        name,
        seed,
        bitcoinPrice,
        ethereumPrice,
        somniaPrice,
        classId,
        rarity,
        bravery,
        greed,
        wisdom,
      ) => {
        if (owner.toLowerCase() !== this.account.toLowerCase()) return;
        this.market = {
          bitcoinUsd: fromContractPrice(bitcoinPrice),
          ethereumUsd: fromContractPrice(ethereumPrice),
          somniaUsd: fromContractPrice(somniaPrice),
          timestamp: new Date(),
        };
        this.onHeroGenerated(
          this.heroFromValues({
            heroId,
            owner,
            name,
            seed,
            bitcoinPrice,
            ethereumPrice,
            somniaPrice,
            classId,
            rarity,
            bravery,
            greed,
            wisdom,
          }),
        );
      },
    );

    this.contract.on("AgentRequestFailed", (requestId, groupId) => {
      this.onAgentFailed({ requestId, groupId });
    });

    this.contract.on("GateRunStarted", (heroId, owner, hp) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.runs.set(Number(heroId), {
        active: true,
        floor: 1,
        hp: Number(hp),
        loot: 0,
      });
    });

    this.contract.on("GateFloorResolved", (heroId, owner, floor, hp, loot, active) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.runs.set(Number(heroId), {
        active,
        floor: active ? Number(floor) + 1 : Number(floor),
        hp: Number(hp),
        loot: Number(loot),
      });
    });

    this.contract.on("ShardsBanked", (owner, amount, balance) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.shards = Number(balance);
      this.onEvent("reward", `${Number(amount)} shards banked on-chain. Stash ${this.shards}.`);
    });

    this.contract.on("WeaponCrafted", (owner, weaponId, shardCost) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.weapons = Number(weaponId);
      this.onEvent("reward", `Blacksmith crafted on-chain Shard Blade ${this.weapons} for ${Number(shardCost)} shards.`);
    });
  };

  SomniaContractAdapter.prototype.peekMarket = function peekMarket() {
    return this.market;
  };

  SomniaContractAdapter.prototype.getInventory = function getInventory() {
    return {
      shards: this.shards,
      weapons: this.weapons,
      weaponName: this.weapons > 0 ? `Shard Blade ${this.weapons}` : "None",
      forgeCost: this.forgeCost,
    };
  };

  SomniaContractAdapter.prototype.updateMarket = async function updateMarket() {
    if (!this.contract) return this.market;

    const [bitcoinPrice, ethereumPrice, somniaPrice] = await Promise.all([
      this.contract.latestBitcoinPrice(),
      this.contract.latestEthereumPrice(),
      this.contract.latestSomniaPrice(),
    ]);

    this.market = {
      bitcoinUsd: fromContractPrice(bitcoinPrice),
      ethereumUsd: fromContractPrice(ethereumPrice),
      somniaUsd: fromContractPrice(somniaPrice),
      timestamp: new Date(),
    };
    return this.market;
  };

  SomniaContractAdapter.prototype.loadOwnerHeroes = async function loadOwnerHeroes() {
    const ids = await this.contract.getOwnerHeroes(this.account);
    const heroes = await Promise.all(
      ids.map(async (heroId) => {
        const hero = await this.contract.heroes(heroId);
        const parsedHero = this.heroFromRecord(heroId, hero);
        await this.refreshGateRun(parsedHero.id);
        return parsedHero;
      }),
    );
    await this.refreshInventory();
    return heroes;
  };

  SomniaContractAdapter.prototype.recruitHero = async function recruitHero(name) {
    const fee = await this.contract.requiredTotalFee();
    const tx = await this.contract.requestHero(name, { value: fee });
    this.onEvent("system", `Submitted requestHero("${name}") to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const request = this.extractHeroRequest(receipt, name, tx.hash);
    if (request) {
      this.onHeroRequested(request);
    }

    return {
      hero: null,
      events: [
        {
          type: "system",
          message: "Hero request confirmed. Waiting for Somnia Agent market callbacks.",
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.extractHeroRequest = function extractHeroRequest(receipt, fallbackName, txHash) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "HeroRequested") continue;
        const owner = parsed.args.owner;
        if (owner.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          groupId: parsed.args.groupId,
          owner,
          name: parsed.args.name || fallbackName,
          txHash,
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.enterGate = async function enterGate(heroId, heroName) {
    const tx = await this.contract.startGateRun(heroId);
    this.onEvent("system", `Submitted startGateRun(${heroId}) to Somnia: ${shortAddress(tx.hash)}.`);
    await tx.wait();
    await this.refreshGateRun(heroId);

    return {
      events: [
        {
          type: "system",
          message: `${heroName} entered Floor 1 on-chain.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.resolveGateStep = async function resolveGateStep(hero) {
    const tx = await this.contract.resolveGateFloor(hero.id);
    this.onEvent("system", `Submitted resolveGateFloor(${hero.id}) to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const event = this.extractGateResolution(receipt, hero.id);
    const run = await this.refreshGateRun(hero.id);
    await this.refreshInventory();

    if (!event) {
      return {
        events: [
          {
            type: "system",
            message: `Gate floor resolved on-chain. HP ${run.hp}. Loot ${run.loot} shards.`,
          },
        ],
      };
    }

    return {
      events: [
        {
          type: event.active ? "reward" : event.outcome === "DEFEATED" ? "danger" : "system",
          message: `On-chain Floor ${event.floor}: ${event.outcome}. HP ${event.hp}. Loot ${event.loot} shards.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.getRun = function getRun(heroId) {
    return this.runs.get(heroId) || null;
  };

  SomniaContractAdapter.prototype.craftWeapon = async function craftWeapon() {
    await this.refreshInventory();
    if (this.shards < this.forgeCost) {
      return {
        events: [
          {
            type: "danger",
            message: `Forge needs ${this.forgeCost} shards. Current stash ${this.shards}.`,
          },
        ],
      };
    }

    const tx = await this.contract.craftWeapon();
    this.onEvent("system", `Submitted craftWeapon() to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const crafted = this.extractWeaponCrafted(receipt);
    await this.refreshInventory();

    return {
      events: [
        {
          type: "reward",
          message: crafted
            ? `Blacksmith crafted on-chain Shard Blade ${crafted.weaponId} for ${crafted.shardCost} shards.`
            : `Blacksmith crafted on-chain Shard Blade ${this.weapons}.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.refreshInventory = async function refreshInventory() {
    if (!this.contract || !this.account) return this.getInventory();
    const [shards, weapons, forgeCost] = await Promise.all([
      this.contract.shards(this.account),
      this.contract.craftedWeapons(this.account),
      this.contract.WEAPON_SHARD_COST(),
    ]);
    this.shards = Number(shards);
    this.weapons = Number(weapons);
    this.forgeCost = Number(forgeCost);
    return this.getInventory();
  };

  SomniaContractAdapter.prototype.refreshGateRun = async function refreshGateRun(heroId) {
    const run = await this.contract.gateRuns(heroId);
    const parsed = {
      active: run.active ?? run[0],
      floor: Number(run.floor ?? run[1]),
      hp: Number(run.hp ?? run[2]),
      loot: Number(run.loot ?? run[3]),
    };
    this.runs.set(heroId, parsed);
    return parsed;
  };

  SomniaContractAdapter.prototype.extractGateResolution = function extractGateResolution(receipt, expectedHeroId) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "GateFloorResolved") continue;
        if (Number(parsed.args.heroId) !== Number(expectedHeroId)) continue;
        if (parsed.args.owner.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          heroId: Number(parsed.args.heroId),
          owner: parsed.args.owner,
          floor: Number(parsed.args.floor),
          hp: Number(parsed.args.hp),
          loot: Number(parsed.args.loot),
          active: parsed.args.active,
          outcome: parsed.args.outcome,
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.extractWeaponCrafted = function extractWeaponCrafted(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "WeaponCrafted") continue;
        if (parsed.args.owner.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          owner: parsed.args.owner,
          weaponId: Number(parsed.args.weaponId),
          shardCost: Number(parsed.args.shardCost),
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.heroFromRecord = function heroFromRecord(heroId, hero) {
    return this.heroFromValues({
      heroId,
      owner: hero.owner ?? hero[0],
      name: hero.name ?? hero[1],
      seed: hero.seed ?? hero[2],
      bitcoinPrice: hero.bitcoinPrice ?? hero[3],
      ethereumPrice: hero.ethereumPrice ?? hero[4],
      somniaPrice: hero.somniaPrice ?? hero[5],
      classId: hero.classId ?? hero[6],
      rarity: hero.rarity ?? hero[7],
      bravery: hero.bravery ?? hero[8],
      greed: hero.greed ?? hero[9],
      wisdom: hero.wisdom ?? hero[10],
    });
  };

  SomniaContractAdapter.prototype.heroFromValues = function heroFromValues(values) {
    return {
      id: Number(values.heroId),
      owner: values.owner,
      name: values.name,
      seed: BigInt(values.seed),
      bitcoinPrice: BigInt(values.bitcoinPrice),
      ethereumPrice: BigInt(values.ethereumPrice),
      somniaPrice: BigInt(values.somniaPrice),
      classId: Number(values.classId),
      portraitId: portraitIdFromSeed(BigInt(values.seed)),
      rarity: Number(values.rarity),
      bravery: Number(values.bravery),
      greed: Number(values.greed),
      wisdom: Number(values.wisdom),
    };
  };

  async function ensureSomniaNetwork() {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
    if (currentChainId === SOMNIA_CHAIN_ID_HEX) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SOMNIA_CHAIN_ID_HEX }],
      });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SOMNIA_CHAIN_ID_HEX,
            chainName: "Somnia Testnet",
            nativeCurrency: {
              name: "Somnia Test Token",
              symbol: "STT",
              decimals: 18,
            },
            rpcUrls: [SOMNIA_RPC_URL],
          },
        ],
      });
    }

    const switchedChainId = await window.ethereum.request({ method: "eth_chainId" });
    if (Number.parseInt(switchedChainId, 16) !== SOMNIA_CHAIN_ID_DECIMAL) {
      throw new Error("Wallet is not on Somnia Testnet.");
    }
  }
