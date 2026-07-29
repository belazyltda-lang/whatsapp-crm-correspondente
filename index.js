/**
 * CRM CORRESPONDENTE BANCÁRIO - GOOGLE APPS SCRIPT
 * Busca por Nome de Imobiliária + Cadastro de Novas Imobiliárias
 */

const PASTA_RAIZ_NOME = "Correspondência";

function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let sheetGeral = ss.getSheetByName("Geral");
  if (!sheetGeral) {
    sheetGeral = ss.getActiveSheet();
    sheetGeral.setName("Geral");
  }

  const headers = [
    "ID Proposta", "Data/Hora", "Imobiliária", "Proponente", "Tipo Proponente", 
    "CPF", "Telefone", "Banco Escolhido", "Valor Compra/Venda", "Valor Financiamento", 
    "Valor Entrada", "Status", "Link Pasta Drive", "ID Pasta Drive"
  ];

  configurarCabecalhoAba(sheetGeral, headers, "#1F4E78");

  let sheetImobiliarias = ss.getSheetByName("Cadastros");
  if (!sheetImobiliarias) {
    sheetImobiliarias = ss.insertSheet("Cadastros");
  }

  sheetImobiliarias.clear();

  const headersImob = ["Código", "Nome da Imobiliária", "Telefone", "Bairro", "Data Cadastro"];
  configurarCabecalhoAba(sheetImobiliarias, headersImob, "#2E7D32");

  sheetImobiliarias.appendRow(["101", "Imobiliária King", "11999998888", "Centro", "28/07/2026"]);
  sheetImobiliarias.appendRow(["102", "Bons Dias", "11977776666", "Jardins", "28/07/2026"]);
  sheetImobiliarias.appendRow(["103", "Ruytru Imóveis", "11988885555", "Moema", "28/07/2026"]);
  sheetImobiliarias.appendRow(["104", "Luminux Max", "11967473738", "Tatuape", "29/07/2026"]);

  ["Imobiliária King", "Bons Dias", "Ruytru Imóveis", "Luminux Max"].forEach(nome => {
    obterOuCriarAbaImobiliaria(ss, nome, headers);
  });

  Logger.log("✅ Planilha configurada com sucesso!");
}

function configurarCabecalhoAba(sheet, headers, corFundo) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground(corFundo)
             .setFontColor("#FFFFFF")
             .setFontWeight("bold")
             .setHorizontalAlignment("center");

  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 120);

  if (headers.length > 5) {
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 130);
    sheet.setColumnWidth(8, 110);
    sheet.setColumnWidth(9, 140);
    sheet.setColumnWidth(10, 140);
    sheet.setColumnWidth(11, 130);
    sheet.setColumnWidth(12, 140);
    sheet.setColumnWidth(13, 200);
    sheet.setColumnWidth(14, 150);

    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Em Cadastro", "Em Aprovação", "Aprovado", "Reprovado", "Cancelado"], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange("L2:L1000").setDataValidation(statusRule);
  }

  sheet.setFrozenRows(1);
}

function obterOuCriarAbaImobiliaria(ss, nomeImobiliaria, headers) {
  const nomeLimpo = String(nomeImobiliaria || "Imobiliária").trim();
  let sheet = ss.getSheetByName(nomeLimpo);
  if (!sheet) {
    sheet = ss.insertSheet(nomeLimpo);
    const defaultHeaders = headers || [
      "ID Proposta", "Data/Hora", "Imobiliária", "Proponente", "Tipo Proponente", 
      "CPF", "Telefone", "Banco Escolhido", "Valor Compra/Venda", "Valor Financiamento", 
      "Valor Entrada", "Status", "Link Pasta Drive", "ID Pasta Drive"
    ];
    configurarCabecalhoAba(sheet, defaultHeaders, "#4A607A");
  }
  return sheet;
}

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buscarImobiliariaPorNome(nomeBuscado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Cadastros");
  if (!sheet) return null;

  const rows = sheet.getDataRange().getValues();
  const nomeNormalizadoBusca = normalizarTexto(nomeBuscado);

  for (let i = 1; i < rows.length; i++) {
    const nomeCadastrado = String(rows[i][1] || "").trim();
    if (nomeCadastrado !== "") {
      if (normalizarTexto(nomeCadastrado) === nomeNormalizadoBusca) {
        return { codigo: String(rows[i][0]), nome: nomeCadastrado };
      }
    }
  }
  return null;
}

function cadastrarNovaImobiliaria(nome, telefone, bairro) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Cadastros");
  if (!sheet) {
    sheet = ss.insertSheet("Cadastros");
    configurarCabecalhoAba(sheet, ["Código", "Nome da Imobiliária", "Telefone", "Bairro", "Data Cadastro"], "#2E7D32");
  }

  const nomeLimpo = String(nome || "Imobiliária Nova").trim();
  const telLimpo = String(telefone || "").trim();
  const bairroLimpo = String(bairro || "").trim();

  const existente = buscarImobiliariaPorNome(nomeLimpo);
  if (existente) {
    return existente;
  }

  const totalRows = sheet.getLastRow();
  const novoCodigo = String(100 + totalRows);
  const dataHoje = new Date().toLocaleDateString("pt-BR");

  sheet.appendRow([novoCodigo, nomeLimpo, telLimpo, bairroLimpo, dataHoje]);
  obterOuCriarAbaImobiliaria(ss, nomeLimpo);

  return { codigo: novoCodigo, nome: nomeLimpo };
}

function obterOuCriarPastaRaiz() {
  const folders = DriveApp.getFoldersByName(PASTA_RAIZ_NOME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(PASTA_RAIZ_NOME);
}

function criarEstruturaCasoDrive(nomeImobiliaria, idProposta, nomeCliente) {
  const pastaRaiz = obterOuCriarPastaRaiz();
  let pastaImobiliaria;
  const imobFolders = pastaRaiz.getFoldersByName(nomeImobiliaria);
  if (imobFolders.hasNext()) {
    pastaImobiliaria = imobFolders.next();
  } else {
    pastaImobiliaria = pastaRaiz.createFolder(nomeImobiliaria);
  }

  const nomePastaCaso = `${idProposta} - ${nomeCliente}`;
  const pastaCaso = pastaImobiliaria.createFolder(nomePastaCaso);
  const pastaCliente = pastaCaso.createFolder("Cliente");

  return {
    pastaCasoId: pastaCaso.getId(),
    pastaCasoUrl: pastaCaso.getUrl(),
    pastaClienteId: pastaCliente.getId()
  };
}

function onEdit(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();
  
  if (range.getColumn() === 12 && range.getRow() > 1) {
    const novoStatus = String(e.value).trim();
    if (novoStatus.toLowerCase() === "aprovado") {
      const row = range.getRow();
      const idPastaDrive = sheet.getRange(row, 14).getValue();

      if (idPastaDrive) {
        try {
          const pastaCaso = DriveApp.getFolderById(idPastaDrive);
          if (!pastaCaso.getFoldersByName("Imóvel").hasNext()) pastaCaso.createFolder("Imóvel");
          if (!pastaCaso.getFoldersByName("Vendedores").hasNext()) pastaCaso.createFolder("Vendedores");
        } catch (err) {
          Logger.log("Erro: " + err.toString());
        }
      }
    }
  }
}

function doGet(e) {
  const action = e ? e.parameter.action : "";
  const name = e ? e.parameter.name : "";

  if ((action === "verifyName" || action === "verifyCode") && name) {
    const imob = buscarImobiliariaPorNome(name);
    if (imob) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", found: true, codigo: imob.codigo, imobiliaria: imob.nome })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", found: false })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "API Ativa" })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (data.action === "cadastrarImobiliaria") {
      const novaImob = cadastrarNovaImobiliaria(data.nome, data.telefone, data.bairro);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", codigo: novaImob.codigo, imobiliaria: novaImob.nome })).setMimeType(ContentService.MimeType.JSON);
    }

    let sheetGeral = ss.getSheetByName("Geral");
    if (!sheetGeral) sheetGeral = ss.getActiveSheet();

    const proximaLinha = sheetGeral.getLastRow() + 1;
    const idProposta = data.idProposta || `ID-${String(proximaLinha - 1).padStart(3, '0')}`;
    const dataHora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    let driveInfo = { pastaCasoUrl: "", pastaCasoId: "" };
    if (data.tipoProponente === "Proponente 1" || !data.tipoProponente) {
      driveInfo = criarEstruturaCasoDrive(data.imobiliaria, idProposta, data.nomeCliente);
    } else {
      const rows = sheetGeral.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === idProposta) {
          driveInfo.pastaCasoUrl = rows[i][12];
          driveInfo.pastaCasoId = rows[i][13];
          break;
        }
      }
    }

    if (data.documentos && Array.isArray(data.documentos) && driveInfo.pastaCasoId) {
      salvarDocumentosNoDrive(driveInfo.pastaCasoId, data.documentos);
    }

    const rowData = [
      idProposta, dataHora, data.imobiliaria || "", data.nomeCliente || "", data.tipoProponente || "Proponente 1",
      data.cpf || "", data.telefone || "", data.banco || "", data.valorCompraVenda || "", data.valorFinanciamento || "",
      data.valorEntrada || "", "Em Aprovação", driveInfo.pastaCasoUrl, driveInfo.pastaCasoId
    ];

    sheetGeral.appendRow(rowData);
    if (data.tipoProponente === "Proponente 2") {
      sheetGeral.getRange(sheetGeral.getLastRow(), 1, 1, rowData.length).setBackground("#F2F4F7");
    }

    if (data.imobiliaria) {
      const sheetImob = obterOuCriarAbaImobiliaria(ss, data.imobiliaria);
      sheetImob.appendRow(rowData);
      if (data.tipoProponente === "Proponente 2") {
        sheetImob.getRange(sheetImob.getLastRow(), 1, 1, rowData.length).setBackground("#F2F4F7");
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success", idProposta: idProposta, pastaUrl: driveInfo.pastaCasoUrl })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function salvarDocumentosNoDrive(idPastaCaso, documentos) {
  try {
    const pastaCaso = DriveApp.getFolderById(idPastaCaso);
    let pastaCliente;
    const subfolders = pastaCaso.getFoldersByName("Cliente");
    if (subfolders.hasNext()) pastaCliente = subfolders.next();
    else pastaCliente = pastaCaso.createFolder("Cliente");

    documentos.forEach(doc => {
      if (doc.base64 && doc.nomeArquivo) {
        const bytes = Utilities.base64Decode(doc.base64);
        const blob = Utilities.newBlob(bytes, doc.mimeType || "image/jpeg", doc.nomeArquivo);
        pastaCliente.createFile(blob);
      }
    });
  } catch (err) {
    Logger.log("Erro ao salvar arquivos: " + err.toString());
  }
}
