use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const FIRST_UPDATE_CHECK_DELAY: Duration = Duration::from_secs(20);
const UPDATE_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

async fn check_and_install_update(
    app: &AppHandle,
    endpoint: &str,
    public_key: &str,
) -> Result<(), String> {
    let endpoint = endpoint
        .parse::<url::Url>()
        .map_err(|error| format!("endereco de atualizacao invalido: {error}"))?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .pubkey(public_key)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;

    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    app.restart();
}

fn start_automatic_updates(app: AppHandle) {
    let endpoint = option_env!("FINANCA_SIMPLES_UPDATE_ENDPOINT")
        .unwrap_or_default()
        .trim()
        .to_owned();
    let public_key = option_env!("TAURI_UPDATER_PUBKEY")
        .unwrap_or_default()
        .trim()
        .to_owned();

    if endpoint.is_empty() || public_key.is_empty() {
        eprintln!("Atualizacao automatica desativada: canal de distribuicao nao configurado.");
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_UPDATE_CHECK_DELAY).await;

        loop {
            if let Err(error) = check_and_install_update(&app, &endpoint, &public_key).await {
                eprintln!("Nao foi possivel verificar atualizacoes: {error}");
            }
            tokio::time::sleep(UPDATE_CHECK_INTERVAL).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            start_automatic_updates(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Financa Simples");
}
