// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library GateAdventureLib {
    uint256 internal constant MAX_ROUTE_LENGTH = 5;
    uint256 internal constant MAX_STORY_BYTES = 900;

    function rarity(uint256 seed) internal pure returns (uint8) {
        uint256 rarityRoll = seed % 100;

        if (rarityRoll < 5) return 5;
        if (rarityRoll < 15) return 4;
        if (rarityRoll < 35) return 3;
        if (rarityRoll < 65) return 2;
        return 1;
    }

    function roll(
        uint256 seed,
        uint256 heroId,
        uint256 gateRunNonce,
        uint16 floor,
        uint16 hp,
        uint256 carriedLoot
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(seed, heroId, gateRunNonce, floor, hp, carriedLoot))) % 100;
    }

    function damage(
        uint8 bravery,
        uint8 wisdom,
        uint8 heroRarity,
        uint16 floor,
        uint256 gateRoll
    ) internal pure returns (uint16) {
        uint16 pressure = uint16(16 + (uint256(floor) * 9) + (gateRoll % 16));
        uint16 defense = uint16(((uint16(bravery) + uint16(wisdom)) / 8) + (uint16(heroRarity) * 4));

        if (pressure <= defense + 3) return 3;
        return uint16(pressure - defense);
    }

    function loot(uint8 greed, uint8 heroRarity, uint16 floor) internal pure returns (uint256) {
        return (uint256(floor) * 5) + (uint256(heroRarity) * 3) + (uint256(greed) / 16);
    }

    function continuesDeeper(
        uint8 bravery,
        uint8 greed,
        uint8 wisdom,
        uint16 hp,
        uint256 gateRoll
    ) internal pure returns (bool) {
        if (greed > 68 && gateRoll > 32) return true;
        if (bravery > 58 && hp > 24) return true;
        if (wisdom > 72 && hp > 40) return true;
        return false;
    }

    function isContinueDecision(string memory decision) internal pure returns (bool) {
        return keccak256(bytes(decision)) == keccak256(bytes("CONTINUE"));
    }

    function floorName(uint16 floor) internal pure returns (string memory) {
        uint16 slot = ((floor - 1) % 5) + 1;
        if (slot == 1) return "Wolf Tunnel";
        if (slot == 2) return "Soulsucker Crypt";
        if (slot == 3) return "Bone Knight Bridge";
        if (slot == 4) return "Ash Warden Hall";
        return "Deep Gate Maw";
    }

    function normalizeRoute(string memory output) internal pure returns (string memory) {
        bytes memory source = bytes(output);
        bytes memory route = new bytes(MAX_ROUTE_LENGTH);
        uint256 start = routeStart(source);
        uint256 count;

        for (uint256 i = start; i < source.length && count < MAX_ROUTE_LENGTH; i++) {
            if (source[i] == 0x0a || source[i] == 0x0d) break;

            bytes1 char = source[i];
            if (char == bytes1("P") || char == bytes1("p")) {
                route[count] = bytes1("P");
                count++;
            } else if (char == bytes1("S") || char == bytes1("s")) {
                route[count] = bytes1("S");
                count++;
                break;
            }
        }

        if (count == 0) {
            route[0] = bytes1("S");
            count = 1;
        } else if (route[count - 1] != bytes1("S")) {
            route[count - 1] = bytes1("S");
        }

        return sliceBytes(route, count);
    }

    function extractStory(string memory output) internal pure returns (string memory) {
        bytes memory source = bytes(output);
        bytes memory story = new bytes(MAX_STORY_BYTES);
        uint256 start = storyStart(source);
        uint256 count;

        for (uint256 i = start; i < source.length && count < MAX_STORY_BYTES; i++) {
            story[count] = source[i];
            count++;
        }

        return sliceBytes(story, count);
    }

    function routeStart(bytes memory source) private pure returns (uint256) {
        return markerEnd(source, bytes("ROUTE="));
    }

    function storyStart(bytes memory source) private pure returns (uint256) {
        return markerEnd(source, bytes("STORY="));
    }

    function markerEnd(bytes memory source, bytes memory marker) private pure returns (uint256) {
        if (source.length < marker.length) return 0;

        for (uint256 i = 0; i <= source.length - marker.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < marker.length; j++) {
                if (source[i + j] != marker[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return i + marker.length;
        }

        return 0;
    }

    function sliceBytes(bytes memory source, uint256 length) private pure returns (string memory) {
        bytes memory sliced = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            sliced[i] = source[i];
        }
        return string(sliced);
    }
}
