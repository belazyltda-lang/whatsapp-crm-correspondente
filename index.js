/**
 * ROBÔ DE WHATSAPP - CORRESPONDENTE BANCÁRIO
 * Baileys + Express + Google Apps Script Webhook
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

// URL do seu Webhook do Google Apps Script
const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyrAlylOoCl-Bz1zs4JVUIRyBkKL_g1tmUSW3sYLFtdIxqMNSKXhFAXJ2b8rJiYm1OF/exec";

let currentQRCodeData = "";
let isConnected = false;
let sock = null;

// Armazenamento em memória dos estados de conversa
const sessions = {};

const BANCOS_LISTA = ["Itaú", "Caixa Econômica", "Bradesco", "Santander", "Banco do Brasil"];

app.use(express.json());

// Rota inicial para exibir o QR Code no navegador
app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>WhatsApp Bot - Conectado</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #eef2f5; }
          .card { background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .status { color: #2e7d32; font-weight: bold; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🤖 Robô WhatsApp Correspondente</h1>
          <p class="status">✅ STATUS: CONECTADO E RODANDO!</p>
          <p>O robô está ativo e pronto para receber propostas das imobiliárias.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!currentQRCodeData) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Carregando QR Code...</title><meta http-equiv="refresh" content="3"></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>⏳ Gerando QR Code do WhatsApp...</h2>
        <p>Aguarde 3 segundos, a página vai atualizar automaticamente.</p>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(currentQRCodeData);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conectar WhatsApp Bot</title>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="15">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 30px; background: #f4f6f8; }
          .card { background: white; padding: 30px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          img { margin: 20px 0; border: 4px solid #128c7e; border-radius: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>📱 Conectar Robô ao WhatsApp</h2>
          <p>1. Abra o WhatsApp no seu celular.</p>
          <p>2. Vá em <b>Menu / Configurações ➔ Aparelhos Conectados ➔ Conectar um Aparelho</b>.</p>
          <p>3. Aponte a câmera para o QR Code abaixo:</p>
          <img src="${qrImage}" width="280" />
          <p><small>A página atualiza a cada 15 segundos automaticamente.</small></p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Erro ao gerar imagem QR Code");
  }
});

async function startWhatsAppBot() {
  const authFolder = path.join(__dirname, 'auth_info');
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["CRM Correspondente", "Chrome", "1.0.0"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQRCodeData = qr;
      isConnected = false;
      console.log("📲 Novo QR Code gerado!");
    }

    if (connection === 'open') {
      isConnected = true;
      currentQRCodeData = "";
      console.log("🚀 WHATSAPP CONECTADO COM SUCESSO!");
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Conexão fechada. Reconectando: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 5000);
      }
    }
  });

  // Manipulador de Mensagens Recebidas
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg || msg.key.fromMe || !msg.message) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      if (isGroup) return; // Ignora grupos

      const text = (
        msg.message.conversation || 
        msg.message.extendedTextMessage?.text || 
        msg.message.imageMessage?.caption || 
        ""
      ).trim();

      let session = sessions[from];

      // Comando de reinício ou primeira mensagem
      if (!session || text.toLowerCase() === 'reiniciar' || text.toLowerCase() === 'menu' || text.toLowerCase() === 'inicio') {
        sessions[from] = { step: 'AGUARDANDO_IMOBILIARIA', documentos: [] };
        await sock.sendMessage(from, { 
          text: "👋 *Olá! Bem-vindo ao Sistema de Cadastro de Propostas.*\n\nPara iniciar uma nova proposta, digite o *Nome da Imobiliária*:" 
        });
        return;
      }

      switch (session.step) {

        // PASSO 1: Nome da Imobiliária
        case 'AGUARDANDO_IMOBILIARIA':
          session.imobiliaria = text;
          session.step = 'AGUARDANDO_NOME_PROP1';
          await sock.sendMessage(from, { 
            text: `🏢 Imobiliária registrada: *${text}*\n\nAgora, digite o *Nome Completo do Cliente (Proponente 1)*:` 
          });
          break;

        // PASSO 2: Nome do Proponente 1
        case 'AGUARDANDO_NOME_PROP1':
          session.nomeCliente1 = text;
          session.step = 'AGUARDANDO_CPF_PROP1';
          await sock.sendMessage(from, { 
            text: `👤 Cliente: *${text}*\n\nDigite o *CPF do Proponente 1*:` 
          });
          break;

        // PASSO 3: CPF do Proponente 1
        case 'AGUARDANDO_CPF_PROP1':
          session.cpf1 = text;
          session.step = 'AGUARDANDO_TEL_PROP1';
          await sock.sendMessage(from, { 
            text: `💳 CPF: *${text}*\n\nDigite o *Telefone do Proponente 1* (com DDD):` 
          });
          break;

        // PASSO 4: Telefone do Proponente 1
        case 'AGUARDANDO_TEL_PROP1':
          session.telefone1 = text.replace(/\D/g, ''); // Limpa caracteres
          session.step = 'AGUARDANDO_BANCO';
          await sock.sendMessage(from, { 
            text: `📱 Telefone: *${session.telefone1}*\n\nSelecione a *Financeira / Banco desejado*:\n\n1️⃣ Itaú\n2️⃣ Caixa Econômica\n3️⃣ Bradesco\n4️⃣ Santander\n5️⃣ Banco do Brasil\n\n_(Responda de 1 a 5)_` 
          });
          break;

        // PASSO 5: Seleção de Banco
        case 'AGUARDANDO_BANCO':
          const idx = parseInt(text) - 1;
          const bancoEscolhido = BANCOS_LISTA[idx] || text;
          session.banco = bancoEscolhido;
          session.step = 'AGUARDANDO_DOCS_PROP1';
          await sock.sendMessage(from, { 
            text: `🏦 Banco escolhido: *${bancoEscolhido}*\n\n📷 Por favor, envie as *fotos ou PDFs dos documentos* do Proponente 1 (RG/CNH, Renda, Endereço, Certidão).\n\nQuando terminar de enviar todas as fotos, digite *PRONTO*.` 
          });
          break;

        // PASSO 6: Coleta de Fotos/Documentos
        case 'AGUARDANDO_DOCS_PROP1':
          // Se for uma imagem ou documento enviado
          if (msg.message.imageMessage || msg.message.documentMessage) {
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer');
              const base64 = buffer.toString('base64');
              const mimeType = msg.message.imageMessage?.mimetype || msg.message.documentMessage?.mimetype || "image/jpeg";
              const fileName = `doc_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`;

              session.documentos.push({
                nomeArquivo: fileName,
                mimeType: mimeType,
                base64: base64
              });

              await sock.sendMessage(from, { text: `✅ Documento (${session.documentos.length}) recebido com sucesso!` });
            } catch (e) {
              await sock.sendMessage(from, { text: "⚠️ Erro ao baixar o arquivo, por favor reenvie." });
            }
            return;
          }

          if (text.toLowerCase() === 'pronto') {
            session.step = 'PERGUNTA_PROP2';
            await sock.sendMessage(from, { 
              text: `✅ *${session.documentos.length} documento(s)* salvos para o Proponente 1.\n\n❓ *Existe mais um proponente nesta proposta?*\n\n1️⃣ SIM\n2️⃣ NÃO` 
            });
          } else {
            await sock.sendMessage(from, { text: "Envie mais fotos ou digite *PRONTO* para prosseguir." });
          }
          break;

        // PASSO 7: Pergunta Proponente 2
        case 'PERGUNTA_PROP2':
          if (text === '1' || text.toLowerCase() === 'sim' || text.toLowerCase() === 's') {
            session.temProp2 = true;
            session.step = 'AGUARDANDO_NOME_PROP2';
            await sock.sendMessage(from, { text: "Digite o *Nome Completo do 2º Proponente*:" });
          } else {
            session.temProp2 = false;
            session.step = 'AGUARDANDO_COMPRA_VENDA';
            await sock.sendMessage(from, { text: "📌 *ETAPA 2: DADOS DO IMÓVEL*\n\nDigite o *Valor de Compra e Venda* (ex: 500.000):" });
          }
          break;

        // PASSO 7.1: Dados Proponente 2 (se SIM)
        case 'AGUARDANDO_NOME_PROP2':
          session.nomeCliente2 = text;
          session.step = 'AGUARDANDO_CPF_PROP2';
          await sock.sendMessage(from, { text: "Digite o *CPF do 2º Proponente*:" });
          break;

        case 'AGUARDANDO_CPF_PROP2':
          session.cpf2 = text;
          session.step = 'AGUARDANDO_TEL_PROP2';
          await sock.sendMessage(from, { text: "Digite o *Telefone do 2º Proponente*:" });
          break;

        case 'AGUARDANDO_TEL_PROP2':
          session.telefone2 = text.replace(/\D/g, '');
          session.step = 'AGUARDANDO_COMPRA_VENDA';
          await sock.sendMessage(from, { text: "📌 *ETAPA 2: DADOS DO IMÓVEL*\n\nDigite o *Valor de Compra e Venda* (ex: 500.000):" });
          break;

        // PASSO 8: Valor Compra e Venda
        case 'AGUARDANDO_COMPRA_VENDA':
          session.valorCompraVenda = text;
          session.step = 'AGUARDANDO_FINANCIAMENTO';
          await sock.sendMessage(from, { text: "Digite o *Valor do Financiamento necessário* (ex: 400.000):" });
          break;

        // PASSO 9: Valor Financiamento
        case 'AGUARDANDO_FINANCIAMENTO':
          session.valorFinanciamento = text;
          session.step = 'AGUARDANDO_ENTRADA';
          await sock.sendMessage(from, { text: "Digite o *Valor da Entrada* (ex: 100.000):" });
          break;

        // PASSO 10: Finalização e Disparo do Webhook
        case 'AGUARDANDO_ENTRADA':
          session.valorEntrada = text;
          await sock.sendMessage(from, { text: "⏳ *Enviando dados para o Google Sheets & Drive...*" });

          try {
            // 1. Enviar dados do Proponente 1
            const payloadProp1 = {
              imobiliaria: session.imobiliaria,
              nomeCliente: session.nomeCliente1,
              tipoProponente: "Proponente 1",
              cpf: session.cpf1,
              telefone: session.telefone1,
              banco: session.banco,
              valorCompraVenda: session.valorCompraVenda,
              valorFinanciamento: session.valorFinanciamento,
              valorEntrada: session.valorEntrada,
              documentos: session.documentos
            };

            const resp1 = await axios.post(GOOGLE_WEBHOOK_URL, payloadProp1);
            const idProposta = resp1.data.idProposta || "ID-GERADO";
            const pastaUrl = resp1.data.pastaUrl || "";

            // 2. Se houver Proponente 2, enviar registro vinculado
            if (session.temProp2) {
              const payloadProp2 = {
                idProposta: idProposta,
                imobiliaria: session.imobiliaria,
                nomeCliente: session.nomeCliente2,
                tipoProponente: "Proponente 2",
                cpf: session.cpf2,
                telefone: session.telefone2,
                banco: session.banco,
                valorCompraVenda: session.valorCompraVenda,
                valorFinanciamento: session.valorFinanciamento,
                valorEntrada: session.valorEntrada
              };
              await axios.post(GOOGLE_WEBHOOK_URL, payloadProp2);
            }

            // Resposta de sucesso ao Corretor
            await sock.sendMessage(from, { 
              text: `🎉 *PROPOSTA CADASTRADA COM SUCESSO!*\n\n📍 *ID Proposta:* ${idProposta}\n📂 *Pasta no Drive:* ${pastaUrl}\n\nO cliente já recebeu a mensagem de acompanhamento!` 
            });

            // Notificação ao Cliente Final (Proponente 1) se houver número válido
            if (session.telefone1) {
              const clientJid = `${session.telefone1}@s.whatsapp.net`;
              await sock.sendMessage(clientJid, {
                text: `Olá *${session.nomeCliente1}*! Acompanhe em tempo real o status do seu financiamento com a *${session.imobiliaria}*.\n\n📍 *Banco:* ${session.banco}\n📍 *Status Atual:* ⏳ EM APROVAÇÃO`
              }).catch(() => console.log("Não foi possível enviar msg ao cliente diretamente"));
            }

            delete sessions[from];

          } catch (error) {
            console.error("Erro no envio do Webhook:", error);
            await sock.sendMessage(from, { text: "⚠️ Ocorreu um erro ao salvar na planilha. Tente novamente digirando *inicio*." });
          }
          break;
      }

    } catch (e) {
      console.error("Erro ao processar mensagem:", e);
    }
  });

  return sock;
}

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  startWhatsAppBot();
});
