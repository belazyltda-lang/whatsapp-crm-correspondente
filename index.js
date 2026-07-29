/**
 * ROBÔ DE WHATSAPP - CORRESPONDENTE BANCÁRIO (RECEITA DE BANCO)
 * Versão 100% Estável (Com Interface Pino Completa para Evitar 502 no Render)
 */

const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyiAvghPgf9ONIyxWDG2WVVCU1Zpuy7MFtwJQxXakdVlHdpE7PH0IvnzefGzjZlwT40/exec";

let currentQRCodeData = "";
let isConnected = false;
let sock = null;

const sessions = {};
const BANCOS_LISTA = ["Itaú", "Caixa Econômica", "Bradesco", "Santander", "Banco do Brasil"];

app.use(express.json());

// Logger seguro compativel com Pino sem travar o terminal
const dummyFn = () => {};
const mockLogger = {
  level: 'silent',
  trace: dummyFn, debug: dummyFn, info: dummyFn, warn: dummyFn, error: dummyFn, fatal: dummyFn,
  isLevelEnabled: () => false,
  child: () => mockLogger
};

// ⏰ SELF-PING INTERNO (A cada 4 minutos)
setInterval(async () => {
  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || "https://whatsapp-crm-correspondente.onrender.com";
    await axios.get(renderUrl);
  } catch (err) {}
}, 4 * 60 * 1000);

// 🔄 ROTA DE LOGOUT / RESET DE SESSÃO
app.get('/logout', async (req, res) => {
  try {
    isConnected = false; 
    currentQRCodeData = "";
    if (sock) { try { sock.logout(); sock.end(); } catch(e){} }
    const authFolder = path.join(__dirname, 'auth_info');
    if (fs.existsSync(authFolder)) {
      try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e){}
    }
    setTimeout(startWhatsAppBot, 1500);
    res.send(`<!DOCTYPE html><html><head><title>Resetando...</title><meta http-equiv="refresh" content="4;url=/"></head><body style="font-family:Arial;text-align:center;padding:50px;"><h2>🔄 Sessão resetada! Gerando novo QR Code em 5 segundos...</h2></body></html>`);
  } catch (err) { res.send("Erro reset: " + err.message); }
});

// 🔔 NOTIFICAÇÃO DE APROVAÇÃO (Disparado pela Planilha)
app.post('/notificar-aprovacao', async (req, res) => {
  try {
    const { idProposta, nomeCliente, cpf, telefoneCliente, whatsappImobiliaria } = req.body;
    console.log(`🔔 Webhook notificar-aprovacao: ${idProposta} - ${nomeCliente}`);

    if (!sock || !isConnected) return res.status(503).json({ status: "error", message: "WhatsApp offline" });

    if (whatsappImobiliaria) {
      const imobJid = whatsappImobiliaria.includes('@') ? whatsappImobiliaria : `${whatsappImobiliaria.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(imobJid, { text: `🎉 *Ótima notícia!* O cliente *${idProposta} - ${nomeCliente} (CPF: ${cpf})* está *APROVADO*!` }).catch(e => console.error("Erro envio imob:", e));
    }

    await new Promise(r => setTimeout(r, 1500));

    if (telefoneCliente) {
      const clientJid = `${telefoneCliente.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(clientJid, { text: `🎉 *Pode comemorar!* Sua proposta está *APROVADA*! Agora aguarde os próximos passos, eu vou te informando por aqui.\n\n_(⚠️ Nenhuma resposta é necessária, o Robô não responderá nesta conversa)_` }).catch(e => console.error("Erro envio cliente:", e));
    }

    return res.json({ status: "success" });
  } catch (error) { return res.status(500).json({ status: "error", message: error.toString() }); }
});

app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`<!DOCTYPE html><html><head><title>Bot Conectado</title><meta charset="utf-8"><style>body{font-family:Arial;text-align:center;padding:50px;background:#eef2f5;}.card{background:white;padding:30px;border-radius:12px;display:inline-block;box-shadow:0 4px 12px rgba(0,0,0,0.1);}.status{color:#2e7d32;font-weight:bold;font-size:24px;}.btn{display:inline-block;margin-top:20px;padding:10px 20px;background:#d32f2f;color:white;text-decoration:none;border-radius:6px;font-weight:bold;}</style></head><body><div class="card"><h1>🤖 Robô WhatsApp Correspondente</h1><p class="status">✅ STATUS: CONECTADO E RODANDO 24/7!</p><p>O robô está ativo e pronto para receber propostas.</p><a href="/logout" class="btn">🔄 Resetar Sessão / Novo QR Code</a></div></body></html>`);
  }
  if (!currentQRCodeData) {
    return res.send(`<!DOCTYPE html><html><head><title>Carregando...</title><meta http-equiv="refresh" content="3"></head><body style="font-family:Arial;text-align:center;padding:50px;"><h2>⏳ Gerando QR Code...</h2><p>Se demorar mais de 10s, <a href="/logout">clique aqui para resetar</a>.</p></body></html>`);
  }
  try {
    const qrImage = await QRCode.toDataURL(currentQRCodeData);
    res.send(`<!DOCTYPE html><html><head><title>Conectar Bot</title><meta charset="utf-8"><meta http-equiv="refresh" content="12"><style>body{font-family:Arial;text-align:center;padding:30px;background:#f4f6f8;}.card{background:white;padding:30px;border-radius:16px;display:inline-block;}img{margin:20px 0;border:4px solid #128c7e;border-radius:12px;}</style></head><body><div class="card"><h2>📱 Conectar Robô ao WhatsApp</h2><img src="${qrImage}" width="280" /><br/><a href="/logout" style="color:#d32f2f;font-weight:bold;text-decoration:none;">🔄 Gerar outro QR Code</a></div></body></html>`);
  } catch (err) { res.status(500).send("Erro QR Code"); }
});

async function verificarNomeImobiliaria(nome) {
  try {
    const resp = await axios.get(`${GOOGLE_WEBHOOK_URL}?action=verifyName&name=${encodeURIComponent(nome)}`);
    if (resp.data && resp.data.found) return { valido: true, imobiliaria: resp.data.imobiliaria, codigo: resp.data.codigo };
  } catch (err) {}
  return { valido: false };
}

async function cadastrarNovaImobiliaria(nome, telefone, bairro) {
  try {
    const resp = await axios.post(GOOGLE_WEBHOOK_URL, { action: "cadastrarImobiliaria", nome: nome, telefone: telefone, bairro: bairro });
    if (resp.data && (resp.data.imobiliaria || resp.data.nome)) return { nome: resp.data.imobiliaria || resp.data.nome, codigo: resp.data.codigo };
  } catch (err) {}
  return null;
}

function gerarTextoCopiaEdicao(s) {
  let txt = `Imobiliária: ${s.imobiliaria || ''}\nCliente 1: ${s.nomeCliente1 || ''}\nCPF 1: ${s.cpf1 || ''}\nTelefone 1: ${s.telefone1 || ''}\nBanco: ${s.banco || ''}\n`;
  if (s.temProp2) txt += `Cliente 2: ${s.nomeCliente2 || ''}\nCPF 2: ${s.cpf2 || ''}\nTelefone 2: ${s.telefone2 || ''}\n`;
  txt += `Compra/Venda: ${s.valorCompraVenda || ''}\nFinanciamento: ${s.valorFinanciamento || ''}\nEntrada: ${s.valorEntrada || ''}\nObservação: ${s.observacao || 'Nenhuma'}`;
  return txt;
}

async function enviarResumoConfirmacao(from, s) {
  let r = `📋 *RESUMO DA PROPOSTA PARA CONFIRMAÇÃO:*\n\n🏢 *Imobiliária:* ${s.imobiliaria}\n👤 *Proponente 1:* ${s.nomeCliente1}\n💳 *CPF Prop 1:* ${s.cpf1}\n📱 *Telefone Prop 1:* ${s.telefone1}\n🏦 *Banco Escolhido:* ${s.banco}\n`;
  if (s.temProp2) r += `👥 *Proponente 2:* ${s.nomeCliente2} (CPF: ${s.cpf2}, Tel: ${s.telefone2})\n`;
  r += `🏠 *Compra/Venda:* R$ ${s.valorCompraVenda}\n💰 *Financiamento:* R$ ${s.valorFinanciamento}\n💵 *Entrada:* R$ ${s.valorEntrada}\n📁 *Documentos:* ${s.documentos.length} arquivo(s)\n📝 *Observação:* ${s.observacao || 'Nenhuma'}\n\n---\n❓ *Deseja enviar a proposta ou precisa corrigir algum dado?*\n\n1️⃣ *CONFIRMAR E ENVIAR*\n2️⃣ *CORRIGIR ALGUNS DADOS*`;
  s.step = 'CONFIRMACAO_FINAL';
  await sock.sendMessage(from, { text: r }).catch(e => console.error("Erro enviarResumo:", e));
}

async function enviarDadoAtual(from, s) {
  switch (s.step) {
    case 'AGUARDANDO_NOME_PROP1': await sock.sendMessage(from, { text: `👤 Digite o *Nome Completo do Cliente (Proponente 1)*:` }).catch(e => console.error("Erro prop1:", e)); break;
    case 'AGUARDANDO_CPF_PROP1': await sock.sendMessage(from, { text: `💳 Digite o *CPF do Proponente 1*:` }).catch(e => console.error("Erro cpf1:", e)); break;
    case 'AGUARDANDO_TEL_PROP1': await sock.sendMessage(from, { text: `📱 Digite o *Telefone do Proponente 1*:` }).catch(e => console.error("Erro tel1:", e)); break;
    case 'AGUARDANDO_BANCO': await sock.sendMessage(from, { text: `🏦 Selecione a *Financeira / Banco desejado*:\n\n1️⃣ Itaú\n2️⃣ Caixa Econômica\n3️⃣ Bradesco\n4️⃣ Santander\n5️⃣ Banco do Brasil` }).catch(e => console.error("Erro banco:", e)); break;
    case 'AGUARDANDO_DOCS_PROP1': await sock.sendMessage(from, { text: `📷 Envie os *documentos* do Proponente 1 ou digite *PRONTO*:` }).catch(e => console.error("Erro docs1:", e)); break;
    case 'AGUARDANDO_COMPRA_VENDA': await sock.sendMessage(from, { text: `📌 Digite o *Valor de Compra e Venda* (ex: 500.000):` }).catch(e => console.error("Erro compra:", e)); break;
    case 'AGUARDANDO_FINANCIAMENTO': await sock.sendMessage(from, { text: `Digite o *Valor do Financiamento* (ex: 400.000):` }).catch(e => console.error("Erro financ:", e)); break;
    case 'AGUARDANDO_ENTRADA': await sock.sendMessage(from, { text: `Digite o *Valor da Entrada* (ex: 100.000):` }).catch(e => console.error("Erro entrada:", e)); break;
  }
}

async function startWhatsAppBot() {
  const authFolder = path.join(__dirname, 'auth_info');

  try {
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    console.log("🚀 Iniciando Baileys WhatsApp...");
    sock = makeWASocket({ 
      auth: state, 
      logger: mockLogger,
      printQRInTerminal: false, 
      browser: ['CRM-Correspondente', 'Chrome', '1.0.0'],
      syncFullHistory: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { 
        currentQRCodeData = qr; 
        isConnected = false; 
        console.log("✅ QR Code gerado com sucesso!");
      }
      if (connection === 'open') { 
        isConnected = true; 
        currentQRCodeData = ""; 
        console.log("✅ WHATSAPP CONECTADO E ATIVO!");
      }
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`⚠️ Conexão fechada (${statusCode}).`);

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403 || statusCode === 408 || statusCode === 428) {
          console.log("🔄 Sessão expirada/inválida. Limpando credenciais...");
          if (fs.existsSync(authFolder)) {
            try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e){}
          }
        }
        setTimeout(startWhatsAppBot, 3000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        if (!m.messages || m.messages.length === 0) return;
        const msg = m.messages[0];
        if (!msg || !msg.message) return;
        
        const from = msg.key.remoteJid;
        if (!from || from.endsWith('@g.us') || from === 'status@broadcast') return;

        const text = (
          msg.message.conversation || 
          msg.message.extendedTextMessage?.text || 
          msg.message.imageMessage?.caption || 
          msg.message.documentMessage?.caption || ""
        ).trim();

        console.log(`📩 Mensagem de ${from}: "${text}" (fromMe: ${msg.key.fromMe})`);

        if (msg.key.fromMe) return;

        const textLow = text.toLowerCase();
        let s = sessions[from];

        if (!s || ['reiniciar','menu','inicio','cancelar','sair','voltar'].includes(textLow)) {
          sessions[from] = { step: 'AGUARDANDO_NOME_IMOBILIARIA', documentos: [] };
          await sock.sendMessage(from, { text: "👋 *Olá! Bem-vindo ao Sistema de Cadastro de Propostas do Receita De Banco.*\n\nEnvie o nome da imobiliaria responsável pela proposta:\n_(caso não tenha cadastro digite *CADASTRO*)_" }).catch(e => console.error("Erro mensagem inicial:", e));
          return;
        }

        if (['corrigir','editar','alterar'].includes(textLow) && s.step !== 'CONFIRMACAO_FINAL' && s.step !== 'EDITANDO_BLOCO_TEXTO') {
          await sock.sendMessage(from, { text: "👍 *Fique tranquilo! Você poderá conferir e corrigir todos os dados ao final do cadastro.*" }).catch(e => console.error("Erro avisando corrigir:", e));
          await enviarDadoAtual(from, s);
          return;
        }

        if (s.step === 'EDITANDO_BLOCO_TEXTO') {
          text.split('\n').forEach(l => {
            const p = l.split(':');
            if (p.length >= 2) {
              const k = p[0].toLowerCase().trim(), v = p.slice(1).join(':').trim();
              if (k.includes('imobiliaria')) s.imobiliaria = v;
              else if (k.includes('cliente 1')) s.nomeCliente1 = v;
              else if (k.includes('cpf 1')) s.cpf1 = v;
              else if (k.includes('telefone 1')) s.telefone1 = v.replace(/\D/g, '');
              else if (k.includes('banco')) s.banco = v;
              else if (k.includes('cliente 2')) s.nomeCliente2 = v;
              else if (k.includes('cpf 2')) s.cpf2 = v;
              else if (k.includes('telefone 2')) s.telefone2 = v.replace(/\D/g, '');
              else if (k.includes('compra')) s.valorCompraVenda = v;
              else if (k.includes('financiamento')) s.valorFinanciamento = v;
              else if (k.includes('entrada')) s.valorEntrada = v;
              else if (k.includes('observacao')) s.observacao = v;
            }
          });
          await sock.sendMessage(from, { text: "✅ *Dados atualizados com sucesso!*" });
          await enviarResumoConfirmacao(from, s);
          return;
        }

        if (s.step === 'CONFIRMACAO_FINAL') {
          if (text === '1' || textLow.includes('confirmar') || textLow.includes('sim')) {
            await sock.sendMessage(from, { text: "⏳ *Enviando dados para o Google Sheets & Drive...*" });
            try {
              const payload1 = {
                imobiliaria: s.imobiliaria, nomeCliente: s.nomeCliente1, tipoProponente: "Proponente 1",
                cpf: s.cpf1, telefone: s.telefone1, banco: s.banco, valorCompraVenda: s.valorCompraVenda,
                valorFinanciamento: s.valorFinanciamento, valorEntrada: s.valorEntrada,
                observacao: s.observacao || "Nenhuma", whatsappOrigem: from, documentos: s.documentos
              };
              const resp1 = await axios.post(GOOGLE_WEBHOOK_URL, payload1);
              const idProposta = resp1.data.idProposta || "ID-GERADO";
              const pastaUrl = resp1.data.pastaUrl || "";

              if (s.temProp2) {
                const payload2 = {
                  idProposta: idProposta, imobiliaria: s.imobiliaria, nomeCliente: s.nomeCliente2
