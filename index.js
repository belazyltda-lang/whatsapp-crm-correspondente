/**
 * ROBÔ DE WHATSAPP - CORRESPONDENTE BANCÁRIO (RECEITA DE BANCO)
 * Com Limpeza Automática de Sessões Expiradas para Geração Instantânea de QR Code
 */

const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason
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
    if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
    setTimeout(startWhatsAppBot, 2000);
    res.send(`<!DOCTYPE html><html><head><title>Resetando...</title><meta http-equiv="refresh" content="4;url=/"></head><body style="font-family:Arial;text-align:center;padding:50px;"><h2>🔄 Sessão resetada! Gerando novo QR Code...</h2></body></html>`);
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
    return res.send(`<!DOCTYPE html><html><head><title>Carregando...</title><meta http-equiv="refresh" content="3"></head><body style="font-family:Arial;text-align:center;padding:50px;"><h2>⏳ Gerando QR Code...</h2></body></html>`);
  }
  try {
    const qrImage = await QRCode.toDataURL(currentQRCodeData);
    res.send(`<!DOCTYPE html><html><head><title>Conectar Bot</title><meta charset="utf-8"><meta http-equiv="refresh" content="12"><style>body{font-family:Arial;text-align:center;padding:30px;background:#f4f6f8;}.card{background:white;padding:30px;border-radius:16px;display:inline-block;}img{margin:20px 0;border:4px solid #128c7e;border-radius:12px;}</style></head><body><div class="card"><h2>📱 Conectar Robô ao WhatsApp</h2><img src="${qrImage}" width="280" /></div></body></html>`);
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
      printQRInTerminal: true, 
      browser: ['CRM-Correspondente', 'Chrome', '1.0.0'],
      syncFullHistory: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { 
        currentQRCodeData = qr; 
        isConnected = false; 
        console.log("✅ QR Code gerado!");
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
          console.log("🔄 Sessão expirada/inválida. Limpando credenciais para gerar novo QR Code...");
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
                  idProposta: idProposta, imobiliaria: s.imobiliaria, nomeCliente: s.nomeCliente2,
                  tipoProponente: "Proponente 2", cpf: s.cpf2, telefone: s.telefone2, banco: s.banco,
                  valorCompraVenda: s.valorCompraVenda, valorFinanciamento: s.valorFinanciamento,
                  valorEntrada: s.valorEntrada, observacao: s.observacao || "Nenhuma", whatsappOrigem: from
                };
                await axios.post(GOOGLE_WEBHOOK_URL, payload2);
              }

              await sock.sendMessage(from, { text: `🎉 *PROPOSTA CADASTRADA COM SUCESSO!*\n\n📍 *ID Proposta:* ${idProposta}\n📂 *Pasta no Drive:* ${pastaUrl}\n\nO cliente já recebeu a mensagem de acompanhamento!` });

              if (s.telefone1) {
                const clientJid = `${s.telefone1.replace(/\D/g, '')}@s.whatsapp.net`;
                await sock.sendMessage(clientJid, { text: `Ótima notícia! 🎉 Sua proposta já está em análise no banco escolhido (*${s.banco}*), e está com o status de: *EM APROVAÇÃO*. Assim que houver uma atualização te retornaremos.\n\n_(⚠️ Nenhuma resposta é necessária, o Robô não responderá nesta conversa)_` }).catch(()=>{});
              }

              delete sessions[from];
            } catch (error) {
              await sock.sendMessage(from, { text: "⚠️ Ocorreu um erro ao salvar na planilha. Tente novamente digitando *inicio*." });
            }
            return;
          } else if (text === '2' || textLow.includes('corrigir') || textLow.includes('nao')) {
            s.step = 'EDITANDO_BLOCO_TEXTO';
            await sock.sendMessage(from, { text: "✏️ *Certo! Copie a mensagem a seguir, altere o dado desejado e envie de volta:*" });
            await sock.sendMessage(from, { text: gerarTextoCopiaEdicao(s) });
            return;
          }
        }

        switch (s.step) {
          case 'AGUARDANDO_NOME_IMOBILIARIA':
            if (['cadastro','cadastre','cadastrar'].includes(textLow)) {
              s.step = 'CADASTRO_IMOB_NOME';
              await sock.sendMessage(from, { text: "🏢 *CADASTRO DE NOVA IMOBILIÁRIA*\n\nDigite o *Nome da Imobiliária*:" });
              return;
            }
            await sock.sendMessage(from, { text: "⏳ *Verificando imobiliária na planilha...*" });
            const busca = await verificarNomeImobiliaria(text);
            if (busca.valido) {
              s.imobiliaria = busca.imobiliaria;
              s.step = 'AGUARDANDO_NOME_PROP1';
              await sock.sendMessage(from, { text: `✅ Imobiliária encontrada: *${busca.imobiliaria}*\n\nDigite o *Nome Completo do Cliente (Proponente 1)*:` });
            } else {
              await sock.sendMessage(from, { text: `⚠️ Imobiliária *"${text}"* não foi encontrada na nossa planilha.\n\n👉 Verifique a grafia ou digite *CADASTRO* para cadastrar.` });
            }
            break;

          case 'CADASTRO_IMOB_NOME':
            s.novoImobNome = text; s.step = 'CADASTRO_IMOB_TEL';
            await sock.sendMessage(from, { text: `📱 Digite o *Telefone / Celular da Imobiliária* ${text}:` });
            break;
          case 'CADASTRO_IMOB_TEL':
            s.novoImobTel = text; s.step = 'CADASTRO_IMOB_BA
