/**
 * ROBÔ DE WHATSAPP - CORRESPONDENTE BANCÁRIO (RECEITA DE BANCO)
 * Com Limpeza de Sessão (/logout) + Tratamento Robusto de Eventos Baileys
 */

const express = require('express');
const QRCode = require('qrcode');
const axios = require('axios');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// URL do Webhook do Google Apps Script
const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyiAvghPgf9ONIyxWDG2WVVCU1Zpuy7MFtwJQxXakdVlHdpE7PH0IvnzefGzjZlwT40/exec";

let currentQRCodeData = "";
let isConnected = false;
let sock = null;

const sessions = {};
const BANCOS_LISTA = ["Itaú", "Caixa Econômica", "Bradesco", "Santander", "Banco do Brasil"];

app.use(express.json());

// ⏰ SELF-PING INTERNO: Mantém o servidor do Render acordado enviando requisições a cada 4 minutos
setInterval(async () => {
  try {
    const renderUrl = process.env.RENDER_EXTERNAL_URL || "https://whatsapp-crm-correspondente.onrender.com";
    await axios.get(renderUrl);
    console.log("⏰ Self-ping enviado para manter o robô 24/7 online!");
  } catch (err) {
    console.log("Self-ping notice:", err.message);
  }
}, 4 * 60 * 1000);

// 🔄 ROTA PARA RESETAR SESSÃO E GERAR NOVO QR CODE SE O WHATSAPP TRAVAR
app.get('/logout', async (req, res) => {
  try {
    isConnected = false;
    currentQRCodeData = "";
    if (sock) {
      try { sock.logout(); } catch(e) {}
      try { sock.end(); } catch(e) {}
    }
    const authFolder = path.join(__dirname, 'auth_info');
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
    }
    setTimeout(startWhatsAppBot, 2000);
    res.send(`
      <!DOCTYPE html><html><head><title>Resetando Sessão...</title><meta http-equiv="refresh" content="5;url=/"></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>🔄 Sessão desconectada com sucesso!</h2>
        <p>Aguarde 5 segundos, você será redirecionado para escaneiar o novo QR Code...</p>
      </body></html>
    `);
  } catch (err) {
    res.send("Erro ao resetar: " + err.message);
  }
});

// 🔔 ENDPOINT DE NOTIFICAÇÃO DE APROVAÇÃO (Disparado pelo Google Sheets ao mudar Status para Aprovado)
app.post('/notificar-aprovacao', async (req, res) => {
  try {
    const { idProposta, nomeCliente, cpf, telefoneCliente, whatsappImobiliaria } = req.body;
    console.log(`🔔 Recebida notificação de aprovação para a proposta ${idProposta} - ${nomeCliente}`);

    if (!sock || !isConnected) {
      return res.status(503).json({ status: "error", message: "WhatsApp desconectado" });
    }

    // 1. Mensagem para a Imobiliária / Corretor (quem enviou a proposta)
    if (whatsappImobiliaria) {
      const imobJid = whatsappImobiliaria.includes('@') ? whatsappImobiliaria : `${whatsappImobiliaria.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(imobJid, {
        text: `🎉 *Ótima notícia!* O cliente *${idProposta} - ${nomeCliente} (CPF: ${cpf})* está *APROVADO*!`
      }).catch(err => console.error("Erro mensagem imob aprovação:", err));
    }

    // Pausa de 1.5s entre envios
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 2. Mensagem para o Cliente Final (Proponente 1)
    if (telefoneCliente) {
      const clientJid = `${telefoneCliente.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(clientJid, {
        text: `🎉 *Pode comemorar!* Sua proposta está *APROVADA*! Agora aguarde os próximos passos, eu vou te informando por aqui.\n\n_(⚠️ Nenhuma resposta é necessária, o Robô não responderá nesta conversa)_`
      }).catch(err => console.error("Erro mensagem cliente aprovação:", err));
    }

    return res.json({ status: "success", message: "Notificações de aprovação enviadas!" });
  } catch (error) {
    console.error("Erro rota notificar-aprovacao:", error);
    return res.status(500).json({ status: "error", message: error.toString() });
  }
});

app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html><html><head><title>WhatsApp Bot - Conectado</title><meta charset="utf-8">
      <style>body { font-family: Arial; text-align: center; padding: 50px; background: #eef2f5; } .card { background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); } .status { color: #2e7d32; font-weight: bold; font-size: 24px; } .btn-logout { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #d32f2f; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }</style></head>
      <body><div class="card"><h1>🤖 Robô WhatsApp Correspondente</h1><p class="status">✅ STATUS: CONECTADO E RODANDO 24/7!</p><p>O robô está ativo e pronto para receber propostas das imobiliárias.</p><a href="/logout" class="btn-logout">🔄 Reconectar / Novo QR Code</a></div></body></html>
    `);
  }
  if (!currentQRCodeData) {
    return res.send(`<!DOCTYPE html><html><head><title>Carregando...</title><meta http-equiv="refresh" content="3"></head><body style="font-family: Arial; text-align: center; padding: 50px;"><h2>⏳ Conectando aos servidores do WhatsApp...</h2></body></html>`);
  }
  try {
    const qrImage = await QRCode.toDataURL(currentQRCodeData);
    res.send(`<!DOCTYPE html><html><head><title>Conectar Bot</title><meta charset="utf-8"><meta http-equiv="refresh" content="12"><style>body { font-family: Arial; text-align: center; padding: 30px; background: #f4f6f8; } .card { background: white; padding: 30px; border-radius: 16px; display: inline-block; } img { margin: 20px 0; border: 4px solid #128c7e; border-radius: 12px; }</style></head><body><div class="card"><h2>📱 Conectar Robô ao WhatsApp</h2><img src="${qrImage}" width="280" /></div></body></html>`);
  } catch (err) { res.status(500).send("Erro QR Code"); }
});

async function verificarNomeImobiliaria(nome) {
  try {
    const resp = await axios.get(`${GOOGLE_WEBHOOK_URL}?action=verifyName&name=${encodeURIComponent(nome)}`);
    if (resp.data && resp.data.found) {
      return { valido: true, imobiliaria: resp.data.imobiliaria, codigo: resp.data.codigo };
    }
  } catch (err) { console.error("Erro verificar nome imobiliária:", err.message); }
  return { valido: false };
}

async function cadastrarNovaImobiliaria(nome, telefone, bairro) {
  try {
    const resp = await axios.post(GOOGLE_WEBHOOK_URL, { action: "cadastrarImobiliaria", nome: nome, telefone: telefone, bairro: bairro });
    if (resp.data && (resp.data.imobiliaria || resp.data.nome)) {
      return {
        nome: resp.data.imobiliaria || resp.data.nome,
        codigo: resp.data.codigo
      };
    }
  } catch (err) { console.error("Erro cadastrar imob:", err.message); }
  return null;
}

function gerarTextoCopiaEdicao(session) {
  let txt = `Imobiliária: ${session.imobiliaria || ''}\n`;
  txt += `Cliente 1: ${session.nomeCliente1 || ''}\n`;
  txt += `CPF 1: ${session.cpf1 || ''}\n`;
  txt += `Telefone 1: ${session.telefone1 || ''}\n`;
  txt += `Banco: ${session.banco || ''}\n`;

  if (session.temProp2) {
    txt += `Cliente 2: ${session.nomeCliente2 || ''}\n`;
    txt += `CPF 2: ${session.cpf2 || ''}\n`;
    txt += `Telefone 2: ${session.telefone2 || ''}\n`;
  }

  txt += `Compra/Venda: ${session.valorCompraVenda || ''}\n`;
  txt += `Financiamento: ${session.valorFinanciamento || ''}\n`;
  txt += `Entrada: ${session.valorEntrada || ''}\n`;
  txt += `Observação: ${session.observacao || 'Nenhuma'}`;

  return txt;
}

async function enviarResumoConfirmacao(from, session) {
  let resumo = `📋 *RESUMO DA PROPOSTA PARA CONFIRMAÇÃO:*\n\n`;
  resumo += `🏢 *Imobiliária:* ${session.imobiliaria}\n`;
  resumo += `👤 *Proponente 1:* ${session.nomeCliente1}\n`;
  resumo += `💳 *CPF Prop 1:* ${session.cpf1}\n`;
  resumo += `📱 *Telefone Prop 1:* ${session.telefone1}\n`;
  resumo += `🏦 *Banco Escolhido:* ${session.banco}\n`;

  if (session.temProp2) {
    resumo += `👥 *Proponente 2:* ${session.nomeCliente2} (CPF: ${session.cpf2}, Tel: ${session.telefone2})\n`;
  }

  resumo += `🏠 *Compra/Venda:* R$ ${session.valorCompraVenda}\n`;
  resumo += `💰 *Financiamento:* R$ ${session.valorFinanciamento}\n`;
  resumo += `💵 *Entrada:* R$ ${session.valorEntrada}\n`;
  resumo += `📁 *Documentos:* ${session.documentos.length} arquivo(s)\n`;
  resumo += `📝 *Observação:* ${session.observacao || 'Nenhuma'}\n\n`;
  resumo += `---\n❓ *Deseja enviar a proposta ou precisa corrigir algum dado?*\n\n1️⃣ *CONFIRMAR E ENVIAR*\n2️⃣ *CORRIGIR ALGUNS DADOS*`;

  session.step = 'CONFIRMACAO_FINAL';
  await sock.sendMessage(from, { text: resumo });
}

async function enviarDadoAtual(from, session) {
  switch (session.step) {
    case 'AGUARDANDO_NOME_PROP1':
      await sock.sendMessage(from, { text: `👤 Digite o *Nome Completo do Cliente (Proponente 1)*:` });
      break;
    case 'AGUARDANDO_CPF_PROP1':
      await sock.sendMessage(from, { text: `💳 Digite o *CPF do Proponente 1*:` });
      break;
    case 'AGUARDANDO_TEL_PROP1':
      await sock.sendMessage(from, { text: `📱 Digite o *Telefone do Proponente 1*:` });
      break;
    case 'AGUARDANDO_BANCO':
      await sock.sendMessage(from, { text: `🏦 Selecione a *Financeira / Banco desejado*:\n\n1️⃣ Itaú\n2️⃣ Caixa Econômica\n3️⃣ Bradesco\n4️⃣ Santander\n5️⃣ Banco do Brasil` });
      break;
    case 'AGUARDANDO_DOCS_PROP1':
      await sock.sendMessage(from, { text: `📷 Envie os *documentos* do Proponente 1 ou digite *PRONTO*:` });
      break;
    case 'AGUARDANDO_COMPRA_VENDA':
      await sock.sendMessage(from, { text: `📌 Digite o *Valor de Compra e Venda* (ex: 500.000):` });
      break;
    case 'AGUARDANDO_FINANCIAMENTO':
      await sock.sendMessage(from, { text: `Digite o *Valor do Financiamento* (ex: 400.000):` });
      break;
    case 'AGUARDANDO_ENTRADA':
      await sock.sendMessage(from, { text: `Digite o *Valor da Entrada* (ex: 100.000):` });
      break;
    default:
      await sock.sendMessage(from, { text: `Continuando o preenchimento...` });
  }
}

async function startWhatsAppBot() {
  try {
    const authFolder = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ 
      version, 
      auth: state, 
      printQRInTerminal: true, 
      browser: Browsers.ubuntu('Chrome'), 
      generateHighQualityLinkPreview: true,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { currentQRCodeData = qr; isConnected = false; }
      if (connection === 'open') { 
        isConnected = true; 
        currentQRCodeData = ""; 
        console.log("✅ WHATSAPP CONECTADO COM SUCESSO!");
      }
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`⚠️ Conexão fechada (Código ${statusCode}). Reconectando em 3s...`);
        if (statusCode !== DisconnectReason.loggedOut) setTimeout(startWhatsAppBot, 3000);
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

        console.log(`📩 [${from}] Mensagem recebida: "${text}" (fromMe: ${msg.key.fromMe})`);

        if (msg.key.fromMe) {
          return;
        }

        const textLow = text.toLowerCase();
        let session = sessions[from];

        // 1. REINICIAR CONVERSA / SAUDAÇÃO INICIAL
        if (!session || textLow === 'reiniciar' || textLow === 'menu' || textLow === 'inicio' || textLow === 'cancelar' || textLow === 'sair' || textLow === 'voltar') {
          sessions[from] = { step: 'AGUARDANDO_NOME_IMOBILIARIA', documentos: [] };
          await sock.sendMessage(from, { 
            text: "👋 *Olá! Bem-vindo ao Sistema de Cadastro de Propostas do Receita De Banco.*\n\nEnvie o nome da imobiliaria responsável pela proposta:\n_(caso não tenha cadastro digite *CADASTRO*)_" 
          });
          return;
        }

        // 2. GATILHO DURANTE AS ETAPAS: "CORRIGIR", "EDITAR", "ALTERAR"
        if (['corrigir', 'editar', 'alterar'].includes(textLow) && session.step !== 'CONFIRMACAO_FINAL' && session.step !== 'EDITANDO_BLOCO_TEXTO') {
          await sock.sendMessage(from, { 
            text: "👍 *Fique tranquilo! Você poderá conferir e corrigir todos os dados ao final do cadastro.*" 
          });
          await enviarDadoAtual(from, session);
          return;
        }

        // 3. FLUXO DE EDIÇÃO POR CÓPIA/COLA NO FINAL
        if (session.step === 'EDITANDO_BLOCO_TEXTO') {
          const lines = text.split('\n');
          lines.forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
              const key = parts[0].toLowerCase().trim();
              const val = parts.slice(1).join(':').trim();

              if (key.includes('imobiliaria') || key.includes('imobiliária')) session.imobiliaria = val;
              else if (key.includes('cliente 1')) session.nomeCliente1 = val;
              else if (key.includes('cpf 1')) session.cpf1 = val;
              else if (key.includes('telefone 1')) session.telefone1 = val.replace(/\D/g, '');
              else if (key.includes('banco')) session.banco = val;
              else if (key.includes('cliente 2')) session.nomeCliente2 = val;
              else if (key.includes('cpf 2')) session.cpf2 = val;
              else if (key.includes('telefone 2')) session.telefone2 = val.replace(/\D/g, '');
              else if (key.includes('compra')) session.valorCompraVenda = val;
              else if (key.includes('financiamento')) session.valorFinanciamento = val;
              else if (key.includes('entrada')) session.valorEntrada = val;
              else if (key.includes('observacao') || key.includes('observação')) session.observacao = val;
            }
          });

          await sock.sendMessage(from, { text: "✅ *Dados atualizados com sucesso!*" });
          await enviarResumoConfirmacao(from, session);
          return;
        }

        // 4. CONFIRMAÇÃO FINAL
        if (session.step === 'CONFIRMACAO_FINAL') {
          if (text === '1' || textLow.includes('confirmar') || textLow.includes('sim')) {
            // ENVIAR PROPOSTA PARA GOOGLE SHEETS & DRIVE
            await sock.sendMessage(from, { text: "⏳ *Enviando dados para o Google Sheets & Drive...*" });

            try {
              const payloadProp1 = {
                imobiliaria: session.imobiliaria, nomeCliente: session.nomeCliente1, tipoProponente: "Proponente 1",
                cpf: session.cpf1, telefone: session.telefone1, banco: session.banco,
                valorCompraVenda: session.valorCompraVenda, valorFinanciamento: session.valorFinanciamento,
                valorEntrada: session.valorEntrada, observacao: session.observacao || "Nenhuma",
                whatsappOrigem: from, documentos: session.documentos
              };

              const resp1 = await axios.post(GOOGLE_WEBHOOK_URL, payloadProp1);
              const idProposta = resp1.data.idProposta || "ID-GERADO";
              const pastaUrl = resp1.data.pastaUrl || "";

              if (session.temProp2) {
                const payloadProp2 = {
                  idProposta: idProposta, imobiliaria: session.imobiliaria, nomeCliente: session.nomeCliente2,
                  tipoProponente: "Proponente 2", cpf: session.cpf2, telefone: session.telefone2,
                  banco: session.banco, valorCompraVenda: session.valorCompraVenda,
                  valorFinanciamento: session.valorFinanciamento, valorEntrada: session.valorEntrada,
                  observacao: session.observacao || "Nenhuma", whatsappOrigem: from
                };
                await axios.post(GOOGLE_WEBHOOK_URL, payloadProp2);
              }

              await sock.sendMessage(from, { 
                text: `🎉 *PROPOSTA CADASTRADA COM SUCESSO!*\n\n📍 *ID Proposta:* ${idProposta}\n📂 *Pasta no Drive:* ${pastaUrl}\n\nO cliente já recebeu a mensagem de acompanhamento!` 
              });

              // MENSAGEM PARA O CLIENTE (PROPONENTE 1) AO CONCLUIR CADASTRO
              if (session.telefone1) {
                const clientJid = `${session.telefone1.replace(/\D/g, '')}@s.whatsapp.net`;
                await sock.sendMessage(clientJid, {
                  text: `Ótima notícia! 🎉 Sua proposta já está em análise no banco escolhido (*${session.banco}*), e está com o status de: *EM APROVAÇÃO*. Assim que houver uma atualização te retornaremos.\n\n_(⚠️ Nenhuma resposta é necessária, o Robô não responderá nesta conversa)_`
                }).catch(err => console.log("Erro mensagem inicial cliente:", err.message));
              }

              delete sessions[from];

            } catch (error) {
              console.error("Erro Webhook:", error);
              await sock.sendMessage(from, { text: "⚠️ Ocorreu um erro ao salvar na planilha. Tente novamente digitando *inicio*." });
            }
            return;

          } else if (text === '2' || textLow.includes('corrigir') || textLow.includes('nao') || textLow.includes('não')) {
            session.step = 'EDITANDO_BLOCO_TEXTO';
            await sock.sendMessage(from, { 
              text: "✏️ *Certo! Copie a mensagem a seguir, altere o dado desejado e envie de volta:*" 
            });

            const blocoEdicao = gerarTextoCopiaEdicao(session);
            await sock.sendMessage(from, { text: blocoEdicao });
