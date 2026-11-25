export interface UpdateManifestAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface UpdateManifest {
  version: string;
  tag: string;
  assets: UpdateManifestAsset[];
}

export declare function readVersion(): string;
export declare function buildManifest(
  release: { assets?: Array<{ name?: string; digest?: unknown }> } | null,
  version: string,
): UpdateManifest;
export declare function manifestIssues(manifest: unknown, version: string): string[];
