import {
  GAME_CONTRACT_ABI,
  WEAPON_NFT_ABI,
  RARITIES,
  SOMNIA_CHAIN_ID_DECIMAL,
  SOMNIA_CHAIN_ID_HEX,
  SOMNIA_RPC_URL,
  WEAPON_SHARD_COST,
} from "./config.js?v=20260610-portrait1";
import {
  fromContractPrice,
  getClass,
  hash64,
  portraitIdFromSeed,
  randomWalk,
  rarityFromSeed,
  shortAddress,
  toContractInt,
  traitFromSeed,
} from "./utils.js?v=20260610-portrait1";

export function SimulationGameAdapter() {
    this.nextHeroId = 1;
    this.nextArenaRoomId = 1;
    this.runs = new Map();
    this.arenaRooms = new Map();
    this.arenaStories = new Map();
    this.shards = 0;
    this.weapons = [];
    this.nextWeaponId = 1;
    this.forgedCount = 0;
    this.forgeOrder = null;
    this.equippedWeapons = new Map();
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
    const weaponCount = this.weapons.length;
    const latestWeapon = weaponCount ? this.weapons[weaponCount - 1] : null;
    return {
      shards: this.shards,
      weapons: weaponCount,
      weaponName: latestWeapon ? latestWeapon.name : "None",
      forgeCost: this.forgeCost,
      forgeOrder: this.getForgeOrder(),
      weaponItems: this.weapons.slice(),
      nextForgeTier: this.forgedCount + 1,
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
      creatorPower: arenaPower(hero, this.getEquippedWeaponBonus(hero.id)),
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

    const challengerPower = arenaPower(hero, this.getEquippedWeaponBonus(hero.id));
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

  SimulationGameAdapter.prototype.getArenaRoomResult = function getArenaRoomResult(roomId) {
    const room = this.arenaRooms.get(Number(roomId));
    if (!room) return null;
    const story = this.getArenaStory(roomId);
    if (!room.resolved) {
      return {
        roomId: Number(roomId),
        resolved: false,
        story,
      };
    }

    const winnerHero = room.winnerHeroId === room.creatorHeroId ? room.creatorHero : room.challengerHero;
    const loserHero = room.winnerHeroId === room.creatorHeroId ? room.challengerHero : room.creatorHero;
    return {
      roomId: Number(roomId),
      resolved: true,
      story,
      fight: {
        roomId: Number(roomId),
        winnerHeroId: room.winnerHeroId,
        loserHeroId: loserHero?.id || 0,
        winnerHeroName: winnerHero?.name || `Hero ${room.winnerHeroId}`,
        loserHeroName: loserHero?.name || "Opponent",
        creatorHeroId: room.creatorHeroId,
        challengerHeroId: room.challengerHeroId,
        creatorPower: room.creatorPower,
        challengerPower: room.challengerPower,
        payout: room.stake * 2,
      },
    };
  };

  SimulationGameAdapter.prototype.getForgeDuration = function getForgeDuration(tier) {
    return Math.min(45 + tier * 15, 180) * 1000;
  };

  SimulationGameAdapter.prototype.getForgeOrder = function getForgeOrder() {
    if (!this.forgeOrder) return null;
    const remaining = Math.max(0, this.forgeOrder.readyAt - Date.now());
    return {
      ...this.forgeOrder,
      remaining,
      ready: remaining === 0,
    };
  };

  SimulationGameAdapter.prototype.startForgeOrder = function startForgeOrder() {
    if (this.forgeOrder) {
      return {
        events: [
          {
            type: "system",
            message: `Forge is already working on Shard Blade ${this.forgeOrder.tier}.`,
          },
        ],
      };
    }
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

    const tier = this.forgedCount + 1;
    const startedAt = Date.now();
    const readyAt = startedAt + this.getForgeDuration(tier);
    this.shards -= this.forgeCost;
    this.forgeOrder = {
      active: true,
      tier,
      shardCost: this.forgeCost,
      startedAt,
      readyAt,
    };
    return {
      events: [
        {
          type: "system",
          message: `Blacksmith started Shard Blade ${tier}. The forge will finish soon.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.claimForgeOrder = function claimForgeOrder() {
    const order = this.getForgeOrder();
    if (!order) {
      return { events: [{ type: "danger", message: "No forge order is waiting." }] };
    }
    if (!order.ready) {
      return { events: [{ type: "system", message: "Forge is still working." }] };
    }

    this.forgedCount = order.tier;
    const weapon = {
      id: this.nextWeaponId,
      tier: order.tier,
      arenaBonus: Math.min(order.tier, 10) * 18,
      forgedAt: Date.now(),
      name: `Shard Blade ${order.tier}`,
    };
    this.nextWeaponId += 1;
    this.weapons.push(weapon);
    this.forgeOrder = null;

    return {
      weapon,
      events: [
        {
          type: "reward",
          message: `Blacksmith finished ${weapon.name}. Arena bonus +${weapon.arenaBonus}.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.craftWeapon = function craftWeapon() {
    return this.startForgeOrder();
  };

  SimulationGameAdapter.prototype.getEquippedWeapon = function getEquippedWeapon(heroId) {
    const weaponId = this.equippedWeapons.get(Number(heroId));
    return this.weapons.find((weapon) => weapon.id === weaponId) || null;
  };

  SimulationGameAdapter.prototype.getEquippedWeaponBonus = function getEquippedWeaponBonus(heroId) {
    return this.getEquippedWeapon(heroId)?.arenaBonus || 0;
  };

  SimulationGameAdapter.prototype.equipWeapon = function equipWeapon(hero, weaponId) {
    const weapon = this.weapons.find((item) => item.id === Number(weaponId));
    if (!hero) throw new Error("Select a hero first.");
    if (!weapon) throw new Error("Select an owned weapon first.");

    this.equippedWeapons.set(Number(hero.id), weapon.id);
    return {
      events: [
        {
          type: "reward",
          message: `${hero.name} equipped ${weapon.name}. Arena bonus +${weapon.arenaBonus}.`,
        },
      ],
    };
  };

  SimulationGameAdapter.prototype.transferWeapon = function transferWeapon(weaponId, recipient) {
    const parsedWeaponId = Number(weaponId);
    if (!recipient || recipient.trim().length < 8) throw new Error("Enter a recipient wallet address.");
    const index = this.weapons.findIndex((item) => item.id === parsedWeaponId);
    if (index === -1) throw new Error("Select an owned weapon first.");

    const [weapon] = this.weapons.splice(index, 1);
    for (const [heroId, equippedWeaponId] of this.equippedWeapons.entries()) {
      if (equippedWeaponId === parsedWeaponId) this.equippedWeapons.delete(heroId);
    }
    return {
      events: [
        {
          type: "system",
          message: `${weapon.name} sent to ${shortAddress(recipient)} in simulation.`,
        },
      ],
    };
  };

  function arenaPower(hero, weaponArenaBonus = 0) {
    if (!hero) return 0;
    return 30 + hero.rarity * 28 + hero.bravery * 2 + hero.wisdom + Math.floor(hero.greed / 2) + weaponArenaBonus;
  }

export function SomniaContractAdapter({
    contractAddress,
    onHeroRequested,
    onHeroGenerated,
    onAgentFailed,
    onArenaFight,
    onArenaStory,
    onEvent,
  }) {
    this.contractAddress = contractAddress;
    this.onHeroRequested = onHeroRequested;
    this.onHeroGenerated = onHeroGenerated;
    this.onAgentFailed = onAgentFailed;
    this.onArenaFight = onArenaFight;
    this.onArenaStory = onArenaStory;
    this.onEvent = onEvent;
    this.provider = null;
    this.signer = null;
    this.contract = null;
    this.weaponContract = null;
    this.weaponNFTAddress = "";
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
    this.weapons = [];
    this.forgedCount = 0;
    this.forgeOrder = null;
    this.equippedWeapons = new Map();
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
    let weaponNFTSupport = false;
    try {
      weaponNFTSupport = await this.contract.supportsWeaponNFTs();
    } catch {
      weaponNFTSupport = false;
    }
    if (!this.gateSupport) {
      throw new Error("Connected contract does not support gate runs. Deploy the latest contract.");
    }
    if (!this.forgeSupport) {
      throw new Error("Connected contract does not support the forge loop. Deploy the latest contract.");
    }
    if (!weaponNFTSupport) {
      throw new Error("Connected contract does not support weapon NFTs. Deploy the latest contract.");
    }
    this.weaponNFTAddress = await this.contract.weaponNFTAddress();
    this.weaponContract = new window.ethers.Contract(this.weaponNFTAddress, WEAPON_NFT_ABI, this.signer);
    await this.contract.gateRuns(0);
    await this.contract.shards(this.account);
    await this.contract.craftedWeapons(this.account);
    await this.contract.getForgeOrder(this.account);
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
    this.contract.removeAllListeners("ForgeOrderStarted");
    this.contract.removeAllListeners("ForgeOrderClaimed");
    this.contract.removeAllListeners("WeaponEquipped");
    this.contract.removeAllListeners("WeaponUnequipped");
    this.contract.removeAllListeners("ArenaFightResolved");
    this.contract.removeAllListeners("ArenaFightNarrated");
    this.weaponContract?.removeAllListeners("Transfer");

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
      this.onEvent("reward", `Blacksmith finished weapon #${Number(weaponId)} for ${Number(shardCost)} shards.`);
      this.refreshInventory().catch(() => {});
    });

    this.contract.on("ForgeOrderStarted", (owner, tier, shardCost, startedAt, readyAt) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.forgeOrder = this.parseForgeOrder({
        active: true,
        tier,
        shardCost,
        startedAt,
        readyAt,
      });
      this.shards = Math.max(0, this.shards - Number(shardCost));
      this.onEvent("system", `Forge order started for Shard Blade ${Number(tier)}.`);
    });

    this.contract.on("ForgeOrderClaimed", (owner, weaponId, tier, arenaBonus) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.forgeOrder = null;
      this.onEvent("reward", `Claimed weapon #${Number(weaponId)}. Arena bonus +${Number(arenaBonus)}.`);
      this.refreshInventory().catch(() => {});
    });

    this.contract.on("WeaponEquipped", (heroId, owner, weaponId, arenaBonus) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.equippedWeapons.set(Number(heroId), Number(weaponId));
      this.onEvent("reward", `Hero ${Number(heroId)} equipped weapon #${Number(weaponId)} (+${Number(arenaBonus)} arena).`);
    });

    this.contract.on("WeaponUnequipped", (heroId, owner, weaponId) => {
      if (owner.toLowerCase() !== this.account.toLowerCase()) return;
      this.equippedWeapons.delete(Number(heroId));
      this.onEvent("system", `Hero ${Number(heroId)} unequipped weapon #${Number(weaponId)}.`);
    });

    this.weaponContract?.on("Transfer", (from, to, weaponId) => {
      const account = this.account.toLowerCase();
      if (from.toLowerCase() !== account && to.toLowerCase() !== account) return;
      this.refreshInventory().catch(() => {});
    });

    this.contract.on(
      "ArenaFightResolved",
      (roomId, winner, winnerHeroId, loserHeroId, payout, creatorPower, challengerPower) => {
        const fight = {
          roomId: Number(roomId),
          winner,
          winnerHeroId: Number(winnerHeroId),
          loserHeroId: Number(loserHeroId),
          payout,
          creatorPower: Number(creatorPower),
          challengerPower: Number(challengerPower),
        };
        const accountWon = winner.toLowerCase() === this.account.toLowerCase();
        this.onArenaFight?.(fight);
        this.onEvent(
          accountWon ? "reward" : "system",
          `Arena challenge ${fight.roomId} resolved. Winner hero ${fight.winnerHeroId} defeated ${fight.loserHeroId}.`,
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
    const weaponCount = this.weapons.length;
    const latestWeapon = weaponCount ? this.weapons[weaponCount - 1] : null;
    const forgeOrder = this.currentForgeOrder();
    return {
      shards: this.shards,
      weapons: weaponCount,
      weaponName: latestWeapon ? latestWeapon.name : "None",
      forgeCost: this.forgeCost,
      forgeOrder,
      weaponItems: this.weapons.slice(),
      nextForgeTier: this.forgedCount + 1,
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
    await this.refreshEquippedWeapons(ids.map((heroId) => Number(heroId)));
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

  SomniaContractAdapter.prototype.getArenaRoomResult = async function getArenaRoomResult(roomId) {
    if (!this.contract || !roomId) return null;
    const parsedRoomId = Number(roomId);
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const room = await this.contract.arenaRooms(parsedRoomId);
    const creator = room.creator ?? room[0];
    if (!creator || creator === zeroAddress) return null;

    const resolved = Boolean(room.resolved ?? room[9]);
    let story = this.getArenaStory(parsedRoomId);
    try {
      const chainStory = await this.contract.lastArenaStory(parsedRoomId);
      if (chainStory) {
        story = {
          requestId: `room-${parsedRoomId}`,
          story: chainStory.toString(),
        };
        this.arenaStories.set(parsedRoomId, story);
      }
    } catch {
      // Older deployments may not expose lastArenaStory.
    }

    if (!resolved) {
      let pendingNarration = false;
      try {
        pendingNarration = Boolean(await this.contract.pendingArenaNarration(parsedRoomId));
      } catch {
        pendingNarration = false;
      }
      return {
        roomId: parsedRoomId,
        resolved: false,
        pendingNarration,
        story,
      };
    }

    const challenger = room.challenger ?? room[1];
    const creatorHeroId = Number(room.creatorHeroId ?? room[2]);
    const challengerHeroId = Number(room.challengerHeroId ?? room[3]);
    const winner = room.winner ?? room[7];
    const winnerHeroId = Number(room.winnerHeroId ?? room[8]);
    const loserHeroId = winnerHeroId === creatorHeroId ? challengerHeroId : creatorHeroId;
    const stake = room.stake ?? room[4];
    const [winnerHeroName, loserHeroName] = await Promise.all([
      this.loadHeroName(winnerHeroId),
      this.loadHeroName(loserHeroId),
    ]);

    return {
      roomId: parsedRoomId,
      resolved: true,
      story,
      fight: {
        roomId: parsedRoomId,
        creator,
        challenger,
        winner,
        winnerHeroId,
        loserHeroId,
        winnerHeroName,
        loserHeroName,
        creatorHeroId,
        challengerHeroId,
        creatorPower: Number(room.creatorPower ?? room[5]),
        challengerPower: Number(room.challengerPower ?? room[6]),
        payout: typeof stake === "bigint" ? stake * 2n : Number(stake) * 2,
        accountWon: winner.toLowerCase() === this.account.toLowerCase(),
      },
    };
  };

  SomniaContractAdapter.prototype.loadHeroName = async function loadHeroName(heroId) {
    if (!this.contract || !heroId) return `Hero ${heroId}`;
    try {
      const hero = await this.contract.heroes(heroId);
      const name = hero.name ?? hero[1];
      return (name || `Hero ${heroId}`).toString();
    } catch {
      return `Hero ${heroId}`;
    }
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
          message: "Recruitment rite confirmed.",
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
    if (!this.llmGateSupport || !this.oneTxAdventureSupport) {
      throw new Error("Connected contract does not support one-click LLM adventures. Deploy the latest contract.");
    }

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
  };

  SomniaContractAdapter.prototype.resolveGateStep = async function resolveGateStep(hero) {
    return this.enterGate(hero.id, hero.name);
  };

  SomniaContractAdapter.prototype.getRun = function getRun(heroId) {
    return this.runs.get(heroId) || null;
  };

  SomniaContractAdapter.prototype.startForgeOrder = async function startForgeOrder() {
    await this.refreshInventory();
    if (this.forgeOrder?.active) {
      return {
        events: [
          {
            type: "system",
            message: `Forge is already working on Shard Blade ${this.forgeOrder.tier}.`,
          },
        ],
      };
    }
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

    const tx = await this.contract.startForgeOrder();
    this.onEvent("system", `Submitted startForgeOrder() to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const started = this.extractForgeOrderStarted(receipt);
    await this.refreshInventory();

    return {
      events: [
        {
          type: "system",
          message: started
            ? `Blacksmith started Shard Blade ${started.tier}. Ready at ${new Date(started.readyAt).toLocaleTimeString()}.`
            : "Blacksmith started a forge order.",
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.claimForgeOrder = async function claimForgeOrder() {
    await this.refreshInventory();
    if (!this.forgeOrder?.active) {
      return { events: [{ type: "danger", message: "No forge order is waiting." }] };
    }
    if (!this.forgeOrder.ready) {
      return { events: [{ type: "system", message: "Forge is still working." }] };
    }

    const tx = await this.contract.claimForgeOrder();
    this.onEvent("system", `Submitted claimForgeOrder() to Somnia: ${shortAddress(tx.hash)}.`);
    const receipt = await tx.wait();
    const claimed = this.extractForgeOrderClaimed(receipt);
    await this.refreshInventory();

    return {
      events: [
        {
          type: "reward",
          message: claimed
            ? `Claimed weapon #${claimed.weaponId}. Arena bonus +${claimed.arenaBonus}.`
            : "Claimed forged weapon.",
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.craftWeapon = async function craftWeapon() {
    return this.startForgeOrder();
  };

  SomniaContractAdapter.prototype.equipWeapon = async function equipWeapon(hero, weaponId) {
    if (!hero) throw new Error("Select a hero first.");
    const parsedWeaponId = Number(weaponId);
    if (!parsedWeaponId) throw new Error("Select an owned weapon first.");

    const tx = await this.contract.equipWeapon(hero.id, parsedWeaponId);
    this.onEvent("system", `Submitted equipWeapon(${hero.id}, ${parsedWeaponId}) to Somnia: ${shortAddress(tx.hash)}.`);
    await tx.wait();
    await this.refreshEquippedWeapons([hero.id]);

    const weapon = this.weapons.find((item) => item.id === parsedWeaponId);
    return {
      events: [
        {
          type: "reward",
          message: `${hero.name} equipped ${weapon?.name || `weapon #${parsedWeaponId}`}.`,
        },
      ],
    };
  };

  SomniaContractAdapter.prototype.transferWeapon = async function transferWeapon(weaponId, recipient) {
    if (!this.weaponContract) throw new Error("Weapon NFT contract is not loaded.");
    if (!window.ethers.isAddress(recipient)) throw new Error("Enter a valid recipient wallet address.");
    const parsedWeaponId = Number(weaponId);
    if (!parsedWeaponId) throw new Error("Select an owned weapon first.");

    const tx = await this.weaponContract.transferFrom(this.account, recipient, parsedWeaponId);
    this.onEvent("system", `Submitted transfer of weapon #${parsedWeaponId}: ${shortAddress(tx.hash)}.`);
    await tx.wait();
    await this.refreshInventory();

    return {
      events: [
        {
          type: "system",
          message: `Weapon #${parsedWeaponId} sent to ${shortAddress(recipient)}.`,
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
    const requiredValue = stake + fee;
    const insufficientFundsMessage = formatArenaJoinFundsMessage(stake, fee);
    if (this.provider && this.account) {
      const balance = await this.provider.getBalance(this.account);
      if (balance < requiredValue) {
        throw new Error(insufficientFundsMessage);
      }
    }

    let tx;
    try {
      tx = await this.contract.joinArenaRoomWithNarration(roomId, hero.id, { value: requiredValue });
    } catch (error) {
      if (isInsufficientFundsError(error)) {
        throw new Error(insufficientFundsMessage);
      }
      throw error;
    }
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
    const [shards, forgedCount, forgeCost, forgeOrder, weaponItems] = await Promise.all([
      this.contract.shards(this.account),
      this.contract.craftedWeapons(this.account),
      this.contract.WEAPON_SHARD_COST(),
      this.contract.getForgeOrder(this.account),
      this.loadOwnedWeapons(),
    ]);
    this.shards = Number(shards);
    this.forgedCount = Number(forgedCount);
    this.forgeCost = Number(forgeCost);
    this.forgeOrder = this.parseForgeOrder(forgeOrder);
    this.weapons = weaponItems;
    return this.getInventory();
  };

  SomniaContractAdapter.prototype.loadOwnedWeapons = async function loadOwnedWeapons() {
    if (!this.weaponContract || !this.account) return [];
    const balance = Number(await this.weaponContract.balanceOf(this.account));
    const weapons = [];

    for (let index = 0; index < balance; index += 1) {
      const weaponId = Number(await this.weaponContract.tokenOfOwnerByIndex(this.account, index));
      const stats = await this.weaponContract.weaponStats(weaponId);
      const tier = Number(stats.tier ?? stats[0]);
      const arenaBonus = Number(stats.arenaBonus ?? stats[1]);
      const forgedAt = Number(stats.forgedAt ?? stats[2]) * 1000;
      weapons.push({
        id: weaponId,
        tier,
        arenaBonus,
        forgedAt,
        name: `Shard Blade ${tier}`,
      });
    }

    return weapons.sort((first, second) => first.id - second.id);
  };

  SomniaContractAdapter.prototype.refreshEquippedWeapons = async function refreshEquippedWeapons(heroIds) {
    if (!this.contract) return;
    const pairs = await Promise.all(
      heroIds.map(async (heroId) => {
        const weaponId = Number(await this.contract.equippedWeapons(heroId));
        return [Number(heroId), weaponId];
      }),
    );

    pairs.forEach(([heroId, weaponId]) => {
      if (weaponId) {
        this.equippedWeapons.set(heroId, weaponId);
      } else {
        this.equippedWeapons.delete(heroId);
      }
    });
  };

  SomniaContractAdapter.prototype.getEquippedWeapon = function getEquippedWeapon(heroId) {
    const weaponId = this.equippedWeapons.get(Number(heroId));
    return this.weapons.find((weapon) => weapon.id === weaponId) || null;
  };

  SomniaContractAdapter.prototype.getEquippedWeaponBonus = function getEquippedWeaponBonus(heroId) {
    return this.getEquippedWeapon(heroId)?.arenaBonus || 0;
  };

  SomniaContractAdapter.prototype.currentForgeOrder = function currentForgeOrder() {
    if (!this.forgeOrder?.active) return null;
    const remaining = Math.max(0, this.forgeOrder.readyAt - Date.now());
    return {
      ...this.forgeOrder,
      remaining,
      ready: remaining === 0,
    };
  };

  SomniaContractAdapter.prototype.parseForgeOrder = function parseForgeOrder(order) {
    if (!order) return null;
    const active = Boolean(order.active ?? order[0]);
    if (!active) return null;

    const readyAt = Number(order.readyAt ?? order[4]) * 1000;
    const remaining = Math.max(0, readyAt - Date.now());
    return {
      active,
      tier: Number(order.tier ?? order[1]),
      shardCost: Number(order.shardCost ?? order[2]),
      startedAt: Number(order.startedAt ?? order[3]) * 1000,
      readyAt,
      remaining,
      ready: remaining === 0,
    };
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

  SomniaContractAdapter.prototype.extractForgeOrderStarted = function extractForgeOrderStarted(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "ForgeOrderStarted") continue;
        if (parsed.args.owner.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          owner: parsed.args.owner,
          tier: Number(parsed.args.tier),
          shardCost: Number(parsed.args.shardCost),
          startedAt: Number(parsed.args.startedAt) * 1000,
          readyAt: Number(parsed.args.readyAt) * 1000,
        };
      } catch {
        // Ignore logs from other contracts in the same transaction.
      }
    }
    return null;
  };

  SomniaContractAdapter.prototype.extractForgeOrderClaimed = function extractForgeOrderClaimed(receipt) {
    for (const log of receipt.logs || []) {
      try {
        const parsed = this.contract.interface.parseLog(log);
        if (parsed?.name !== "ForgeOrderClaimed") continue;
        if (parsed.args.owner.toLowerCase() !== this.account.toLowerCase()) continue;
        return {
          owner: parsed.args.owner,
          weaponId: Number(parsed.args.weaponId),
          tier: Number(parsed.args.tier),
          arenaBonus: Number(parsed.args.arenaBonus),
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

  function formatArenaJoinFundsMessage(stake, fee) {
    const total = stake + fee;
    return `Insufficient STT to accept this challenge. You need ${window.ethers.formatEther(stake)} STT stake + ${window.ethers.formatEther(fee)} STT AI narration fee (${window.ethers.formatEther(total)} STT total), plus gas.`;
  }

  function isInsufficientFundsError(error) {
    const parts = [
      error?.code,
      error?.shortMessage,
      error?.reason,
      error?.message,
      error?.info?.error?.message,
      error?.error?.message,
    ];
    const message = parts.filter(Boolean).join(" ").toLowerCase();
    return (
      message.includes("insufficient funds") ||
      message.includes("insufficient balance") ||
      message.includes("not enough funds") ||
      message.includes("exceeds balance")
    );
  }

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
