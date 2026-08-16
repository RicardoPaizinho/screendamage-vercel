# ScreenCheck — Deploy Guide

## Estrutura do projeto

```
meu-projeto/
├── api/
│   ├── main.py           ← Gateway leve (roda na Vercel, SEM PyTorch)
│   └── requirements.txt
├── servidor-local/
│   └── main.py           ← FastAPI com PyTorch (roda no seu servidor)
├── index.html            ← Frontend
├── script.js
├── vercel.json
└── README.md
```

---

## Por que duas APIs?

O PyTorch + Mask R-CNN ocupa ~700MB. O limite da Vercel no plano gratuito
é 250MB por função. Por isso a arquitetura é dividida:

```
Browser → Vercel (gateway leve) → Seu servidor (PyTorch)
                ↓
          Vercel Blob (salva a imagem)
```

---

## 1. Servidor local / VPS (com o modelo PyTorch)

```bash
cd servidor-local

# Instala dependências
pip install fastapi uvicorn torch torchvision pillow \
            opencv-python-headless python-multipart

# Copia o modelo treinado para a pasta correta
mkdir -p modelo
cp /caminho/para/melhor_modelo_maskrcnn.pth modelo/

# Inicia o servidor
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Para expor na internet (ambiente de testes):**
```bash
# Opção A — ngrok (gratuito, URL temporária)
ngrok http 8000
# Anote a URL: https://abc123.ngrok.io

# Opção B — se tiver IP público no servidor
# Libere a porta 8000 no firewall
```

---

## 2. Vercel Blob — criar o storage

1. Acesse [vercel.com](https://vercel.com) e faça login
2. Vá em **Storage → Create Database → Blob**
3. Dê um nome (ex: `screendamage-blob`)
4. Copie o `BLOB_READ_WRITE_TOKEN` gerado

---

## 3. Deploy na Vercel

```bash
# Instala o CLI da Vercel
npm install -g vercel

# Na raiz do projeto (onde está o vercel.json)
vercel

# Siga os prompts:
# - Link to existing project? No
# - Project name: screendamage
# - Directory: ./  (raiz)
```

**Configure as variáveis de ambiente no painel da Vercel:**
```
BLOB_READ_WRITE_TOKEN = vercel_blob_xxx...   ← do passo 2
PYTHON_API_URL        = https://abc123.ngrok.io  ← URL do seu servidor
```

Ou via CLI:
```bash
vercel env add BLOB_READ_WRITE_TOKEN
vercel env add PYTHON_API_URL
vercel --prod
```

---

## 4. Testar localmente (sem Vercel)

```bash
# Terminal 1 — servidor com PyTorch
cd servidor-local
uvicorn main:app --port 8000 --reload

# Terminal 2 — serve os arquivos estáticos
python -m http.server 3000

# Acesse http://localhost:3000
# (o script.js aponta para /api/analisar que vai falhar localmente
#  sem o gateway da Vercel — para teste local, troque a URL no script.js)
```

**Para teste local completo**, edite `script.js` linha 1:
```js
const API_BASE = "http://localhost:8000";  // aponta direto para o FastAPI
```
E na função `analisarImagem`, troque `/api/analisar` por:
```js
`${API_BASE}/analisar-tela`
```

---

## 5. Variáveis de ambiente resumidas

| Variável | Onde configurar | Valor |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Painel Vercel | Token do Blob Storage |
| `PYTHON_API_URL` | Painel Vercel | URL do seu servidor PyTorch |
| `CAMINHO_MODELO` | Servidor local (.env) | Caminho do .pth |
