# Canal de atualização automática

Antes da primeira publicação com auto-update, gerar uma chave Tauri permanente em um computador administrativo e guardar a chave privada fora do repositório.

No GitHub, configurar em **Settings → Secrets and variables → Actions**:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (se usada)
- `TAURI_UPDATER_PUBLIC_KEY`

Depois, executar o workflow `Gerar instalador Windows` em `main`.

O workflow só publica `latest.json` quando as chaves estão presentes e o Tauri gerou um `.sig`. O aplicativo usa esse manifesto e rejeita pacotes cuja assinatura não corresponda à chave pública incorporada na compilação.

A chave privada nunca deve ser enviada para o aplicativo, Supabase, banco local ou código-fonte.
