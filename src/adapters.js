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
    this.nextArenaRoomId = 1;
    this.runs = new Map();
    this.arenaRooms = new Map();
    this.arenaStories = new Map();
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
          message: `Market Oracle returned BTC ${formatUsd(market.bitcoinUsd)}, ETH ${formatUsd(
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
      pendingDecision: false,
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

  SimulationGameAdapter.prototype.createArenaRoom = function createArenaRoom(hero, stakeInput) {
    const roomId = this.nextArenaRoomId;
    this.nextArenaRoomId += 1;
    const stake = Number(stakeInput || 0.01);
    const room = {
      id: roomId,
      creatorHero: hero,
      creatorHeroId: hero.id,
      stake,
      creatorPower: arenaPower(hero, this.weapons),
      resolved: false,
    };
    this.arenaRooms.set(roomId, room);

    return {
      roomId,
      events: [
        {
          type: "system",
          message: `${hero.name} posted challenge ${roomId} with ${stake} simulated STT.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.joinArenaRoom = function joinArenaRoom(hero, roomId) {
    const room = this.arenaRooms.get(Number(roomId));
    if (!room || room.resolved) {
      throw new Error("Arena challenge is missing or already resolved.");
    }
    if (room.creatorHeroId === hero.id) {
      throw new Error("Use a different hero to accept this challenge.");
    }

    const challengerPower = arenaPower(hero, this.weapons);
    const creatorPower = room.creatorPower;
    const totalPower = creatorPower + challengerPower;
    const roll = Number(hash64(`${roomId}:${room.creatorHero.seed}:${hero.seed}:${Date.now()}`) % BigInt(totalPower));
    const creatorWon = roll < creatorPower;
    const winnerHero = creatorWon ? room.creatorHero : hero;
    const loserHero = creatorWon ? hero : room.creatorHero;
    const story = {
      requestId: `sim-${roomId}`,
      story: `${winnerHero.name} controlled the arena rhythm while ${loserHero.name} chased openings. Steel rang across the old stone circle. The stronger stance finally broke guard, and ${winnerHero.name} claimed the wager.`,
    };
    const fight = {
      roomId: Number(roomId),
      winnerHeroId: winnerHero.id,
      loserHeroId: loserHero.id,
      winnerHeroName: winnerHero.name,
      loserHeroName: loserHero.name,
      creatorPower,
      challengerPower,
      payout: room.stake * 2,
    };

    room.resolved = true;
    room.challengerHero = hero;
    room.challengerHeroId = hero.id;
    room.challengerPower = challengerPower;
    room.winnerHeroId = winnerHero.id;
    this.arenaStories.set(Number(roomId), story);

    return {
      fight,
      story,
      events: [
        {
          type: "reward",
          message: `${winnerHero.name} won challenge ${roomId}. Strength ${creatorPower} vs ${challengerPower}.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.getArenaStory = function getArenaStory(roomId) {
    return this.arenaStories.get(Number(roomId)) || null;
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

  function arenaPower(hero, weaponCount = 0) {
    if (!hero) return 0;
    return 30 + hero.rarity * 28 + hero.bravery * 2 + hero.wisdom + Math.floor(hero.greed / 2) + Math.min(10, weaponCount) * 18;
  }

export function SomniaContractAdapter({ contractAddress, onHeroRequested, onHeroGenerated, onAgentFailed, onArenaStory, onEvent }) {
    this.contractAddress = contractAddress;
    this.onHeroRequested = onHeroRequested;
    this.onHeroGenerated = onHeroGenerated;
    this.onAgentFailed = onAgentFailed;
    this.onArenaStory = onArenaStory;
    this.onEvent = onEvent;
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.account = "";
    this.contractVersion = "Unknown";
    this.gateSupport = false;
    this.forgeSupport = false;
    this.llmGateSupport = false;
    this.oneTxAdventureSupport = false;
    this.arenaSupport = false;
    this.pendingGateDecisions = new Set();
    this.seenStoryLogs = new Set();
    this.seenArenaStoryLogs = new Set();
    this.adventureStories = new Map();
    this.arenaStories = new Map();
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
    try {
      this.llmGateSupport = await this.contract.supportsLLMGateDecisions();
    } catch {
      this.llmGateSupport = false;
    }
    try {
      this.oneTxAdventureSupport = await this.contract.supportsOneTxAdventure();
    } catch {
      this.oneTxAdventureSupport = false;
    }
    try {
      this.arenaSupport = await this.contract.supportsArenaRooms();
    } catch {
      this.arenaSupport = false;
    }
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
    this.contract.removeAllListeners("GateDecisionRequested");
    this.contract.removeAllListeners("GateDecisionReceived");
    this.contract.removeAllListeners("GateAdventureNarrated");
    this.contract.removeAllListeners("GateFloorResolved");
    this.contract.removeAllListeners("ShardsBanked");
    this.contract.removeAllListeners("WeaponCrafted");
    this.contract.removeAllListeners("ArenaFightResolved");
    this.contract.removeAllListeners("ArenaFightNarrated");

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
      this.adventureStories.delete(Number(heroId));
      this.runs.set(Number(heroId), {
        active: true,
        floor: 1,
        hp: Number(hp),
        loot: 0,
        pendingDecision: false,
      });
    });

    this.contract.on("GateDecisionRequested", (requestId, heroId, owner) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      const parsedHeroId = Number(heroId);
      this.pendingGateDecisions.add(parsedHeroId);
      const run = this.runs.get(parsedHeroId);
      if (run) {
        this.runs.set(parsedHeroId, { ...run, pendingDecision: true });
      }
      this.onEvent(
        "system",
        `Gate omen ${requestId.toString()} opened for hero ${parsedHeroId}.`,
      );
    });

    this.contract.on("GateDecisionReceived", (requestId, heroId, route) => {
      const parsedHeroId = Number(heroId);
      if (!this.runs.has(parsedHeroId)) return;
      this.onEvent(
        "system",
        `Gate omen ${requestId.toString()} returned for hero ${parsedHeroId}.`,
      );
    });

    this.contract.on("GateAdventureNarrated", (requestId, heroId, route, story, event) => {
      this.handleAdventureNarration(requestId, heroId, route, story, event);
    });

    this.contract.on("GateFloorResolved", (heroId, owner, floor, hp, loot, active, outcome) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      const parsedHeroId = Number(heroId);
      this.pendingGateDecisions.delete(parsedHeroId);
      this.runs.set(parsedHeroId, {
        active,
        floor: active ? Number(floor) + 1 : Number(floor),
        hp: Number(hp),
        loot: Number(loot),
        pendingDecision: false,
      });
      if (this.llmGateSupport) {
        this.onEvent(
          active ? "reward" : outcome === "DEFEATED" ? "danger" : "system",
          `On-chain Floor ${Number(floor)}: ${outcome}. HP ${Number(hp)}. Loot ${Number(loot)} shards.`,
        );
      }
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

    this.contract.on(
      "ArenaFightResolved",
      (roomId, winner, winnerHeroId, loserHeroId, payout, creatorPower, challengerPower) => {
        const accountWon = winner.toLowerCase() === this.account.toLowerCase();
        this.onEvent(
          accountWon ? "reward" : "system",
          `Arena challenge ${roomId.toString()} resolved. Winner hero ${winnerHeroId.toString()} defeated ${loserHeroId.toString()}.`,
        );
      },
    );

    this.contract.on("ArenaFightNarrated", (requestId, roomId, story, event) => {
      this.handleArenaNarration(requestId, roomId, story, event);
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
    await this.loadRecentAdventureStories(ids.map((heroId) => Number(heroId)));
    return heroes;
  };

  SomniaContractAdapter.prototype.handleAdventureNarration = function handleAdventureNarration(
    requestId,
    heroId,
    route,
    story,
    event,
  ) {
    const txHash = event?.log?.transactionHash || event?.transactionHash || "";
    const logIndex = event?.log?.index ?? event?.index ?? "";
    const key = `${txHash}:${logIndex}:${requestId.toString()}`;
    if (this.seenStoryLogs.has(key)) return;
    this.seenStoryLogs.add(key);

    this.adventureStories.set(Number(heroId), {
      requestId: requestId.toString(),
      route: route.toString(),
      story: story.toString(),
    });
    this.onEvent("reward", "Gate legend ready. Speak with the Warden to read it.");
  };

  SomniaContractAdapter.prototype.getAdventureStory = function getAdventureStory(heroId) {
    return this.adventureStories.get(Number(heroId)) || null;
  };

  SomniaContractAdapter.prototype.handleArenaNarration = function handleArenaNarration(requestId, roomId, story, event) {
    const txHash = event?.log?.transactionHash || event?.transactionHash || "";
    const logIndex = event?.log?.index ?? event?.index ?? "";
    const key = `${txHash}:${logIndex}:${requestId.toString()}`;
    if (this.seenArenaStoryLogs.has(key)) return;
    this.seenArenaStoryLogs.add(key);

    const parsedRoomId = Number(roomId);
    const parsedStory = {
      requestId: requestId.toString(),
      story: story.toString(),
    };
    this.arenaStories.set(parsedRoomId, parsedStory);
    this.onArenaStory?.(parsedRoomId, parsedStory);
  };

  SomniaContractAdapter.prototype.getArenaStory = function getArenaStory(roomId) {
    return this.arenaStories.get(Number(roomId)) || null;
  };

  SomniaContractAdapter.prototype.loadRecentAdventureStories = async function loadRecentAdventureStories(heroIds) {
    if (!this.contract || heroIds.length === 0) return;

    const wantedHeroes = new Set(heroIds.map((heroId) => Number(heroId)));
    const latestBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 999);
    const filter = this.contract.filters.GateAdventureNarrated();
    const logs = await this.contract.queryFilter(filter, fromBlock, latestBlock);

    logs.forEach((log) => {
      const heroId = Number(log.args.heroId);
      if (!wantedHeroes.has(heroId)) return;
      this.handleAdventureNarration(log.args.requestId, log.args.heroId, log.args.route, log.args.story, log);
    });
  };

  SomniaContractAdapter.prototype.recruitHero = async function recruitHero(name) {
    const fee = await this.contract.requiredTotalFee();
    const tx = await this.contract.requestHero(name, { value: fee });
    this.onEvent("system", `Submitted recruitment rite for ${name} to Somnia: ${shortAddress(tx.hash)}.`);
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
          message: "Recruitment rite confirmed. Waiting for market omens.",
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
    if (this.llmGateSupport && this.oneTxAdventureSupport) {
      const fee = await this.contract.requiredGateDecisionFee();
      const tx = await this.contract.startAdventure(heroId, { value: fee });
      this.onEvent("system", `Submitted startAdventure(${heroId}) to Somnia: ${shortAddress(tx.hash)}.`);
      await tx.wait();
      this.pendingGateDecisions.add(heroId);
      await this.refreshGateRun(heroId);

      return {
        pendingDecision: true,
        events: [
          {
            type: "system",
            message: `${heroName} entered the gate. The Warden is reading the path and writing the chronicle.`,
          },
        ],
      };
    }

    const tx = await this.contract.startGateRun(heroId);
    this.onEvent("system", `Submitted startGateRun(${heroId}) to Somnia: ${shortAddress(tx.hash)}.`);
    await tx.wait();
    await this.refreshGateRun(heroId);

    return {
      pendingDecision: false,
      events: [
        {
          type: "system",
          message: `${heroName} entered Floor 1 on-chain.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.resolveGateStep = async function resolveGateStep(hero) {
    if (this.llmGateSupport) {
      const fee = await this.contract.requiredGateDecisionFee();
      const tx = await this.contract.requestGateDecision(hero.id, { value: fee });
      this.onEvent("system", `Submitted gate omen for hero ${hero.id} to Somnia: ${shortAddress(tx.hash)}.`);
      await tx.wait();
      this.pendingGateDecisions.add(hero.id);
      const run = this.runs.get(hero.id);
      if (run) {
        this.runs.set(hero.id, { ...run, pendingDecision: true });
      }

      return {
        events: [
          {
            type: "system",
            message: "Gate omen confirmed. Waiting for the chronicle to return.",
          },
        ],
      };
    }

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

  SomniaContractAdapter.prototype.createArenaRoom = async function createArenaRoom(hero, stakeInput) {
    if (!this.arenaSupport) {
      throw new Error("Connected contract does not support arena rooms. Deploy the latest contract.");
    }
    const stake = window.ethers.parseEther(String(stakeInput || "0.01"));
    const tx = await this.contract.createArenaRoom(hero.id, { value: stake });
    this.onEvent("system", `Submitted createArenaRoom(${hero.id}) to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const room = this.extractArenaRoomCreated(receipt);

    return {
      roomId: room?.roomId || null,
      events: [
        {
          type: "system",
          message: room
            ? `${hero.name} posted challenge ${room.roomId} with ${window.ethers.formatEther(room.stake)} STT.`
            : `${hero.name} posted an arena challenge on-chain.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.joinArenaRoom = async function joinArenaRoom(hero, roomId) {
    if (!this.arenaSupport) {
      throw new Error("Connected contract does not support arena rooms. Deploy the latest contract.");
    }
    const room = await this.contract.arenaRooms(roomId);
    const stake = room.stake ?? room[4];
    const fee = await this.contract.requiredArenaNarrationFee();
    const tx = await this.contract.joinArenaRoomWithNarration(roomId, hero.id, { value: stake + fee });
    this.onEvent("system", `Submitted joinArenaRoomWithNarration(${roomId}, ${hero.id}) to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const fight = this.extractArenaFightResolved(receipt);
    const request = this.extractArenaNarrationRequested(receipt);

    return {
      fight,
      pendingNarration: Boolean(request),
      events: [
        {
          type: fight?.winnerHeroId === hero.id ? "reward" : "system",
          message: fight
            ? `Arena challenge ${fight.roomId} resolved. Winner hero ${fight.winnerHeroId}. Strength ${fight.creatorPower} vs ${fight.challengerPower}.`
            : `Arena challenge ${roomId} accepted on-chain. Waiting for events.`,
        },
        ...(request
          ? [
              {
                type: "system",
                message: `Arena chronicle ${request.requestId} opened for challenge ${roomId}.`,
              },
            ]
          : []),
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
    const [run, pendingDecision] = await Promise.all([
      this.contract.gateRuns(heroId),
      this.llmGateSupport ? this.contract.pendingGateDecision(heroId) : Promise.resolve(false),
    ]);
    const parsed = {
      active: run.active ?? run[0],
      floor: Number(run.floor ?? run[1]),
      hp: Number(run.hp ?? run[2]),
      loot: Number(run.loot ?? run[3]),
      pendingDecision: Boolean(pendingDecision),
    };
    if (parsed.pendingDecision) {
      this.pendingGateDecisions.add(heroId);
    } else {
      this.pendingGateDecisions.delete(heroId);
    }
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

  SomniaContractAdapter.prototype.extractArenaRoomCreated = function extractArenaRoomCreated(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "ArenaRoomCreated") continue;
        if (parsed.args.creator.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          roomId: Number(parsed.args.roomId),
          creator: parsed.args.creator,
          heroId: Number(parsed.args.heroId),
          stake: parsed.args.stake,
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.extractArenaFightResolved = function extractArenaFightResolved(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "ArenaFightResolved") continue;
        return {
          roomId: Number(parsed.args.roomId),
          winner: parsed.args.winner,
          winnerHeroId: Number(parsed.args.winnerHeroId),
          loserHeroId: Number(parsed.args.loserHeroId),
          payout: parsed.args.payout,
          creatorPower: Number(parsed.args.creatorPower),
          challengerPower: Number(parsed.args.challengerPower),
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.extractArenaNarrationRequested = function extractArenaNarrationRequested(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "ArenaNarrationRequested") continue;
        return {
          requestId: parsed.args.requestId.toString(),
          roomId: Number(parsed.args.roomId),
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
