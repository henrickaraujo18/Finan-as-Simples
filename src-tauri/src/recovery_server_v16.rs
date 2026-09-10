use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};

use uuid::Uuid;

const PORT: u16 = 37642;
const SUPABASE_URL: &str = "https://jozjcqskvkwxoaqmthrj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_pIcoV3Oq9FZSzVvTXQy8GQ_5Zf9SXq8";

pub(crate) fn redirect_url() -> String {
    format!("http://localhost:{PORT}/recovery")
}

fn send(mut stream: TcpStream, status: &str, content_type: &str, body: &[u8], extra_headers: &[(&str, String)]) {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store, max-age=0\r\nPragma: no-cache\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in extra_headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn recovery_html() -> (String, String) {
    let nonce = Uuid::new_v4().simple().to_string();
    let html = format!(r#"<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redefinir senha — Finança Simples</title>
<style nonce="{nonce}">body{{margin:0;background:#07100d;color:#edf8f4;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center}}.card{{width:min(430px,calc(100vw - 32px));background:#0b1713;border:1px solid #1d352c;border-radius:18px;padding:28px;box-sizing:border-box}}.mark{{width:54px;height:54px;border-radius:16px;display:grid;place-items:center;background:#39d6a6;color:#041a13;font-weight:900;margin-bottom:18px}}h1{{font-size:22px;margin:0 0 8px}}p{{color:#9bb4aa;line-height:1.5}}label{{display:grid;gap:7px;margin:16px 0;color:#b3c8c0;font-size:12px;font-weight:700}}input{{width:100%;box-sizing:border-box;padding:11px;border-radius:9px;border:1px solid #29453a;background:#08120f;color:#edf8f4}}button{{width:100%;padding:11px;border:0;border-radius:9px;background:#39d6a6;color:#041a13;font-weight:900;cursor:pointer}}button:disabled{{opacity:.5}}.msg{{min-height:20px;margin-top:14px;font-size:12px;color:#70dfb9}}.error{{color:#ef9999}}</style></head>
<body><main class="card"><div class="mark">FS</div><h1>Definir nova senha</h1><p>Esta página foi aberta localmente pelo Finança Simples. A nova senha é enviada diretamente ao serviço de autenticação.</p><form id="form"><label>Nova senha<input id="password" type="password" minlength="10" required autocomplete="new-password"></label><label>Confirmar senha<input id="confirm" type="password" minlength="10" required autocomplete="new-password"></label><button>Salvar nova senha</button><div id="msg" class="msg"></div></form></main>
<script nonce="{nonce}">const U={url:?};</script></body></html>"#);
    // Avoid interpolating credentials through HTML formatting syntax. The marker is replaced below.
    let script = format!(r#"const SUPABASE_URL={url:?};const API_KEY={key:?};const params=new URLSearchParams(location.hash.replace(/^#/,''));const accessToken=params.get('access_token');const type=params.get('type');const msg=document.getElementById('msg');const form=document.getElementById('form');const set=(text,error=false)=>{{msg.textContent=text;msg.className='msg'+(error?' error':'')}};if(!accessToken){{set('Este link não contém uma sessão válida. Solicite um novo e-mail no Finança Simples.',true);form.querySelectorAll('input,button').forEach(el=>el.disabled=true)}}else{{set(type==='invite'?'Convite validado. Defina sua senha para concluir o acesso.':'Link validado. Defina sua nova senha.')}}form.addEventListener('submit',async(ev)=>{{ev.preventDefault();if(!accessToken)return;const p=document.getElementById('password').value;const c=document.getElementById('confirm').value;if(p!==c)return set('As senhas não coincidem.',true);if(p.length<10)return set('Use pelo menos 10 caracteres.',true);set('Atualizando...');try{{const r=await fetch(SUPABASE_URL+'/auth/v1/user',{{method:'PUT',headers:{{apikey:API_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'}},body:JSON.stringify({{password:p}})}});const body=await r.json().catch(()=>({{}}));if(!r.ok)throw new Error(body.msg||body.message||body.error_description||'Não foi possível redefinir a senha.');history.replaceState(null,'',location.pathname);set('Senha alterada com sucesso. Volte ao Finança Simples e entre com a nova senha.');form.querySelectorAll('input,button').forEach(el=>el.disabled=true)}}catch(error){{set(error.message||'Não foi possível redefinir a senha.',true)}}}});"#, url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY);
    let html = html.replace("const U={url:?};", &script);
    (html, nonce)
}

fn handle(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    let mut buffer = [0u8; 8192];
    let size = match stream.read(&mut buffer) {
        Ok(size) if size > 0 => size,
        _ => return,
    };
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.lines();
    let request_line = lines.next().unwrap_or_default();
    let host_ok = request
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("host:"))
        .map(|line| {
            let host = line.split_once(':').map(|(_, value)| value.trim()).unwrap_or_default();
            host.eq_ignore_ascii_case(&format!("localhost:{PORT}"))
                || host.eq_ignore_ascii_case(&format!("127.0.0.1:{PORT}"))
        })
        .unwrap_or(false);
    if !host_ok {
        send(stream, "403 Forbidden", "text/plain; charset=utf-8", b"Forbidden", &[]);
        return;
    }
    if request_line.starts_with("GET /health ") {
        send(stream, "200 OK", "text/plain; charset=utf-8", b"ok", &[]);
        return;
    }
    if !request_line.starts_with("GET /recovery") {
        send(stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found", &[]);
        return;
    }
    let (html, nonce) = recovery_html();
    let csp = format!("default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; connect-src {SUPABASE_URL}; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    send(stream, "200 OK", "text/html; charset=utf-8", html.as_bytes(), &[("Content-Security-Policy", csp)]);
}

pub(crate) fn start() -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", PORT))
        .map_err(|error| format!("callback local de recuperação indisponível: {error}"))?;
    thread::Builder::new()
        .name("financa-recovery-loopback".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => handle(stream),
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| format!("não foi possível iniciar callback de recuperação: {error}"))?;
    Ok(())
}
