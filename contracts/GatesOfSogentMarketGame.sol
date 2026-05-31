// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GateAdventureLib.sol";
import "./SomniaAgents.sol";

/// @title GatesOfSogentMarketGame
/// @notice Base prototype: Somnia JSON API Agent fetches market data used to generate hero traits.
contract GatesOfSogentMarketGame {
    string public constant GAME_VERSION = "0.5.0-llm-story";
    uint256 public constant SOMNIA_TESTNET_CHAIN_ID = 50312;
    uint8 public constant REQUEST_MARKET = 1;
    uint8 public constant REQUEST_GATE_DECISION = 2;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_FETCH_COST_PER_AGENT = 0.03 ether;
    uint256 public constant LLM_COST_PER_AGENT = 0.07 ether;
    uint256 public constant WEAPON_SHARD_COST = 25;
    uint256 public constant MAX_ROUTE_LENGTH = GateAdventureLib.MAX_ROUTE_LENGTH;
    uint256 public constant MAX_STORY_BYTES = GateAdventureLib.MAX_STORY_BYTES;

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
    mapping(uint256 => uint8) public requestKind;
    mapping(uint256 => uint256) public requestToMarketId;
    mapping(uint256 => uint256) public requestToGroupId;
    mapping(uint256 => bool) public pendingGateDecision;
    mapping(uint256 => string) public lastGateDecision;
    mapping(uint256 => uint256) public gateRunNonce;
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
    event GateDecisionRequested(uint256 indexed requestId, uint256 indexed heroId, address indexed owner);
    event GateDecisionReceived(uint256 indexed requestId, uint256 indexed heroId, string route);
    event GateAdventureNarrated(uint256 indexed requestId, uint256 indexed heroId, string route, string story);
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

    function requiredGateDecisionFee() public view returns (uint256) {
        return SOMNIA_AGENTS.getRequestDeposit() + (LLM_COST_PER_AGENT * SUBCOMMITTEE_SIZE);
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

    function supportsLLMGateDecisions() external pure returns (bool) {
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

        uint8 kind = requestKind[requestId];
        if (kind == REQUEST_GATE_DECISION) {
            _handleGateDecisionResponse(requestId, responses, status);
            return;
        }

        require(kind == REQUEST_MARKET, "Unknown request kind");
        _handleMarketResponse(requestId, responses, status);
    }

    function getOwnerHeroes(address owner) external view returns (uint256[] memory) {
        return ownerHeroes[owner];
    }

    function startGateRun(uint256 heroId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");
        require(!gateRuns[heroId].active, "Gate already active");

        gateRunNonce[heroId]++;
        gateRuns[heroId] = GateRun({active: true, floor: 1, hp: 100, loot: 0});

        emit GateRunStarted(heroId, msg.sender, 100);
    }

    function requestGateDecision(uint256 heroId) external payable onlySomniaTestnet returns (uint256 requestId) {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");

        GateRun storage run = gateRuns[heroId];
        require(run.active, "No active gate");
        require(!pendingGateDecision[heroId], "Decision pending");

        uint256 fee = requiredGateDecisionFee();
        require(msg.value == fee, "Send exact LLM fee");

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            _gateAdventurePrompt(heroId),
            _gateAdventureSystem(),
            false,
            _emptyAllowedValues()
        );

        requestId = SOMNIA_AGENTS.createRequest{value: fee}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        requestKind[requestId] = REQUEST_GATE_DECISION;
        requestToGroupId[requestId] = heroId;
        pendingGateDecision[heroId] = true;

        emit GateDecisionRequested(requestId, heroId, msg.sender);
    }

    function resolveGateFloor(uint256 heroId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");
        require(!pendingGateDecision[heroId], "Decision pending");

        _resolveGateFloor(heroId, "", false);
    }

    function craftWeapon() external onlySomniaTestnet returns (uint256 weaponId) {
        require(shards[msg.sender] >= WEAPON_SHARD_COST, "Need more shards");

        shards[msg.sender] -= WEAPON_SHARD_COST;
        craftedWeapons[msg.sender]++;
        weaponId = craftedWeapons[msg.sender];

        emit WeaponCrafted(msg.sender, weaponId, WEAPON_SHARD_COST);
    }

    function _handleMarketResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) private {
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

    function _handleGateDecisionResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) private {
        uint256 heroId = requestToGroupId[requestId];
        pendingGateDecision[heroId] = false;

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentRequestFailed(requestId, heroId, status);
            return;
        }

        string memory output = abi.decode(responses[0].result, (string));
        string memory route = GateAdventureLib.normalizeRoute(output);
        string memory story = GateAdventureLib.extractStory(output);
        lastGateDecision[heroId] = route;

        emit GateDecisionReceived(requestId, heroId, route);
        emit GateAdventureNarrated(requestId, heroId, route, story);

        _resolveGateRoute(heroId, route);
    }

    function _resolveGateRoute(uint256 heroId, string memory route) private {
        bytes memory steps = bytes(route);

        for (uint256 i = 0; i < steps.length && gateRuns[heroId].active; i++) {
            string memory decision = steps[i] == bytes1("P") ? "CONTINUE" : "RETURN";
            _resolveGateFloor(heroId, decision, true);

            if (steps[i] == bytes1("S")) {
                return;
            }
        }
    }

    function _resolveGateFloor(uint256 heroId, string memory decision, bool hasDecision) private {
        Hero storage hero = heroes[heroId];
        GateRun storage run = gateRuns[heroId];
        require(run.active, "No active gate");

        uint16 floor = run.floor;
        uint256 roll = GateAdventureLib.roll(hero.seed, heroId, gateRunNonce[heroId], floor, run.hp, run.loot);
        uint16 damage = GateAdventureLib.damage(hero.bravery, hero.wisdom, hero.rarity, floor, roll);

        if (damage >= run.hp) {
            run.hp = 0;
            run.loot = 0;
            run.active = false;
            emit GateFloorResolved(heroId, hero.owner, floor, run.hp, run.loot, run.active, "DEFEATED");
            return;
        }

        run.hp -= damage;
        run.loot += GateAdventureLib.loot(hero.greed, hero.rarity, floor);

        if (run.hp < 34 && hero.bravery < 70) {
            run.active = false;
            _bankShards(hero.owner, run.loot);
            emit GateFloorResolved(heroId, hero.owner, floor, run.hp, run.loot, run.active, "RETREATED");
            return;
        }

        bool wantsContinue = hasDecision ? GateAdventureLib.isContinueDecision(decision) : GateAdventureLib.continuesDeeper(
            hero.bravery,
            hero.greed,
            hero.wisdom,
            run.hp,
            roll
        );

        if (wantsContinue && GateAdventureLib.continuesDeeper(hero.bravery, hero.greed, hero.wisdom, run.hp, roll)) {
            run.floor = floor + 1;
            emit GateFloorResolved(
                heroId,
                hero.owner,
                floor,
                run.hp,
                run.loot,
                run.active,
                hasDecision ? "LLM_CONTINUED" : "CONTINUED"
            );
            return;
        }

        run.active = false;
        _bankShards(hero.owner, run.loot);
        emit GateFloorResolved(
            heroId,
            hero.owner,
            floor,
            run.hp,
            run.loot,
            run.active,
            hasDecision && wantsContinue ? "LLM_BLOCKED_RETURNED" : hasDecision ? "LLM_RETURNED" : "RETURNED"
        );
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
        requestKind[requestId] = REQUEST_MARKET;
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
        hero.rarity = GateAdventureLib.rarity(seed);
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

    function _emptyAllowedValues() private pure returns (string[] memory allowedValues) {
        allowedValues = new string[](0);
    }

    function _gateAdventureSystem() private pure returns (string memory) {
        return
            "You are the narrator and survival instinct of one RPG hero. "
            "Return exactly two plain-text lines: ROUTE=<route> and STORY=<story>. "
            "The route must use only P and S, max five letters, and must end with S. "
            "P means pass deeper after this floor. S means stop after this floor and return. "
            "The story is flavor only. Never invent exact HP, damage, loot, or rewards.";
    }

    function _gateAdventurePrompt(uint256 heroId) private view returns (string memory) {
        Hero storage hero = heroes[heroId];
        GateRun storage run = gateRuns[heroId];

        return
            string.concat(
                "Hero: ",
                hero.name,
                ". Class ",
                _toString(hero.classId),
                ". Rarity ",
                _toString(hero.rarity),
                ". Bravery ",
                _toString(hero.bravery),
                ". Greed ",
                _toString(hero.greed),
                ". Wisdom ",
                _toString(hero.wisdom),
                ". Current floor ",
                _toString(run.floor),
                ". HP ",
                _toString(run.hp),
                ". Carried shards ",
                _toString(run.loot),
                ". Known floor outcomes if attempted in order: ",
                _floorPreview(heroId),
                " Choose a route. Cowardly heroes stop early. Greedy heroes risk more. "
                "Wise heroes stop before likely death. Brave heroes push deeper. "
                "Return exactly ROUTE=<route> newline STORY=<short paragraph>."
            );
    }

    function _floorPreview(uint256 heroId) private view returns (string memory preview) {
        Hero storage hero = heroes[heroId];
        GateRun memory run = gateRuns[heroId];

        preview = "";
        for (uint256 i = 0; i < MAX_ROUTE_LENGTH; i++) {
            if (!run.active) break;

            uint256 roll = GateAdventureLib.roll(hero.seed, heroId, gateRunNonce[heroId], run.floor, run.hp, run.loot);
            uint16 damage = GateAdventureLib.damage(hero.bravery, hero.wisdom, hero.rarity, run.floor, roll);
            uint256 lootGain = GateAdventureLib.loot(hero.greed, hero.rarity, run.floor);

            preview = string.concat(
                preview,
                _toString(run.floor),
                ". ",
                GateAdventureLib.floorName(run.floor),
                ": ",
                damage >= run.hp ? "fatal damage" : string.concat(_toString(damage), " damage"),
                ", ",
                _toString(lootGain),
                " shards. "
            );

            if (damage >= run.hp) break;
            run.hp -= damage;
            run.loot += lootGain;
            run.floor++;
        }
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        bytes memory symbols = "0123456789";
        while (value != 0) {
            digits -= 1;
            buffer[digits] = symbols[value % 10];
            value /= 10;
        }

        return string(buffer);
    }

    receive() external payable {}
}
