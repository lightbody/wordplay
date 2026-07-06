// The wordlist's single canonical copy now lives in `shared/assets/enable.txt`
// (shared with the TypeScript port). `dictionary.rs` still does
// `include_str!("../../assets/enable.txt")` unchanged, so mirror the
// canonical file into `backend/assets/enable.txt` at build time whenever
// it's missing or stale, rather than restructuring the Docker build (see
// backend/Dockerfile's `COPY assets ./assets` step) or committing two copies.

use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let src = Path::new(manifest_dir).join("../shared/assets/enable.txt");
    let dest = Path::new(manifest_dir).join("assets/enable.txt");

    println!("cargo:rerun-if-changed={}", src.display());

    if !src.exists() {
        // Nothing to mirror from (e.g. a build context that only has
        // backend/, such as the Docker image). If assets/enable.txt was
        // already provided some other way, leave it alone.
        return;
    }

    let needs_copy = match (fs::metadata(&src), fs::metadata(&dest)) {
        (Ok(src_meta), Ok(dest_meta)) => {
            let src_modified = src_meta.modified().ok();
            let dest_modified = dest_meta.modified().ok();
            src_modified > dest_modified
        }
        _ => true,
    };

    if needs_copy {
        fs::create_dir_all(dest.parent().unwrap()).expect("create backend/assets");
        fs::copy(&src, &dest).expect("copy shared/assets/enable.txt into backend/assets/enable.txt");
    }
}
