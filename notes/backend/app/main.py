from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import store
from .routers import notebook


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One root notebook directory, created on first boot so an empty volume
    # comes up as an empty notebook rather than a 500 on the first request.
    store.ROOT.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Streak Notes API", lifespan=lifespan)

# Same-origin in production (the Streak nginx proxies /api/notes here); CORS
# kept open for local dev, matching the task backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notebook.router)


@app.get("/api/notes/health")
async def health():
    return {"ok": True, "notebook": str(store.ROOT)}
