// =============================================================================
// script.js — ScreenCheck Frontend Logic
// =============================================================================

const MAX_IMAGENS = 3;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];

// Estado da aplicação
let arquivos = [];       // [{file, previewUrl, resultado}]
let analisando = false;

// ── Referências DOM ───────────────────────────────────────────────────────────
const dropZone      = document.getElementById("drop-zone");
const fileInput     = document.getElementById("file-input");
const previewArea   = document.getElementById("preview-area");
const btnAnalisar   = document.getElementById("btn-analisar");
const btnLimpar     = document.getElementById("btn-limpar");
const resultArea    = document.getElementById("result-area");
const toast         = document.getElementById("toast");

// ── Upload via drag & drop ────────────────────────────────────────────────────
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

["dragleave", "drop"].forEach(ev =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove("drag-over"))
);

dropZone.addEventListener("drop", e => {
  e.preventDefault();
  adicionarArquivos([...e.dataTransfer.files]);
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  adicionarArquivos([...fileInput.files]);
  fileInput.value = "";
});

// ── Adicionar arquivos ────────────────────────────────────────────────────────
function adicionarArquivos(novos) {
  const validos = novos.filter(f => TIPOS_ACEITOS.includes(f.type));
  const invalidos = novos.length - validos.length;

  if (invalidos > 0) {
    mostrarToast(`${invalidos} arquivo(s) ignorado(s) — use JPG, PNG ou WEBP`, "erro");
  }

  const espacos = MAX_IMAGENS - arquivos.length;
  if (validos.length > espacos) {
    mostrarToast(`Máximo ${MAX_IMAGENS} imagens. ${validos.length - espacos} ignorada(s).`, "aviso");
  }

  const paraAdicionar = validos.slice(0, espacos);
  paraAdicionar.forEach(file => {
    arquivos.push({ file, previewUrl: URL.createObjectURL(file), resultado: null });
  });

  renderizarPreviews();
  resultArea.innerHTML = "";
}

// ── Renderizar previews ───────────────────────────────────────────────────────
function renderizarPreviews() {
  previewArea.innerHTML = "";

  if (arquivos.length === 0) {
    btnAnalisar.disabled = true;
    btnLimpar.style.display = "none";
    return;
  }

  arquivos.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "preview-card";
    card.innerHTML = `
      <button class="btn-remover" onclick="removerArquivo(${idx})" title="Remover">✕</button>
      <img src="${item.previewUrl}" alt="${item.file.name}" />
      <div class="preview-nome">${item.file.name}</div>
    `;
    previewArea.appendChild(card);
  });

  btnAnalisar.disabled = false;
  btnLimpar.style.display = "inline-flex";

  // Contador
  const contador = document.getElementById("contador");
  if (contador) contador.textContent = `${arquivos.length}/${MAX_IMAGENS}`;
}

function removerArquivo(idx) {
  URL.revokeObjectURL(arquivos[idx].previewUrl);
  arquivos.splice(idx, 1);
  renderizarPreviews();
  resultArea.innerHTML = "";
}

// ── Limpar tudo ───────────────────────────────────────────────────────────────
btnLimpar.addEventListener("click", () => {
  arquivos.forEach(a => URL.revokeObjectURL(a.previewUrl));
  arquivos = [];
  renderizarPreviews();
  resultArea.innerHTML = "";
});

// ── Analisar ──────────────────────────────────────────────────────────────────
btnAnalisar.addEventListener("click", analisar);

async function analisar() {
  if (analisando || arquivos.length === 0) return;
  analisando = true;

  btnAnalisar.disabled = true;
  btnAnalisar.innerHTML = `<span class="spinner"></span> Analisando...`;
  resultArea.innerHTML  = "";

  const resultados = await Promise.all(
    arquivos.map((item, idx) => analisarImagem(item, idx))
  );

  renderizarResultados(resultados);

  btnAnalisar.innerHTML = "Analisar";
  btnAnalisar.disabled  = false;
  analisando = false;
}

async function analisarImagem(item, idx) {
  const form = new FormData();
  form.append("imagem", item.file);

  try {
    const resp = await fetch("/api/analisar", { method: "POST", body: form });
    const data = await resp.json();

    if (!resp.ok) {
      return { idx, nome: item.file.name, erro: data.detail || "Erro desconhecido", previewUrl: item.previewUrl };
    }

    return {
      idx,
      nome:       item.file.name,
      previewUrl: item.previewUrl,
      resultado:  data,   // o servidor retorna o resultado direto
    };
  } catch (e) {
    return { idx, nome: item.file.name, erro: "Falha de conexão com o servidor.", previewUrl: item.previewUrl };
  }
}

// ── Renderizar resultados ─────────────────────────────────────────────────────
function renderizarResultados(resultados) {
  resultArea.innerHTML = `<h2 class="resultado-titulo">Resultados</h2>`;

  resultados.forEach(r => {
    const card = document.createElement("div");
    card.className = "resultado-card";

    if (r.erro) {
      card.innerHTML = `
        <div class="resultado-img-wrap">
          <img src="${r.previewUrl}" alt="${r.nome}" />
        </div>
        <div class="resultado-body">
          <p class="resultado-nome">${r.nome}</p>
          <div class="badge badge-erro">⚠ Erro</div>
          <p class="resultado-msg erro-txt">${r.erro}</p>
        </div>`;
    } else {
      const res         = r.resultado;
      const veredicto   = res.veredicto;
      const confianca   = Math.round(res.confianca * 100);
      const nPontos     = res.total_danos || 0;
      const naoIdent    = veredicto === "nao_identificado";

      const badgeClass  = naoIdent ? "badge-nd"
                        : veredicto === "ok" ? "badge-ok"
                        : "badge-dano";

      const badgeLabel  = naoIdent ? "❓ Não identificado"
                        : veredicto === "ok" ? "✅ Tela OK"
                        : "⚠ Danificada";

      const detalhe     = veredicto === "damaged" && nPontos > 0
                        ? `${nPontos} ponto(s) de dano localizado(s)`
                        : res.mensagem || "";

      card.innerHTML = `
        <div class="resultado-img-wrap">
          <img src="${r.previewUrl}" alt="${r.nome}" id="img-result-${r.idx}" />
          <canvas id="canvas-${r.idx}" class="canvas-overlay"></canvas>
        </div>
        <div class="resultado-body">
          <p class="resultado-nome">${r.nome}</p>
          <div class="badge ${badgeClass}">${badgeLabel}</div>
          <div class="confianca-wrap">
            <div class="confianca-label">
              <span>Certeza</span><span>${confianca}%</span>
            </div>
            <div class="barra-bg">
              <div class="barra-fill ${badgeClass}" style="width:${confianca}%"></div>
            </div>
          </div>
          ${detalhe ? `<p class="resultado-msg">${detalhe}</p>` : ""}

        </div>`;

      resultArea.appendChild(card);

      // Desenha bounding boxes e máscaras no canvas
      requestAnimationFrame(() => desenharDeteccoes(r, res));
      return;
    }

    resultArea.appendChild(card);
  });
}

// ── Desenhar bounding boxes e máscaras no canvas ──────────────────────────────
function desenharDeteccoes(r, res) {
  const img    = document.getElementById(`img-result-${r.idx}`);
  const canvas = document.getElementById(`canvas-${r.idx}`);
  if (!img || !canvas) return;

  const desenhar = () => {
    canvas.width  = img.offsetWidth;
    canvas.height = img.offsetHeight;

    const scaleX = img.offsetWidth  / (res.largura_img || img.naturalWidth);
    const scaleY = img.offsetHeight / (res.altura_img  || img.naturalHeight);

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dets = [];
    if (res.smartphone)  dets.push({ ...res.smartphone,  tipo: "smartphone" });
    if (res.pontos_dano) res.pontos_dano.forEach(p => dets.push({ ...p, tipo: "ponto" }));

    dets.forEach(det => {
      if (!det.bbox) return;
      const { x1, y1, x2, y2 } = det.bbox;
      const sx1 = x1 * scaleX, sy1 = y1 * scaleY;
      const sx2 = x2 * scaleX, sy2 = y2 * scaleY;
      const w   = sx2 - sx1, h = sy2 - sy1;

      const cor = det.classe === "ok" ? "#22c55e" : "#ef4444";

      // Retângulo
      ctx.strokeStyle = cor;
      ctx.lineWidth   = det.tipo === "smartphone" ? 3 : 2;
      ctx.setLineDash(det.tipo === "ponto" ? [6, 3] : []);
      ctx.strokeRect(sx1, sy1, w, h);
      ctx.setLineDash([]);

      // Label
      const label = `${det.classe} ${Math.round(det.confianca * 100)}%`;
      ctx.font      = "bold 11px system-ui";
      const tw      = ctx.measureText(label).width;
      ctx.fillStyle = cor;
      ctx.fillRect(sx1, sy1 - 18, tw + 10, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, sx1 + 5, sy1 - 5);
    });
  };

  if (img.complete) desenhar();
  else img.addEventListener("load", desenhar);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function mostrarToast(msg, tipo = "ok") {
  toast.textContent  = msg;
  toast.className    = `toast show toast-${tipo}`;
  setTimeout(() => toast.className = "toast", 3000);
}

// ── Inicializar ───────────────────────────────────────────────────────────────
renderizarPreviews();
