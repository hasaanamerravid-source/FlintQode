export declare const REPOSITORY: string;
export declare const PAGES_ROOT: string;
export declare const UPDATE_MANIFEST_PATH: string;

export declare function expectedAssets(version: string): string[];
export declare function releaseAssetUrl(version: string, name: string): string;
export declare function normalizeDigest(value: unknown): string;
export declare function isSha256(value: string): boolean;
