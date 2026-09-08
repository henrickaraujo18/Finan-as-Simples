# Finança Simples para Windows

Aplicativo Tauri 2 que abre a versão privada e sempre atualizada do Finança Simples. O banco de dados, o Open Finance, as cotações e os recursos de IA continuam no backend hospedado; por isso, evoluções nessas áreas chegam ao aplicativo sem reinstalação.

O invólucro Windows também possui um atualizador nativo. Ele verifica um lançamento assinado 20 segundos após abrir e novamente a cada seis horas. Quando encontra uma versão superior, baixa, valida a assinatura, instala e reinicia o aplicativo.

## Desenvolvimento

Pré-requisitos no Windows:

- Node.js 22 ou superior
- Rust estável
- Microsoft C++ Build Tools
- WebView2 Runtime

```powershell
npm install
npm run dev
```

## Primeiro canal de atualização

1. Crie a chave do atualizador e mantenha a chave privada fora do repositório:

```powershell
npm install
npm run signer:generate -- --write-keys "$env:USERPROFILE\.tauri\financa-simples.key"
```

2. Mantenha este repositório público para que o aplicativo consiga consultar `latest.json` sem armazenar credenciais do GitHub no computador. O código financeiro e o banco continuam privados no Sites.

3. Cadastre no repositório de distribuição:

- `TAURI_SIGNING_PRIVATE_KEY`: conteúdo da chave privada.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: senha da chave.
- `TAURI_UPDATER_PUBLIC_KEY`: conteúdo da chave pública.

4. Crie uma tag `desktop-v1.0.0`. O fluxo de publicação gera o instalador `.exe`, o `.msi`, os pacotes assinados e `latest.json`.

Nunca coloque credenciais bancárias, Pluggy, IA ou a chave privada no código. O executável contém somente a chave pública necessária para validar atualizações.
