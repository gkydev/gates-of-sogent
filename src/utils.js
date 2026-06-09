import { CLASS_DEFS, FNV_OFFSET, FNV_PRIME, HERO_PORTRAITS, MASK_64 } from "./config.js?v=20260609-demo-fight2";

export function getClass(classId) {
    return CLASS_DEFS.find((item) => item.id === classId) || CLASS_DEFS[0];
  }

export function getHeroPortrait(hero) {
    const fallback = HERO_PORTRAITS[0];
    if (!hero) return fallback;
    const id = hero.portraitId || portraitIdFromSeed(hero.seed);
    return HERO_PORTRAITS.find((item) => item.id === id) || fallback;
  }

export function portraitIdFromSeed(seed) {
    const normalizedSeed = typeof seed === "bigint" ? seed : BigInt(seed || 0);
    return Number((normalizedSeed >> 8n) % BigInt(HERO_PORTRAITS.length)) + 1;
  }

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

export function formatTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

export function formatUsd(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  }

export function shortAddress(address) {
    if (!address || address.length < 12) return address || "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

export function normalizeError(error) {
    const message = error?.shortMessage || error?.reason || error?.message || "Unknown wallet error";
    if (message.includes("user rejected")) return "Wallet request rejected.";
    if (message.includes("No injected wallet")) return message;
    return message.length > 160 ? `${message.slice(0, 157)}...` : message;
  }

export function fromContractPrice(value) {
    return Number(value || 0n) / 100000000;
  }

export function toContractInt(value) {
    return BigInt(Math.round(value * 100000000));
  }

export function hash64(input) {
    let hash = FNV_OFFSET;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = (hash * FNV_PRIME) & MASK_64;
    }
    return hash;
  }

export function rarityFromSeed(seed) {
    const roll = Number(seed % 100n);
    if (roll < 5) return 5;
    if (roll < 15) return 4;
    if (roll < 35) return 3;
    if (roll < 65) return 2;
    return 1;
  }

export function traitFromSeed(seed, shift) {
    return Number((seed >> BigInt(shift)) % 100n) + 1;
  }

export function randomWalk(value, volatility) {
    const drift = (Math.random() * 2 - 1) * volatility;
    return Math.max(0.0001, value * (1 + drift));
  }
