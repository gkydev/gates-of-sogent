import {
  CLASS_DEFS,
  WORLD_ASSET,
  ARENA_ASSET,
  FIGHT_CLOUD_ASSET,
  CAMPFIRE_ASSET,
  CAMPFIRE_NPC_ASSETS,
  PLAYER_SHEET_ASSET,
  NPC_SHEET_ASSET,
  PLAYER_SHEET_COLS,
  PLAYER_SHEET_ROWS,
  PLAYER_DIRECTIONS,
  NPC_SHEET_IDS,
  STANDALONE_NPC_ASSETS,
} from "./config.js?v=20260610-portrait1";
import { normalizeError } from "./utils.js?v=20260610-portrait1";

export async function loadTextures({ addEvent } = {}) {
    const result = {
      world: await window.PIXI.Assets.load(WORLD_ASSET),
      arena: null,
      fightCloud: null,
      campfire: null,
      campfireNpcs: {},
      playerFrames: null,
      npcs: {},
    };

    try {
      result.arena = await window.PIXI.Assets.load(ARENA_ASSET);
      result.arena.source.scaleMode = "nearest";
    } catch (error) {
      addEvent?.("danger", `Arena asset failed to load: ${normalizeError(error)}`);
    }

    try {
      result.fightCloud = await window.PIXI.Assets.load(FIGHT_CLOUD_ASSET);
      result.fightCloud.source.scaleMode = "nearest";
    } catch (error) {
      addEvent?.("danger", `Fight cloud failed to load: ${normalizeError(error)}`);
    }

    try {
      result.campfire = await window.PIXI.Assets.load(CAMPFIRE_ASSET);
      result.campfire.source.scaleMode = "nearest";
    } catch (error) {
      addEvent?.("danger", `Campfire asset failed to load: ${normalizeError(error)}`);
    }

    await Promise.all(
      Object.entries(CAMPFIRE_NPC_ASSETS).map(async ([id, asset]) => {
        try {
          const texture = await window.PIXI.Assets.load(asset);
          texture.source.scaleMode = "nearest";
          result.campfireNpcs[id] = texture;
        } catch (error) {
          addEvent?.("danger", `${id} campfire sprite failed to load: ${normalizeError(error)}`);
        }
      }),
    );

    try {
      result.playerFrames = await createPlayerAnimationFrames(PLAYER_SHEET_ASSET);
    } catch (error) {
      addEvent?.("danger", `Player sprite sheet failed to load: ${normalizeError(error)}`);
    }

    try {
      result.npcs = await createNpcTextures(NPC_SHEET_ASSET);
    } catch (error) {
      addEvent?.("danger", `NPC sprite sheet failed to load: ${normalizeError(error)}`);
    }

    await loadStandaloneNpcTextures(result.npcs, { addEvent });

    for (const heroClass of CLASS_DEFS) {
      result[heroClass.id] = await window.PIXI.Assets.load(heroClass.asset);
    }
    return result;
  }

  async function createPlayerAnimationFrames(src) {
    const image = await loadImage(src);
    const frameWidth = Math.floor(image.width / PLAYER_SHEET_COLS);
    const frameHeight = Math.floor(image.height / PLAYER_SHEET_ROWS);
    const prepared = {};
    const frames = {};
    let maxWidth = 1;
    let maxHeight = 1;

    PLAYER_DIRECTIONS.forEach((direction, row) => {
      prepared[direction] = [];
      for (let col = 0; col < PLAYER_SHEET_COLS; col += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = frameWidth;
        canvas.height = frameHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, col * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
        removeGreenScreen(canvas);
        keepLargestAlphaComponent(canvas);
        const cropped = cropAlphaCanvas(canvas, 6);
        maxWidth = Math.max(maxWidth, cropped.width);
        maxHeight = Math.max(maxHeight, cropped.height);
        prepared[direction].push(cropped);
      }
    });

    const normalizedWidth = maxWidth + 18;
    const normalizedHeight = maxHeight + 10;

    PLAYER_DIRECTIONS.forEach((direction) => {
      frames[direction] = prepared[direction].map((canvas) => {
        const normalized = normalizeSpriteFrame(canvas, normalizedWidth, normalizedHeight);
        const texture = window.PIXI.Texture.from(normalized);
        texture.source.scaleMode = "nearest";
        return texture;
      });
    });

    return frames;
  }

  async function createNpcTextures(src) {
    const image = await loadImage(src);
    const frameWidth = Math.floor(image.width / NPC_SHEET_IDS.length);
    const frameHeight = image.height;
    const npcs = {};

    NPC_SHEET_IDS.forEach((id, col) => {
      const canvas = document.createElement("canvas");
      canvas.width = frameWidth;
      canvas.height = frameHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, col * frameWidth, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
      removeGreenScreen(canvas);
      const texture = window.PIXI.Texture.from(cropAlphaCanvas(canvas, 8));
      texture.source.scaleMode = "nearest";
      npcs[id] = texture;
    });

    return npcs;
  }

  async function loadStandaloneNpcTextures(npcs, { addEvent } = {}) {
    await Promise.all(
      Object.entries(STANDALONE_NPC_ASSETS).map(async ([id, asset]) => {
        try {
          const texture = await window.PIXI.Assets.load(asset);
          texture.source.scaleMode = "nearest";
          npcs[id] = texture;
        } catch (error) {
          addEvent?.("danger", `${id} sprite failed to load: ${normalizeError(error)}`);
        }
      }),
    );
  }

  function normalizeSpriteFrame(canvas, width, height) {
    const normalized = document.createElement("canvas");
    normalized.width = width;
    normalized.height = height;
    const ctx = normalized.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const x = Math.round((width - canvas.width) / 2);
    const y = height - canvas.height;
    ctx.drawImage(canvas, x, y);
    return normalized;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${src}`));
      image.src = src;
    });
  }

  function removeGreenScreen(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const strongestNonGreen = Math.max(red, blue);
      const greenLead = green - strongestNonGreen;
      const isBrightKey = green > 115 && greenLead > 34 && green > red * 1.35 && green > blue * 1.24;
      const isDarkKeyEdge = green > 32 && greenLead > 20 && red < 72 && blue < 82;
      const isKeyGreen = isBrightKey || isDarkKeyEdge;

      if (isKeyGreen) {
        pixels[i + 3] = 0;
      } else if (greenLead > 8 && green > 80) {
        pixels[i + 1] = Math.max(green - Math.min(24, greenLead), strongestNonGreen);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function keepLargestAlphaComponent(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    const visited = new Uint8Array(width * height);
    let largest = [];

    for (let start = 0; start < visited.length; start += 1) {
      if (visited[start] || !isVisibleSpritePixel(pixels, start)) continue;

      const component = [];
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const index = stack.pop();
        component.push(index);

        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1,
        ];

        neighbors.forEach((neighbor) => {
          if (neighbor < 0 || visited[neighbor] || !isVisibleSpritePixel(pixels, neighbor)) return;
          visited[neighbor] = 1;
          stack.push(neighbor);
        });
      }

      if (component.length > largest.length) {
        largest = component;
      }
    }

    if (!largest.length) return;

    const keep = new Uint8Array(width * height);
    largest.forEach((index) => {
      keep[index] = 1;
    });

    for (let index = 0; index < keep.length; index += 1) {
      if (!keep[index] && isVisibleSpritePixel(pixels, index)) {
        pixels[index * 4 + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function isVisibleSpritePixel(pixels, index) {
    const offset = index * 4;
    const alpha = pixels[offset + 3];
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    return alpha > 32 && !isGreenKeyResidue(red, green, blue);
  }

  function cropAlphaCanvas(canvas, padding = 0) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const alpha = pixels[(y * canvas.width + x) * 4 + 3];
        const red = pixels[(y * canvas.width + x) * 4];
        const green = pixels[(y * canvas.width + x) * 4 + 1];
        const blue = pixels[(y * canvas.width + x) * 4 + 2];
        if (alpha <= 32 || isGreenKeyResidue(red, green, blue)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (minX > maxX || minY > maxY) return canvas;

    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width - 1, maxX + padding);
    maxY = Math.min(canvas.height - 1, maxY + padding);

    const cropped = document.createElement("canvas");
    cropped.width = maxX - minX + 1;
    cropped.height = maxY - minY + 1;
    const croppedCtx = cropped.getContext("2d");
    croppedCtx.imageSmoothingEnabled = false;
    croppedCtx.drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return cropped;
  }

  function isGreenKeyResidue(red, green, blue) {
    const strongestNonGreen = Math.max(red, blue);
    return green > 32 && green - strongestNonGreen > 18 && green > red * 1.18 && green > blue * 1.12;
  }
