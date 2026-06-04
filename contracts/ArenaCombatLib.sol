// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library ArenaCombatLib {
    function power(
        uint8 rarity,
        uint8 bravery,
        uint8 greed,
        uint8 wisdom,
        uint256 weaponCount
    ) internal pure returns (uint16) {
        uint256 cappedWeapons = weaponCount > 10 ? 10 : weaponCount;
        uint256 score = 30 + (uint256(rarity) * 28) + (uint256(bravery) * 2) + uint256(wisdom) + (uint256(greed) / 2)
            + (cappedWeapons * 18);

        if (score > type(uint16).max) return type(uint16).max;
        return uint16(score);
    }

    function winnerIsFirst(
        uint256 roomId,
        uint256 firstSeed,
        uint256 secondSeed,
        uint16 firstPower,
        uint16 secondPower,
        bytes32 previousBlockHash
    ) internal view returns (bool) {
        uint256 totalPower = uint256(firstPower) + uint256(secondPower);
        uint256 roll = uint256(
            keccak256(abi.encodePacked(roomId, firstSeed, secondSeed, firstPower, secondPower, previousBlockHash, block.timestamp))
        ) % totalPower;

        return roll < firstPower;
    }
}
