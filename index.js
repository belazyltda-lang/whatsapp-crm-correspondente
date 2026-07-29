const express = require('express');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
let qrData = '';
let status = 'Iniciando...';

// Logger ATIVO para ver tudo no Render/Railway
const mkLogger = (prefix) => ({
  level: 'debug',
  trace: (o, m) => console.log(prefix, '[T]', m || o),
  debug: (o, m) => console.log(prefix, '[D]', m || o),
  info:  (o, m) => console.log(prefix, '[I]', m || o),
  warn:  (o, m) => console.log(prefix, '[W]', m || o),
  error: (o, m) => console.log(prefix, '[E]', m || o),
  fatal: (o, m) => console.log(prefix, '[F]', m || o),
  isLevelEnabled: () => true,
  child: (opts) => mkLogger(prefix + '>' + (opts.module || ''))
});

app.get('/', async (req, res) => {
  if (!qrData) return res.send(`<h2>⏳ ${status}</h2><meta http-equiv="refresh" content="3">`);
  try {
    const img = await QRCode.toDataURL(qrData);
    res.send(`<html><body style="text-align:center;padding:30px"><h2>📱 Escaneie!</h2><img src="${img}" width="300"/><br><a href="/reset">🔄 Resetar</a></body></html>`);
  } catch (e) { res.send('Erro QR: ' + e.message); }
});

app.get('/reset', (req, res) => {
  qrData = ''; status = 'Resetando...';
  const d = path.join(__dirname, 'auth_info');
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  setTimeout(init, 1000);
  res.send('<h2>🔄 Resetando...</h2><meta http-equiv="refresh" content="5;url=/">');
});

async function init() {
  console.log('\n=== INICIANDO BOT ===');
  const authDir = path.join(__dirname, 'auth_info');
  if (fs.existsSync(authDir)) { fs.rmSync(authDir, { recursive: true, force: true }); }
  fs.mkdirSync(authDir, { recursive: true });
  console.log('Auth limpo. Conectando...');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    console.log('Estado carregado. Tem credenciais?', !!state.creds.me);

    const sock = makeWASocket({
      auth: state,
      logger: mkLogger('BAILEYS'),
      printQRInTerminal: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
      const info = {
        conn: u.connection,
        hasQR: !!u.qr,
        isNew: u.isNewLogin,
        statusCode: u.lastDisconnect?.error?.output?.statusCode,
        errMsg: u.lastDisconnect?.error?.message
      };
      console.log('>>> CONNECTION UPDATE:', JSON.stringify(info));

      if (u.qr) {
        console.log('✅✅✅ QR CODE GERADO! Acesse a URL principal para ver!');
        qrData = u.qr;
        status = 'QR gerado!';
      }
      if (u.connection === 'open') {
        console.log('✅ CONECTADO!');
        status = 'Conectado!';
      }
      if (u.connection === 'close') {
        console.log('❌ FECHOU. Código:', info.statusCode, 'Erro:', info.errMsg);
        qrData = '';
        status = 'Reconectando...';
        setTimeout(init, 5000);
      }
    });

  } catch (err) {
    console.error('=== ERRO FATAL ===');
    console.error(err.message);
    console.error(err.stack);
    status = 'ERRO: ' + err.message;
    setTimeout(init, 10000);
  }
}

app.listen(PORT, () => {
  console.log('Servidor na porta', PORT);
  init();
});
