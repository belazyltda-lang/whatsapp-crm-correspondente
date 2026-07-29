/**
 * ROBÔ DE WHATSAPP - CORRESPONDENTE BANCÁRIO (RECEITA DE BANCO)
 * Busca por Nome de Imobiliária + Cadastro de Novas Imobiliárias (Mapeamento Corrigido)
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

app.get('/', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html><html><head><title>WhatsApp Bot - Conectado</title><meta charset="utf-8">
      <style>body { font-family: Arial; text-align: center; padding: 50px; background: #eef2f5; } .card { background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); } .status { color: #2e7d32; font-weight: bold; font-size: 24px; }</style></head>
      <body><div class="card"><h1>🤖 Robô WhatsApp Correspondente</h1><p class="status">✅ STATUS: CONECTADO E RODANDO!</p><p>O robô está ativo e pronto para receber propostas das imobiliárias.</p></div></body></html>
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

async function startWhatsAppBot() {
  try {
    const authFolder = path.join(__dirname, 'auth_info');
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ version, auth: state, printQRInTerminal: true, browser: Browsers.ubuntu('Chrome'), generateHighQualityLinkPreview: true });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { currentQRCodeData = qr; isConnected = false; }
      if (connection === 'open') { isConnected = true; currentQRCodeData = ""; }
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) setTimeout(startWhatsAppBot, 3000);
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg || msg.key.fromMe || !msg.message) return;
        const from = msg.key.remoteJid;
        if (from.endsWith('@g.us')) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "").trim();
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

        // 2. COMANDO GLOBAL DE CORREÇÃO ("CORRIGIR", "EDITAR", "ALTERAR")
        if ((textLow === 'corrigir' || textLow === 'editar' || textLow === 'alterar') && session.step !== 'SELECIONANDO_CAMPO_EDICAO' && !session.step.startsWith('EDITANDO_')) {
          session.previousStep = session.step;
          session.step = 'SELECIONANDO_CAMPO_EDICAO';
          
          await sock.sendMessage(from, { 
            text: `✏️ *QUAL DADO VOCÊ DESEJA CORRIGIR?*\n\n1️⃣ Nome da Imobiliária\n2️⃣ Nome do Cliente (Proponente 1)\n3️⃣ CPF do Proponente 1\n4️⃣ Telefone do Proponente 1\n5️⃣ Banco Escolhido\n\n0️⃣ Cancelar e Continuar de onde parei\n\n_(Responda digitando o número correspondente)_` 
          });
          return;
        }

        // 3. PROCESSAMENTO DE EDIÇÃO
        if (session.step === 'SELECIONANDO_CAMPO_EDICAO') {
          switch (text) {
            case '1':
              session.step = 'EDITANDO_IMOBILIARIA';
              await sock.sendMessage(from, { text: "🏢 Digite o *NOVO Nome da Imobiliária*:" });
              return;
            case '2':
              session.step = 'EDITANDO_NOME_PROP1';
              await sock.sendMessage(from, { text: "👤 Digite o *NOVO Nome do Cliente (Proponente 1)*:" });
              return;
            case '3':
              session.step = 'EDITANDO_CPF_PROP1';
              await sock.sendMessage(from, { text: "💳 Digite o *NOVO CPF do Proponente 1*:" });
              return;
            case '4':
              session.step = 'EDITANDO_TEL_PROP1';
              await sock.sendMessage(from, { text: "📱 Digite o *NOVO Telefone do Proponente 1*:" });
              return;
            case '5':
              session.step = 'EDITANDO_BANCO';
              await sock.sendMessage(from, { text: "🏦 Selecione o *NOVO Banco*:\n\n1️⃣ Itaú\n2️⃣ Caixa Econômica\n3️⃣ Bradesco\n4️⃣ Santander\n5️⃣ Banco do Brasil" });
              return;
            case '0':
            default:
              session.step = session.previousStep || 'AGUARDANDO_NOME_PROP1';
              await sock.sendMessage(from, { text: "👍 Correção cancelada. Continuando o cadastro!" });
              return;
          }
        }

        if (session.step.startsWith('EDITANDO_')) {
          switch (session.step) {
            case 'EDITANDO_IMOBILIARIA':
              session.imobiliaria = text;
              await sock.sendMessage(from, { text: `✅ Imobiliária atualizada para: *${text}*` });
              break;
            case 'EDITANDO_NOME_PROP1':
              session.nomeCliente1 = text;
              await sock.sendMessage(from, { text: `✅ Nome atualizado para: *${text}*` });
              break;
            case 'EDITANDO_CPF_PROP1':
              session.cpf1 = text;
              await sock.sendMessage(from, { text: `✅ CPF atualizado para: *${text}*` });
              break;
            case 'EDITANDO_TEL_PROP1':
              session.telefone1 = text.replace(/\D/g, '');
              await sock.sendMessage(from, { text: `✅ Telefone atualizado para: *${session.telefone1}*` });
              break;
            case 'EDITANDO_BANCO':
              const idxB = parseInt(text) - 1;
              session.banco = BANCOS_LISTA[idxB] || text;
              await sock.sendMessage(from, { text: `✅ Banco atualizado para: *${session.banco}*` });
              break;
          }
          session.step = session.previousStep || 'AGUARDANDO_DOCS_PROP1';
          await sock.sendMessage(from, { text: "👍 Retornando ao cadastro..." });
          return;
        }

        // 4. MÁQUINA DE ESTADOS PRINCIPAL
        switch (session.step) {

          // PASSO 0: BUSCAR NOME DA IMOBILIÁRIA OU CADASTRAR
          case 'AGUARDANDO_NOME_IMOBILIARIA':
            if (['cadastro', 'cadastre', 'cadastrar', 'novo cadastro', 'nova imobiliaria'].includes(textLow)) {
              session.step = 'CADASTRO_IMOB_NOME';
              await sock.sendMessage(from, { text: "🏢 *CADASTRO DE NOVA IMOBILIÁRIA*\n\nDigite o *Nome da Imobiliária*:" });
              return;
            }

            await sock.sendMessage(from, { text: "⏳ *Verificando imobiliária na planilha...*" });
            const busca = await verificarNomeImobiliaria(text);

            if (busca.valido) {
              session.imobiliaria = busca.imobiliaria;
              session.step = 'AGUARDANDO_NOME_PROP1';

              await sock.sendMessage(from, { 
                text: `✅ Imobiliária encontrada: *${busca.imobiliaria}*\n\nDigite o *Nome Completo do Cliente (Proponente 1)*:` 
              });
            } else {
              await sock.sendMessage(from, { 
                text: `⚠️ Imobiliária *"${text}"* não foi encontrada na nossa planilha de cadastros.\n\n👉 Verifique se digitou o nome corretamente.\n👉 Ou digite *CADASTRO* para realizar o cadastro da sua imobiliária.` 
              });
            }
            break;

          // FLUXO DE CADASTRO COMPLETO DA NOVA IMOBILIÁRIA
          case 'CADASTRO_IMOB_NOME':
            session.novoImobNome = text;
            session.step = 'CADASTRO_IMOB_TEL';
            await sock.sendMessage(from, { text: `📱 Digite o *Telefone / Celular da Imobiliária* ${text}:` });
            break;

          case 'CADASTRO_IMOB_TEL':
            session.novoImobTel = text;
            session.step = 'CADASTRO_IMOB_BAIRRO';
            await sock.sendMessage(from, { text: "📍 Digite o *Bairro da Imobiliária*:" });
            break;

          case 'CADASTRO_IMOB_BAIRRO':
            session.novoImobBairro = text;
            await sock.sendMessage(from, { text: "⏳ *Cadastrando imobiliária na planilha...*" });

            const novaiMob = await cadastrarNovaImobiliaria(session.novoImobNome, session.novoImobTel, session.novoImobBairro);

            if (novaiMob && novaiMob.nome) {
              session.imobiliaria = novaiMob.nome;
              session.step = 'AGUARDANDO_NOME_PROP1';

              await sock.sendMessage(from, { 
                text: `🎉 *CADASTRO REALIZADO COM SUCESSO!*\n\n🏢 *Imobiliária:* ${novaiMob.nome}\n\n--- Agora vamos cadastrar a proposta ---\n\nDigite o *Nome Completo do Cliente (Proponente 1)*:` 
              });
            } else {
              await sock.sendMessage(from, { text: "⚠️ *FALHA AO CADASTRAR A IMOBILIÁRIA.*\nPor favor, tente novamente digitando *inicio*." });
              delete sessions[from];
            }
            break;

          // CADASTRO DO PROPONENTE 1 E PROPOSTA
          case 'AGUARDANDO_NOME_PROP1':
            session.nomeCliente1 = text;
            session.step = 'AGUARDANDO_CPF_PROP1';
            await sock.sendMessage(from, { 
              text: `👤 Cliente: *${text}*\n\nDigite o *CPF do Proponente 1*:\n\n_(💡 Dica: Se errar qualquer dado, digite **CORRIGIR** a qualquer momento)_` 
            });
            break;

          case 'AGUARDANDO_CPF_PROP1':
            session.cpf1 = text;
            session.step = 'AGUARDANDO_TEL_PROP1';
            await sock.sendMessage(from, { 
              text: `💳 CPF: *${text}*\n\nDigite o *Telefone do Proponente 1* (com DDD):` 
            });
            break;

          case 'AGUARDANDO_TEL_PROP1':
            session.telefone1 = text.replace(/\D/g, '');
            session.step = 'AGUARDANDO_BANCO';
            await sock.sendMessage(from, { 
              text: `📱 Telefone: *${session.telefone1}*\n\nSelecione a *Financeira / Banco desejado*:\n\n1️⃣ Itaú\n2️⃣ Caixa Econômica\n3️⃣ Bradesco\n4️⃣ Santander\n5️⃣ Banco do Brasil\n\n_(Responda de 1 a 5)_` 
            });
            break;

          case 'AGUARDANDO_BANCO':
            const idxBanco = parseInt(text) - 1;
            const bancoEscolhido = BANCOS_LISTA[idxBanco] || text;
            session.banco = bancoEscolhido;
            session.step = 'AGUARDANDO_DOCS_PROP1';
            await sock.sendMessage(from, { 
              text: `🏦 Banco escolhido: *${bancoEscolhido}*\n\n📷 Por favor, envie as *fotos ou PDFs dos documentos* do Proponente 1 (RG/CNH, Renda, Endereço, Certidão).\n\nQuando terminar de enviar todas as fotos, digite *PRONTO*.` 
            });
            break;

          case 'AGUARDANDO_DOCS_PROP1':
            if (msg.message.imageMessage || msg.message.documentMessage) {
              try {
                const buffer = await downloadMediaMessage(msg, 'buffer');
                const base64 = buffer.toString('base64');
                const mimeType = msg.message.imageMessage?.mimetype || msg.message.documentMessage?.mimetype || "image/jpeg";
                const fileName = `doc_${Date.now()}.${mimeType.includes('pdf') ? 'pdf' : 'jpg'}`;

                session.documentos.push({ nomeArquivo: fileName, mimeType: mimeType, base64: base64 });
                await sock.sendMessage(from, { text: `✅ Documento (${session.documentos.length}) recebido com sucesso!` });
              } catch (e) {
                await sock.sendMessage(from, { text: "⚠️ Erro ao baixar o arquivo, por favor reenvie." });
              }
              return;
            }

            if (text.toLowerCase() === 'pronto') {
              session.step = 'PERGUNTA_PROP2';
              await sock.sendMessage(from, { text: `✅ *${session.documentos.length} documento(s)* salvos para o Proponente 1.\n\n❓ *Existe mais um proponente nesta proposta?*\n\n1️⃣ SIM\n2️⃣ NÃO` });
            } else {
              await sock.sendMessage(from, { text: "Envie mais fotos ou digite *PRONTO* para prosseguir." });
            }
            break;

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

          case 'AGUARDANDO_COMPRA_VENDA':
            session.valorCompraVenda = text;
            session.step = 'AGUARDANDO_FINANCIAMENTO';
            await sock.sendMessage(from, { text: "Digite o *Valor do Financiamento necessário* (ex: 400.000):" });
            break;

          case 'AGUARDANDO_FINANCIAMENTO':
            session.valorFinanciamento = text;
            session.step = 'AGUARDANDO_ENTRADA';
            await sock.sendMessage(from, { text: "Digite o *Valor da Entrada* (ex: 100.000):" });
            break;

          case 'AGUARDANDO_ENTRADA':
            session.valorEntrada = text;
            await sock.sendMessage(from, { text: "⏳ *Enviando dados para o Google Sheets & Drive...*" });

            try {
              const payloadProp1 = {
                imobiliaria: session.imobiliaria, nomeCliente: session.nomeCliente1, tipoProponente: "Proponente 1",
                cpf: session.cpf1, telefone: session.telefone1, banco: session.banco,
                valorCompraVenda: session.valorCompraVenda, valorFinanciamento: session.valorFinanciamento,
                valorEntrada: session.valorEntrada, documentos: session.documentos
              };

              const resp1 = await axios.post(GOOGLE_WEBHOOK_URL, payloadProp1);
              const idProposta = resp1.data.idProposta || "ID-GERADO";
              const pastaUrl = resp1.data.pastaUrl || "";

              if (session.temProp2) {
                const payloadProp2 = {
                  idProposta: idProposta, imobiliaria: session.imobiliaria, nomeCliente: session.nomeCliente2,
                  tipoProponente: "Proponente 2", cpf: session.cpf2, telefone: session.telefone2,
                  banco: session.banco, valorCompraVenda: session.valorCompraVenda,
                  valorFinanciamento: session.valorFinanciamento, valorEntrada: session.valorEntrada
                };
                await axios.post(GOOGLE_WEBHOOK_URL, payloadProp2);
              }

              await sock.sendMessage(from, { 
                text: `🎉 *PROPOSTA CADASTRADA COM SUCESSO!*\n\n📍 *ID Proposta:* ${idProposta}\n📂 *Pasta no Drive:* ${pastaUrl}\n\nO cliente já recebeu a mensagem de acompanhamento!` 
              });

              if (session.telefone1) {
                const clientJid = `${session.telefone1}@s.whatsapp.net`;
                await sock.sendMessage(clientJid, {
                  text: `Olá *${session.nomeCliente1}*! Acompanhe em tempo real o status do seu financiamento com a *${session.imobiliaria}*.\n\n📍 *Banco:* ${session.banco}\n📍 *Status Atual:* ⏳ EM APROVAÇÃO`
                }).catch(() => console.log("Erro mensagem cliente"));
              }

              delete sessions[from];

            } catch (error) {
              console.error("Erro Webhook:", error);
              await sock.sendMessage(from, { text: "⚠️ Ocorreu um erro ao salvar na planilha. Tente novamente digitando *inicio*." });
            }
            break;
        }

      } catch (e) { console.error("Erro mensagem:", e); }
    });

  } catch (err) {
    console.error("Erro inicialização Baileys:", err);
    setTimeout(startWhatsAppBot, 5000);
  }

  return sock;
}

app.listen(PORT, () => {
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  startWhatsAppBot();
});
