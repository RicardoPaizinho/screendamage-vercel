# api/main.py — Gateway Vercel (sem Blob, servidor salva as imagens)

import io, os
import httpx
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

PYTHON_API_URL = os.getenv("PYTHON_API_URL", "https://screen.cdqweb.com.br")
TIPOS_ACEITOS  = {"image/jpeg", "image/png", "image/webp"}


@app.get("/api/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{PYTHON_API_URL}/health")
        return {"gateway": "online", "server": r.json()}
    except Exception as e:
        return {"gateway": "online", "server": "offline", "erro": str(e)}


@app.post("/api/analisar")
async def analisar(imagem: UploadFile = File(...)):
    if imagem.content_type not in TIPOS_ACEITOS:
        raise HTTPException(400, f"Tipo não suportado: {imagem.content_type}")

    conteudo = await imagem.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{PYTHON_API_URL}/analisar-tela",
                files={"imagem": (imagem.filename, io.BytesIO(conteudo), imagem.content_type)},
            )
        if resp.status_code != 200:
            raise HTTPException(502, f"Erro no servidor: {resp.text[:200]}")
        return JSONResponse(resp.json())
    except httpx.ConnectError:
        raise HTTPException(503, "Servidor offline. Verifique screen.cdqweb.com.br")
    except httpx.TimeoutException:
        raise HTTPException(504, "Tempo esgotado (90s).")
