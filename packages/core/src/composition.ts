/** Backend-neutral compositor scene vocabulary. */

export type CompositionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelSurface = {
  /** Premultiplied little-endian ARGB8888 (bytes are B, G, R, A). */
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision?: number;
};

/** Column-major 4×4 matrix, matching GLES and WebGL conventions. */
export type CompositionMatrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type CompositionTransform = {
  matrix: CompositionMatrix4;
  /** Local layer-space pivot. Defaults to the destination centre. */
  origin?: readonly [number, number, number?];
};

/**
 * Optional deformable geometry for Compiz-style folds, waves, and workspace
 * transitions. Positions are local xyz triples; texture coordinates are uv.
 */
export type CompositionMesh = {
  positions: readonly number[];
  textureCoordinates: readonly number[];
  indices?: readonly number[];
  topology?: "triangles" | "triangle-strip";
};

export type BackdropBlurEffect = {
  kind: "backdrop-blur";
  radius: number;
  saturation?: number;
  tint?: number;
};

export type DropShadowEffect = {
  kind: "drop-shadow";
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spread?: number;
  color: number;
};

export type ColorMatrixEffect = {
  kind: "color-matrix";
  /** Row-major 4×5 RGBA color matrix. */
  matrix: readonly number[];
};

/**
 * Renderer extension point. The compositor resolves `namespace/name` through
 * an explicitly registered effect implementation; applications never inject
 * backend shader source into the compositor.
 */
export type ExtensionEffect = {
  kind: "extension";
  namespace: string;
  name: string;
  parameters?: Readonly<Record<string, number | readonly number[]>>;
  inputs?: readonly ("source" | "backdrop")[];
  /** Damage expansion required by the effect kernel. */
  padding?: number;
};

export type CompositionEffect =
  | BackdropBlurEffect
  | DropShadowEffect
  | ColorMatrixEffect
  | ExtensionEffect;

export type CompositionLayer = {
  id: string;
  z: number;
  source: PixelSurface;
  sourceRect?: CompositionRect;
  destination: CompositionRect;
  clip?: CompositionRect;
  opacity?: number;
  cornerRadius?: number | readonly [number, number, number, number];
  blendMode?: "source-over" | "copy";
  sampling?: "nearest" | "linear";
  transform?: CompositionTransform;
  mesh?: CompositionMesh;
  /** Source-space damage. Omit when the whole source may have changed. */
  damage?: readonly CompositionRect[];
  effects?: readonly CompositionEffect[];
};

export type CompositionScene = {
  width: number;
  height: number;
  clearColor: number;
  layers: readonly CompositionLayer[];
};

export type CompositionCapabilities = {
  retainedLayers: boolean;
  projectiveTransforms: boolean;
  meshDeformation: boolean;
  extensionEffects: boolean;
  directScanout: boolean;
  backdropBlur: boolean;
  dropShadow: boolean;
  colorMatrix: boolean;
  roundedClip: boolean;
};

export function validateCompositionScene(scene: CompositionScene): void {
  if (!Number.isInteger(scene.width) || scene.width < 1) {
    throw new RangeError("Composition scene width must be a positive integer");
  }
  if (!Number.isInteger(scene.height) || scene.height < 1) {
    throw new RangeError("Composition scene height must be a positive integer");
  }
  const ids = new Set<string>();
  for (const layer of scene.layers) {
    if (!layer.id || ids.has(layer.id)) {
      throw new Error(`Composition layer id is missing or duplicated: ${layer.id}`);
    }
    ids.add(layer.id);
    if (
      layer.source.width < 1 ||
      layer.source.height < 1 ||
      layer.source.stride < layer.source.width * 4 ||
      layer.source.pixels.byteLength <
        layer.source.stride * layer.source.height
    ) {
      throw new RangeError(`Composition layer ${layer.id} has an invalid source`);
    }
    if (layer.destination.width <= 0 || layer.destination.height <= 0) {
      throw new RangeError(`Composition layer ${layer.id} has invalid bounds`);
    }
    if (layer.opacity != null && (layer.opacity < 0 || layer.opacity > 1)) {
      throw new RangeError(`Composition layer ${layer.id} opacity is outside 0..1`);
    }
    if (layer.transform && layer.transform.matrix.length !== 16) {
      throw new RangeError(`Composition layer ${layer.id} transform must be 4×4`);
    }
    if (layer.mesh) {
      if (
        layer.mesh.positions.length < 9 ||
        layer.mesh.positions.length % 3 !== 0 ||
        layer.mesh.textureCoordinates.length * 3 !==
          layer.mesh.positions.length * 2
      ) {
        throw new RangeError(`Composition layer ${layer.id} has invalid mesh geometry`);
      }
      const vertexCount = layer.mesh.positions.length / 3;
      if (layer.mesh.indices?.some((index) => index < 0 || index >= vertexCount)) {
        throw new RangeError(`Composition layer ${layer.id} mesh index is out of range`);
      }
    }
    for (const effect of layer.effects ?? []) {
      if (effect.kind === "backdrop-blur" && effect.radius < 0) {
        throw new RangeError(`Composition layer ${layer.id} has negative blur`);
      }
      if (effect.kind === "drop-shadow" && effect.blurRadius < 0) {
        throw new RangeError(`Composition layer ${layer.id} has negative shadow blur`);
      }
      if (effect.kind === "color-matrix" && effect.matrix.length !== 20) {
        throw new RangeError(`Composition layer ${layer.id} color matrix must be 4×5`);
      }
      if (
        effect.kind === "extension" &&
        (!effect.namespace || !effect.name || (effect.padding ?? 0) < 0)
      ) {
        throw new RangeError(`Composition layer ${layer.id} has invalid extension effect`);
      }
    }
  }
}

/** Stable z ordering without mutating application-owned arrays. */
export function orderedCompositionLayers(
  scene: CompositionScene,
): CompositionLayer[] {
  return scene.layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z - b.layer.z || a.index - b.index)
    .map(({ layer }) => layer);
}
