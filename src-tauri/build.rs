fn main() {
    println!("cargo:rerun-if-env-changed=FINANCA_UPDATER_PUBLIC_KEY");
    tauri_build::build()
}
