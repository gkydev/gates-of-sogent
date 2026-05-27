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
    uint256 public constant SOMNIA_TESTNET_CHAIN_ID = 50312;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_FETCH_COST_PER_AGENT = 0.03 ether;

    string public constant MARKET_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,somnia-network&vs_currencies=usd";
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

    uint256 public nextHeroId = 1;
    uint256 public latestBitcoinPrice;
    uint256 public latestEthereumPrice;
    uint256 public latestSomniaPrice;

    mapping(uint256 => Hero) public heroes;
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

    function requestHero(
        string calldata name
    ) external payable onlySomniaTestnet returns (uint256 groupId) {
        require(bytes(name).length > 0 && bytes(name).length <= 40, "Bad hero name");
        require(msg.value >= requiredTotalFee(), "Need more STT");

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

        uint256 fee = requiredFee();

        _requestMarket(groupId, 1, "bitcoin.usd", fee);
        _requestMarket(groupId, 2, "ethereum.usd", fee);
        _requestMarket(groupId, 3, "somnia-network.usd", fee);

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

        _storeMarket(groupId, marketId, marketPrice);

        emit MarketDataReceived(requestId, groupId, marketId, marketPrice);

        if (pendingHeroes[groupId].receivedMarkets == MARKET_COUNT) {
            _generateHero(groupId);
        }
    }

    function getOwnerHeroes(address owner) external view returns (uint256[] memory) {
        return ownerHeroes[owner];
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

        uint256 heroId = groupId;

        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    pendingHero.bitcoinPrice,
                    pendingHero.ethereumPrice,
                    pendingHero.somniaPrice,
                    groupId,
                    heroId,
                    pendingHero.owner,
                    pendingHero.name,
                    block.timestamp,
                    blockhash(block.number - 1)
                )
            )
        );

        Hero memory hero = Hero({
            owner: pendingHero.owner,
            name: pendingHero.name,
            seed: seed,
            bitcoinPrice: pendingHero.bitcoinPrice,
            ethereumPrice: pendingHero.ethereumPrice,
            somniaPrice: pendingHero.somniaPrice,
            classId: uint8((seed % 4) + 1),
            rarity: _rarity(seed),
            bravery: uint8(((seed >> 16) % 100) + 1),
            greed: uint8(((seed >> 32) % 100) + 1),
            wisdom: uint8(((seed >> 48) % 100) + 1)
        });

        heroes[heroId] = hero;
        ownerHeroes[pendingHero.owner].push(heroId);

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

    function _rarity(uint256 seed) private pure returns (uint8) {
        uint256 roll = seed % 100;

        if (roll < 5) return 5;
        if (roll < 15) return 4;
        if (roll < 35) return 3;
        if (roll < 65) return 2;
        return 1;
    }

    receive() external payable {}
}
