fn main() {
    // Expose the build number and commit hash recorded by
    // scripts/sync-version.mjs to the Rust code (the About dialog reads them
    // through the `app_info` command).
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let build = std::fs::read_to_string(root.join("BUILD"))
        .unwrap_or_else(|_| "0".to_string())
        .trim()
        .to_string();
    let commit = std::fs::read_to_string(root.join("BUILD_SHA"))
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string();
    println!("cargo:rustc-env=FLINTQODE_BUILD={build}");
    println!("cargo:rustc-env=FLINTQODE_COMMIT={commit}");
    println!("cargo:rerun-if-changed=../BUILD");
    println!("cargo:rerun-if-changed=../BUILD_SHA");
    tauri_build::build()
}
