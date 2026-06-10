// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface RequestHeroVm {
    function envAddress(string calldata key) external returns (address value);
    function envString(string calldata key) external returns (string memory value);
    function envUint(string calldata key) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IGatesOfSogentMarketGame {
    function requestHero(string calldata name) external payable returns (uint256 groupId);
    function requiredTotalFee() external view returns (uint256);
}

contract RequestHero {
    RequestHeroVm private constant vm = RequestHeroVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (uint256 groupId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address gameAddress = vm.envAddress("GAME_ADDRESS");
        string memory heroName = vm.envString("HERO_NAME");

        IGatesOfSogentMarketGame game = IGatesOfSogentMarketGame(gameAddress);
        uint256 fee = game.requiredTotalFee();

        vm.startBroadcast(privateKey);
        groupId = game.requestHero{value: fee}(heroName);
        vm.stopBroadcast();
    }
}
