// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum ConsensusType {
    Majority,
    Threshold
}

enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

interface IJsonApiAgent {
    function fetchUint(
        string calldata url,
        string calldata selector,
        uint8 decimals
    ) external returns (uint256);
}

/// @title GatesOfSogentMarketGame
/// @notice Base prototype: Somnia JSON API Agent fetches market data used to generate hero traits.
contract GatesOfSogentMarketGame {
    string public constant GAME_VERSION = "0.3.0-market-gate-forge";
    uint256 public constant SOMNIA_TESTNET_CHAIN_ID = 50312;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_FETCH_COST_PER_AGENT = 0.03 ether;
    uint256 public constant WEAPON_SHARD_COST = 25;

    string public constant MARKET_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,somnia&vs_currencies=usd";
    uint256 public constant MARKET_COUNT = 3;

    IAgentRequester public constant SOMNIA_AGENTS =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    struct Hero {
        address owner;
        string name;
        uint256 seed;
        uint256 bitcoinPrice;
        uint256 ethereumPrice;
        uint256 somniaPrice;
        uint8 classId;
        uint8 rarity;
        uint8 bravery;
        uint8 greed;
        uint8 wisdom;
    }

    struct PendingHero {
        address owner;
        string name;
        uint256 receivedMarkets;
        uint256 bitcoinPrice;
        uint256 ethereumPrice;
        uint256 somniaPrice;
    }

    struct GateRun {
        bool active;
        uint16 floor;
        uint16 hp;
        uint256 loot;
    }

    uint256 public nextHeroId = 1;
    uint256 public latestBitcoinPrice;
    uint256 public latestEthereumPrice;
    uint256 public latestSomniaPrice;

    mapping(uint256 => Hero) public heroes;
    mapping(uint256 => GateRun) public gateRuns;
    mapping(address => uint256) public shards;
    mapping(address => uint256) public craftedWeapons;
    mapping(uint256 => PendingHero) public pendingHeroes;
    mapping(uint256 => bool) public pendingRequests;
    mapping(uint256 => uint256) public requestToMarketId;
    mapping(uint256 => uint256) public requestToGroupId;
    mapping(address => uint256[]) private ownerHeroes;

    event HeroRequested(uint256 indexed groupId, address indexed owner, string name);
    event MarketRequested(uint256 indexed requestId, uint256 indexed groupId, uint256 marketId, string selector);
    event MarketDataReceived(uint256 indexed requestId, uint256 indexed groupId, uint256 marketId, uint256 marketPrice);
    event HeroGenerated(
        uint256 indexed heroId,
        address indexed owner,
        string name,
        uint256 seed,
        uint256 bitcoinPrice,
        uint256 ethereumPrice,
        uint256 somniaPrice,
        uint8 classId,
        uint8 rarity,
        uint8 bravery,
        uint8 greed,
        uint8 wisdom
    );
    event AgentRequestFailed(uint256 indexed requestId, uint256 indexed groupId, ResponseStatus status);
    event GateRunStarted(uint256 indexed heroId, address indexed owner, uint16 hp);
    event GateFloorResolved(
        uint256 indexed heroId,
        address indexed owner,
        uint16 floor,
        uint16 hp,
        uint256 loot,
        bool active,
        string outcome
    );
    event ShardsBanked(address indexed owner, uint256 amount, uint256 balance);
    event WeaponCrafted(address indexed owner, uint256 indexed weaponId, uint256 shardCost);

    modifier onlySomniaTestnet() {
        require(block.chainid == SOMNIA_TESTNET_CHAIN_ID, "Use Somnia testnet");
        _;
    }

    function requiredFee() public view returns (uint256) {
        return SOMNIA_AGENTS.getRequestDeposit() + (JSON_FETCH_COST_PER_AGENT * SUBCOMMITTEE_SIZE);
    }

    function requiredTotalFee() public view returns (uint256) {
        return requiredFee() * MARKET_COUNT;
    }

    function contractVersion() external pure returns (string memory) {
        return GAME_VERSION;
    }

    function supportsGateRuns() external pure returns (bool) {
        return true;
    }

    function supportsForge() external pure returns (bool) {
        return true;
    }

    function requestHero(
        string calldata name
    ) external payable onlySomniaTestnet returns (uint256 groupId) {
        require(bytes(name).length > 0 && bytes(name).length <= 40, "Bad hero name");
        uint256 totalFee = requiredTotalFee();
        require(msg.value == totalFee, "Send exact STT fee");

        groupId = nextHeroId;
        nextHeroId++;

        pendingHeroes[groupId] = PendingHero({
            owner: msg.sender,
            name: name,
            receivedMarkets: 0,
            bitcoinPrice: 0,
            ethereumPrice: 0,
            somniaPrice: 0
        });

        uint256 fee = totalFee / MARKET_COUNT;

        _requestMarket(groupId, 1, "bitcoin.usd", fee);
        _requestMarket(groupId, 2, "ethereum.usd", fee);
        _requestMarket(groupId, 3, "somnia.usd", fee);

        emit HeroRequested(groupId, msg.sender, name);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(SOMNIA_AGENTS), "Only SomniaAgents");
        require(pendingRequests[requestId], "Unknown request");

        pendingRequests[requestId] = false;

        uint256 groupId = requestToGroupId[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            delete pendingHeroes[groupId];
            emit AgentRequestFailed(requestId, groupId, status);
            return;
        }

        uint256 marketPrice = abi.decode(responses[0].result, (uint256));
        uint256 marketId = requestToMarketId[requestId];

        if (pendingHeroes[groupId].owner == address(0)) {
            emit AgentRequestFailed(requestId, groupId, ResponseStatus.Failed);
            return;
        }

        _storeMarket(groupId, marketId, marketPrice);

        emit MarketDataReceived(requestId, groupId, marketId, marketPrice);

        if (pendingHeroes[groupId].receivedMarkets == MARKET_COUNT) {
            _generateHero(groupId);
        }
    }

    function getOwnerHeroes(address owner) external view returns (uint256[] memory) {
        return ownerHeroes[owner];
    }

    function startGateRun(uint256 heroId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");
        require(!gateRuns[heroId].active, "Gate already active");

        gateRuns[heroId] = GateRun({active: true, floor: 1, hp: 100, loot: 0});

        emit GateRunStarted(heroId, msg.sender, 100);
    }

    function resolveGateFloor(uint256 heroId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");

        GateRun storage run = gateRuns[heroId];
        require(run.active, "No active gate");

        uint16 floor = run.floor;
        uint256 roll = _gateRoll(hero.seed, heroId, floor, run.hp, run.loot);
        uint16 damage = _gateDamage(hero.bravery, hero.wisdom, hero.rarity, floor, roll);

        if (damage >= run.hp) {
            run.hp = 0;
            run.loot = 0;
            run.active = false;
            emit GateFloorResolved(heroId, msg.sender, floor, run.hp, run.loot, run.active, "DEFEATED");
            return;
        }

        run.hp -= damage;
        run.loot += _gateLoot(hero.greed, hero.rarity, floor);

        if (run.hp < 34 && hero.bravery < 70) {
            run.active = false;
            _bankShards(msg.sender, run.loot);
            emit GateFloorResolved(heroId, msg.sender, floor, run.hp, run.loot, run.active, "RETREATED");
            return;
        }

        if (_continuesDeeper(hero.bravery, hero.greed, hero.wisdom, run.hp, roll)) {
            run.floor = floor + 1;
            emit GateFloorResolved(heroId, msg.sender, floor, run.hp, run.loot, run.active, "CONTINUED");
            return;
        }

        run.active = false;
        _bankShards(msg.sender, run.loot);
        emit GateFloorResolved(heroId, msg.sender, floor, run.hp, run.loot, run.active, "RETURNED");
    }

    function craftWeapon() external onlySomniaTestnet returns (uint256 weaponId) {
        require(shards[msg.sender] >= WEAPON_SHARD_COST, "Need more shards");

        shards[msg.sender] -= WEAPON_SHARD_COST;
        craftedWeapons[msg.sender]++;
        weaponId = craftedWeapons[msg.sender];

        emit WeaponCrafted(msg.sender, weaponId, WEAPON_SHARD_COST);
    }

    function _requestMarket(
        uint256 groupId,
        uint256 marketId,
        string memory selector,
        uint256 fee
    ) private {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            MARKET_URL,
            selector,
            uint8(8)
        );

        uint256 requestId = SOMNIA_AGENTS.createRequest{value: fee}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        requestToGroupId[requestId] = groupId;
        requestToMarketId[requestId] = marketId;

        emit MarketRequested(requestId, groupId, marketId, selector);
    }

    function _storeMarket(uint256 groupId, uint256 marketId, uint256 marketPrice) private {
        PendingHero storage pendingHero = pendingHeroes[groupId];

        if (marketId == 1) {
            pendingHero.bitcoinPrice = marketPrice;
            latestBitcoinPrice = marketPrice;
        } else if (marketId == 2) {
            pendingHero.ethereumPrice = marketPrice;
            latestEthereumPrice = marketPrice;
        } else {
            pendingHero.somniaPrice = marketPrice;
            latestSomniaPrice = marketPrice;
        }

        pendingHero.receivedMarkets++;
    }

    function _generateHero(uint256 groupId) private {
        PendingHero memory pendingHero = pendingHeroes[groupId];
        delete pendingHeroes[groupId];

        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    pendingHero.bitcoinPrice,
                    pendingHero.ethereumPrice,
                    pendingHero.somniaPrice,
                    groupId,
                    pendingHero.owner,
                    pendingHero.name,
                    block.timestamp,
                    blockhash(block.number - 1)
                )
            )
        );

        Hero storage hero = heroes[groupId];
        hero.owner = pendingHero.owner;
        hero.name = pendingHero.name;
        hero.seed = seed;
        hero.bitcoinPrice = pendingHero.bitcoinPrice;
        hero.ethereumPrice = pendingHero.ethereumPrice;
        hero.somniaPrice = pendingHero.somniaPrice;
        hero.classId = uint8((seed % 4) + 1);
        hero.rarity = _rarity(seed);
        hero.bravery = uint8(((seed >> 16) % 100) + 1);
        hero.greed = uint8(((seed >> 32) % 100) + 1);
        hero.wisdom = uint8(((seed >> 48) % 100) + 1);

        ownerHeroes[pendingHero.owner].push(groupId);
        _emitHeroGenerated(groupId);
    }

    function _emitHeroGenerated(uint256 heroId) private {
        Hero storage hero = heroes[heroId];
        emit HeroGenerated(
            heroId,
            hero.owner,
            hero.name,
            hero.seed,
            hero.bitcoinPrice,
            hero.ethereumPrice,
            hero.somniaPrice,
            hero.classId,
            hero.rarity,
            hero.bravery,
            hero.greed,
            hero.wisdom
        );
    }

    function _bankShards(address owner, uint256 amount) private {
        if (amount == 0) return;
        shards[owner] += amount;
        emit ShardsBanked(owner, amount, shards[owner]);
    }

    function _rarity(uint256 seed) private pure returns (uint8) {
        uint256 roll = seed % 100;

        if (roll < 5) return 5;
        if (roll < 15) return 4;
        if (roll < 35) return 3;
        if (roll < 65) return 2;
        return 1;
    }

    function _gateRoll(
        uint256 seed,
        uint256 heroId,
        uint16 floor,
        uint16 hp,
        uint256 loot
    ) private view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encodePacked(
                        seed,
                        heroId,
                        floor,
                        hp,
                        loot,
                        block.timestamp,
                        blockhash(block.number - 1)
                    )
                )
            ) % 100;
    }

    function _gateDamage(
        uint8 bravery,
        uint8 wisdom,
        uint8 rarity,
        uint16 floor,
        uint256 roll
    ) private pure returns (uint16) {
        uint16 pressure = uint16(16 + (uint256(floor) * 9) + (roll % 16));
        uint16 defense = uint16(((uint16(bravery) + uint16(wisdom)) / 8) + (uint16(rarity) * 4));

        if (pressure <= defense + 3) return 3;
        return uint16(pressure - defense);
    }

    function _gateLoot(uint8 greed, uint8 rarity, uint16 floor) private pure returns (uint256) {
        return (uint256(floor) * 5) + (uint256(rarity) * 3) + (uint256(greed) / 16);
    }

    function _continuesDeeper(
        uint8 bravery,
        uint8 greed,
        uint8 wisdom,
        uint16 hp,
        uint256 roll
    ) private pure returns (bool) {
        if (greed > 68 && roll > 32) return true;
        if (bravery > 58 && hp > 24) return true;
        if (wisdom > 72 && hp > 40) return true;
        return false;
    }

    receive() external payable {}
}
